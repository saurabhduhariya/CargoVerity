import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const email = process.env.PLAYWRIGHT_E2E_EMAIL;
const password = process.env.PLAYWRIGHT_E2E_PASSWORD;
test.skip(!email || !password, "Configure Executive credentials for real operations QA.");
test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } });
test.setTimeout(360_000);

async function queueReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Shipments", exact: true })).toBeVisible();
  await expect(page.getByText("Loading shipment queue", { exact: true })).toHaveCount(0);
}

test("real operations queue, private intake validation, and responsive document states", async ({ page, browser }, testInfo) => {
  const reference = `QA-OPERATIONS-${Date.now()}`;
  const artifactDir = process.env.OPERATIONS_QA_DIR ?? testInfo.outputPath("operations");
  await mkdir(artifactDir, { recursive: true });
  const evidence: Record<string, unknown> = { reference, viewports: [], uploadPhases: [], apiGuards: {}, extraction: "not requested" };
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, email!, password!);
  await queueReady(page);
  await expect(page.locator("#new-shipment-form")).toBeHidden();
  await page.getByRole("button", { name: "New shipment", exact: true }).click();
  await expect(page.locator("#reference")).toBeFocused();
  await page.getByLabel("Shipment reference").fill(reference);
  await page.getByLabel("Supplier name", { exact: true }).fill("Synthetic Operations QA Supplier");
  await page.getByLabel("Importer name").fill("Synthetic QA Importer");
  await page.getByLabel("Exporter name").fill("Synthetic QA Exporter");
  const creation = page.waitForResponse((response) => response.url().endsWith("/api/shipments") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create shipment", exact: true }).click();
  expect((await creation).status()).toBe(201);
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
  const shipmentId = page.url().split("/").pop()!;
  evidence.shipmentId = shipmentId;
  const invoice = page.getByTestId("slot-INVOICE");
  await expect(invoice.getByText("Drop a document here", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run extraction (3 documents)" })).toBeDisabled();
  await expect(page.getByLabel("Sample scenario")).toBeHidden();

  // Unsupported, empty, oversized files stop in the client; no signed authorization is sent.
  let authorizations = 0;
  page.on("request", (request) => { if (request.url().endsWith("/documents/upload-url")) authorizations++; });
  const pick = async (name: string, mimeType: string, buffer: Buffer) => invoice.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
  const uploadButton = invoice.getByRole("button", { name: "Upload Document", exact: true });
  const drop = async (names: string[], target = invoice.locator('input[type="file"]').locator("..")) => {
    const dataTransfer = await page.evaluateHandle((names) => {
      const data = new DataTransfer();
      for (const name of names) data.items.add(new File(["Synthetic drop selection"], name, { type: "application/pdf" }));
      return data;
    }, names);
    await target.dispatchEvent("dragenter", { dataTransfer });
    await target.dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
  };
  await drop(["SYNTHETIC-first.pdf", "SYNTHETIC-second.pdf"]);
  await expect(invoice.getByRole("alert")).toContainText("Choose one document for this slot.");
  await expect(uploadButton).toBeDisabled();
  await drop(["SYNTHETIC-drop.pdf"]);
  await expect(invoice.getByText("SYNTHETIC-drop.pdf", { exact: true })).toBeVisible();
  await expect(invoice.getByRole("alert")).toHaveCount(0);
  await expect(uploadButton).toBeEnabled();
  await pick("SYNTHETIC-unsupported.txt", "text/plain", Buffer.from("synthetic QA"));
  await uploadButton.click();
  await expect(invoice.getByRole("alert")).toContainText("Only PDF");
  await pick("SYNTHETIC-empty.pdf", "application/pdf", Buffer.alloc(0));
  await uploadButton.click();
  await expect(invoice.getByRole("alert")).toContainText("empty (0 bytes)");
  await pick("SYNTHETIC-oversized.pdf", "application/pdf", Buffer.alloc(11_000_000));
  await uploadButton.click();
  await expect(invoice.getByRole("alert")).toContainText("maximum allowed size");
  expect(authorizations).toBe(0);

  // Actual private storage transfer followed by server magic-byte rejection.
  await pick("SYNTHETIC-not-really.pdf", "application/pdf", Buffer.from("Synthetic plain text pretending to be a PDF"));
  const invalidCompletion = page.waitForResponse((response) => response.url().endsWith("/documents/complete"));
  await uploadButton.click();
  expect((await invalidCompletion).status()).toBe(415);
  await expect(invoice.getByRole("alert")).toContainText("genuine PDF or image");
  await expect(invoice.getByText("Version 1", { exact: true })).toHaveCount(0);

  // Delay, not replace, real requests to inspect each upload stage.
  let releaseAuthorization!: () => void;
  let releaseTransfer!: () => void;
  let releaseValidation!: () => void;
  const authorizationGate = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
  const transferGate = new Promise<void>((resolve) => { releaseTransfer = resolve; });
  const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
  await page.route("**/documents/upload-url", async (route) => { await authorizationGate; await route.continue(); });
  await page.route(/\/storage\/v1\/object\/upload\/sign\//, async (route) => { await transferGate; await route.continue(); });
  await page.route("**/documents/complete", async (route) => { await validationGate; await route.continue(); });
  await pick("SYNTHETIC-QA-invoice.pdf", "application/pdf", readFileSync(join(process.cwd(), "public/sample-docs/shp-24811-invoice.pdf")));
  await uploadButton.click();
  await expect(invoice.getByRole("status")).toContainText("Authorizing");
  await expect(page.getByTestId("slot-PACKING_LIST").locator('input[type="file"]')).toBeDisabled();
  await drop(["SYNTHETIC-disabled.pdf"], page.getByTestId("slot-PACKING_LIST").locator('input[type="file"]').locator(".."));
  await expect(page.getByText("SYNTHETIC-disabled.pdf", { exact: true })).toHaveCount(0);
  (evidence.uploadPhases as string[]).push("authorizing");
  releaseAuthorization();
  await expect(invoice.getByRole("status")).toContainText("Uploading to private storage");
  await expect(invoice.getByRole("progressbar")).toHaveAttribute("value", "0");
  (evidence.uploadPhases as string[]).push("byte transfer: 0% before sending");
  releaseTransfer();
  await expect(invoice.getByRole("status")).toContainText("Validating file");
  await expect(invoice.getByRole("progressbar")).not.toHaveAttribute("value");
  await expect(invoice.getByText("A completed transfer is not yet a saved document.")).toBeVisible();
  (evidence.uploadPhases as string[]).push("server validation: indeterminate");
  const validCompletion = page.waitForResponse((response) => response.url().endsWith("/documents/complete"));
  releaseValidation();
  expect((await validCompletion).status()).toBe(201);
  await expect(invoice.getByText("Version 1", { exact: true })).toBeVisible();
  await page.unroute("**/documents/upload-url");
  await page.unroute(/\/storage\/v1\/object\/upload\/sign\//);
  await page.unroute("**/documents/complete");
  await expect(invoice.getByRole("status")).toContainText("Version 1 saved. Ready to extract.");
  (evidence.uploadPhases as string[]).push("saved v1 at rev2");

  // Replacement guard, retained history, and duplicate rejection use the unchanged APIs.
  await invoice.getByRole("button", { name: "Replace", exact: true }).click();
  await pick("SYNTHETIC-QA-replacement.pdf", "application/pdf", readFileSync(join(process.cwd(), "public/sample-docs/shp-24812-invoice.pdf")));
  await invoice.getByRole("button", { name: "Upload Replacement", exact: true }).click();
  await expect(invoice.getByRole("alert")).toContainText("confirmation box");
  await invoice.getByLabel("Confirm document replacement").check();
  await invoice.getByRole("button", { name: "Upload Replacement", exact: true }).click();
  await expect(invoice.getByText("Version 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  await invoice.getByRole("button", { name: "Replace", exact: true }).click();
  await pick("SYNTHETIC-QA-replacement.pdf", "application/pdf", readFileSync(join(process.cwd(), "public/sample-docs/shp-24812-invoice.pdf")));
  await invoice.getByLabel("Confirm document replacement").check();
  await invoice.getByRole("button", { name: "Upload Replacement", exact: true }).click();
  await expect(invoice.getByRole("alert")).toContainText("already been uploaded");
  await invoice.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(invoice.getByText("Version 2", { exact: true })).toBeVisible();

  for (const [type, filename] of [["PACKING_LIST", "shp-24812-packing-list.pdf"], ["BILL_OF_LADING", "shp-24812-bill-of-lading.pdf"]]) {
    const slot = page.getByTestId(`slot-${type}`);
    await slot.locator('input[type="file"]').setInputFiles({ name: `SYNTHETIC-QA-${filename}`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "public/sample-docs", filename)) });
    await slot.getByRole("button", { name: "Upload Document", exact: true }).click();
    await expect(slot.getByText("Version 1", { exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.getByRole("button", { name: "Run extraction (3 documents)" })).toBeEnabled();
  const statusResponse = await page.request.get(`/api/shipments/${shipmentId}/extract`);
  const saved = await statusResponse.json();
  expect(saved.documents).toHaveLength(3);
  expect(saved.shipmentRevision).toBe(5);
  const stale = await page.request.post(`/api/shipments/${shipmentId}/documents/upload-url`, { data: { fileName: "SYNTHETIC-stale.pdf", fileSizeBytes: 100, documentType: "INVOICE", declaredMimeType: "application/pdf", expectedRevision: 4 } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("STALE_REVISION");
  const forbidden = await page.request.post(`/api/shipments/${shipmentId}/decision`, { data: {} });
  expect(forbidden.status()).toBe(403);
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(new URL("/api/shipments", page.url()).href)).status()).toBe(401);
  expect((await anonymous.request.get(new URL(`/api/documents/${saved.documents[0].documentId}`, page.url()).href)).status()).toBe(401);
  await anonymous.close();
  evidence.apiGuards = { staleRevision: 409, executiveManagerDecision: 403, anonymousQueue: 401, anonymousPrivateEvidence: 401, savedRevision: saved.shipmentRevision };

  // Optional live-provider call; successful output is not assumed, and no extraction is seeded.
  if (process.env.PLAYWRIGHT_RUN_EXTRACTION === "1") {
    await invoice.getByRole("button", { name: "Run extraction", exact: true }).click();
    await expect(invoice.getByTestId("extraction-state-INVOICE")).toContainText("Extracting");
    await expect(invoice.getByTestId("extraction-state-INVOICE")).not.toContainText("Extracting", { timeout: 180_000 });
    evidence.extraction = await invoice.getByTestId("extraction-state-INVOICE").innerText();
    await invoice.getByRole("button", { name: "Retry extraction", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(invoice.getByRole("button", { name: "Retry extraction", exact: true })).toBeFocused();
  }

  // Filters, stable supplier choices, empty and transport-error recovery.
  await page.goto("/dashboard");
  await queueReady(page);
  const allSupplierCount = await page.locator("#supplier-filter option").count();
  await page.getByLabel("Search shipments", { exact: true }).fill(reference);
  await expect(page.getByRole("status", { exact: false }).filter({ hasText: "1–1 of 1 shipments" })).toBeVisible();
  expect(await page.locator("#supplier-filter option").count()).toBe(allSupplierCount);
  await page.getByLabel("Filter shipment status").selectOption("EXPORTED");
  await expect(page.getByRole("heading", { name: "No shipments match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Reset filters", exact: true }).first().click();
  await queueReady(page);
  await page.getByRole("button", { name: /Awaiting approval/ }).click();
  await page.getByRole("button", { name: /All shipments/ }).click();
  await page.getByText("Created date (UTC)", { exact: true }).click();
  await page.getByLabel("Filter from date").fill("2026-11-08");
  await page.getByLabel("Filter to date").fill("2026-11-07");
  await expect(page.getByText("From date must be on or before to date. Adjust the range to load results.")).toBeVisible();
  await page.getByRole("button", { name: "Reset filters", exact: true }).first().click();
  await queueReady(page);
  await page.route("**/api/shipments?**", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh queue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Queue unavailable" })).toBeVisible();
  await page.unroute("**/api/shipments?**");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await queueReady(page);
  await expect(page.getByRole("heading", { name: "Queue unavailable" })).toHaveCount(0);

  // One batched capture of all four required sizes, real QA and existing stored records only.
  await page.getByLabel("Search shipments", { exact: true }).fill("QA-");
  await queueReady(page);
  const measurements: unknown[] = [];
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(artifactDir, `queue-${width}.png`), fullPage: true });
    const queueLayout = await page.evaluate(() => ({ width: window.innerWidth, documentWidth: document.documentElement.scrollWidth, inputFont: getComputedStyle(document.querySelector("#shipment-search")!).fontSize, inputHeight: document.querySelector("#shipment-search")!.getBoundingClientRect().height, tableContained: document.querySelector('[data-slot="table-container"]')!.getBoundingClientRect().width <= window.innerWidth }));
    expect(queueLayout.documentWidth).toBeLessThanOrEqual(width);
    if (width === 390) { expect(parseFloat(queueLayout.inputFont)).toBeGreaterThanOrEqual(16); expect(queueLayout.inputHeight).toBeGreaterThanOrEqual(44); }
    await page.goto(`/shipments/${shipmentId}`);
    await page.getByTestId("slot-INVOICE").waitFor();
    await page.screenshot({ path: join(artifactDir, `shipment-${width}.png`), fullPage: true });
    const detailLayout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, slots: [...document.querySelectorAll('[data-testid^="slot-"]')].map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width }; }) }));
    expect(detailLayout.documentWidth).toBeLessThanOrEqual(width);
    if (width >= 1024) expect(new Set(detailLayout.slots.map((slot) => slot.y)).size).toBe(1);
    else expect(new Set(detailLayout.slots.map((slot) => slot.y)).size).toBe(3);
    measurements.push({ width, height, queueLayout, detailLayout });
    await page.goto("/dashboard");
    await queueReady(page);
    await page.getByLabel("Search shipments", { exact: true }).fill("QA-");
    await queueReady(page);
  }
  evidence.viewports = measurements;
  evidence.runtimeErrors = runtimeErrors;
  expect(runtimeErrors).toEqual([]);
  await writeFile(join(artifactDir, "report.json"), JSON.stringify(evidence, null, 2));
});
