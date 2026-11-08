import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { createReviewDocuments } from "../fixtures/review-documents";
import { seedReviewWorkspace } from "../fixtures/seed-review-workspace";
import { login } from "./helpers";

const executiveEmail = process.env.PLAYWRIGHT_E2E_EMAIL;
const executivePassword = process.env.PLAYWRIGHT_E2E_PASSWORD;
const managerEmail = process.env.PLAYWRIGHT_MANAGER_EMAIL;
const managerPassword = process.env.PLAYWRIGHT_MANAGER_PASSWORD;
test.skip(process.env.PLAYWRIGHT_WORKFLOW_QA !== "1" || !executiveEmail || !executivePassword || !managerEmail || !managerPassword, "Explicit opt-in and both configured roles are required; creates a NEW synthetic QA shipment only.");
test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }, actionTimeout: 20_000 });
test.setTimeout(600_000);

async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "Refresh latest shipment" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText("Refreshing saved values and audit history. Drafts are retained…", { exact: true })).toHaveCount(0);
}

test("synthetic real-API resolution, manager decisions, audit, guarded export and reports", async ({ page, browser }, testInfo) => {
  const resumeFile = process.env.WORKFLOW_QA_RESUME;
  const previous = resumeFile ? JSON.parse(await readFile(resumeFile, "utf8")) as Record<string, unknown> : null;
  const reference = previous ? String(previous.reference) : `QA-REVIEW-DECISIONS-${Date.now()}`;
  if (!reference.startsWith("QA-REVIEW-DECISIONS-")) throw new Error("Resume is limited to this flow's explicitly labeled synthetic records.");
  const out = process.env.WORKFLOW_QA_DIR ?? testInfo.outputPath("workflow-decisions");
  await mkdir(out, { recursive: true });
  const evidence: Record<string, unknown> = previous ?? { reference, checks: [], screenshots: [], runtimeErrors: [] };
  const resumedStage = String(previous?.stage ?? "new");
  const stages = ["new", "mapped", "exception", "submitted", "returned", "resubmitted", "approved", "exported"];
  if (!stages.includes(resumedStage)) throw new Error("Unknown QA resume stage.");
  if (previous && resumedStage === "new") throw new Error("Resume before the mapping checkpoint requires manual inspection. Do not reseed or create another record automatically.");
  const before = (stage: string) => stages.indexOf(resumedStage) < stages.indexOf(stage);
  const checks = evidence.checks as string[];
  const errors = evidence.runtimeErrors as string[];
  page.on("pageerror", (error) => errors.push(error.message));
  async function checkpoint() { await writeFile(`${out}/report.json`, JSON.stringify(evidence, null, 2)); }
  async function capture(p: Page, name: string) {
    await p.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    if (await p.getByTestId("document-pane").isVisible()) await expect(p.getByTestId("document-pane").getByRole("img")).toBeVisible({ timeout: 30_000 });
    await p.locator('[data-slot="confirm-dialog-content"]').evaluateAll((elements) => elements.forEach((el) => { el.scrollTop = 0; }));
    await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    (evidence.screenshots as string[]).push(name);
  }
  async function crosschecks(p = page) {
    const response = await p.request.get(`/api/shipments/${evidence.shipmentId}/crosschecks?includeHistory=true`);
    expect(response.status()).toBe(200);
    return response.json();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, executiveEmail!, executivePassword!);
  try {
  if (!previous) {
  const creation = await page.request.post("/api/shipments", { data: { reference, supplierName: "Synthetic Review QA Supplier", importerName: "Synthetic Review QA Importer", exporterName: "Synthetic Review QA Supplier" } });
  expect(creation.status()).toBe(201);
  const shipment = (await creation.json()).shipment;
  evidence.shipmentId = shipment.id;
  evidence.stage = "new";
  await checkpoint();
  await page.goto(`/shipments/${shipment.id}`);
  for (const doc of await createReviewDocuments(reference)) {
    const slot = page.getByTestId(`slot-${doc.docType}`);
    await slot.locator('input[type="file"]').setInputFiles({ name: doc.fileName, mimeType: "application/pdf", buffer: Buffer.from(doc.bytes) });
    const completion = page.waitForResponse((response) => response.url().endsWith("/documents/complete"));
    await slot.getByRole("button", { name: "Upload Document", exact: true }).click();
    expect((await completion).status()).toBe(201);
    await expect(slot.getByText("v1 Active", { exact: true })).toBeVisible();
    await expect(page.getByTestId("slot-INVOICE").getByRole("button", { name: "Replace", exact: true })).toBeEnabled();
  }
  // Live-provider validation/quota failures were established in earlier real QA. This opt-in
  // fixture is labeled in every run and its audit event; it proves workflows, not AI accuracy.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
  try { await seedReviewWorkspace(prisma, { shipmentId: shipment.id, expectedReference: reference, executiveEmail: executiveEmail! }); }
  finally { await prisma.$disconnect(); }
  evidence.extraction = "Authorized deterministic synthetic fixture; no successful live AI extraction claimed";
  await page.goto(`/review/${shipment.id}`);
  await ready(page);
  await page.getByRole("tab", { name: /^Checks/ }).click();
  await page.getByRole("button", { name: "Re-run checks", exact: true }).click();
  await ready(page);
  await expect(page.getByText("2 unresolved", { exact: true })).toBeVisible();
  const first = await crosschecks();
  evidence.initialRun = first.latestRun.id;
  await page.getByTestId("check-gross_weight_comparison").getByRole("button", { name: "Source · page 2" }).first().click();
  await expect(page.getByRole("button", { name: "Back to check", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to check", exact: true }).click();
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.getByTestId("checks-scroll").evaluate((el) => { el.scrollTop = 0; });
    await capture(page, `checks-unresolved-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width >= 1024) { await expect(page.getByTestId("document-pane")).toBeVisible(); await expect(page.getByTestId("review-inspector")).toBeVisible(); }
  }
  checks.push("two original unresolved machine checks, current run/revision, exact evidence and desktop split");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Show checks").selectOption("exceptions");
  await expect(page.getByText("No checks in this view", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show all checks", exact: true }).click();
  await page.getByRole("button", { name: "Submit to manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Submission blocked/ })).toBeVisible();
  await ready(page);
  await page.getByRole("button", { name: "Export preview", exact: true }).click();
  const preview = page.getByTestId("export-preview-dialog");
  await expect(preview.getByRole("heading", { name: "Export is blocked" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download guarded CSV" })).toBeDisabled();
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) { await page.setViewportSize({ width, height }); await capture(page, `export-blocked-${width}`); }
  await preview.getByRole("button", { name: "Close export preview" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  checks.push("unresolved submission blocked and unapproved export disabled with real server blockers");

  await page.getByRole("tab", { name: /^Fields/ }).click();
  async function editField(label: string, value: string, reason: string) {
    const field = page.getByRole("article", { name: new RegExp(`^${label}`) });
    await field.getByLabel(label, { exact: true }).fill(value);
    await field.getByLabel(/Correction reason/).fill(reason);
    const response = page.waitForResponse((res) => /\/api\/fields\/.+\/review$/.test(res.url()));
    await field.getByRole("button", { name: "Save correction", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save and recompute checks?" });
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Continue with new run" }).click();
    expect((await response).status()).toBe(200);
    await ready(page);
  }
  await editField("Importer", "Synthetic Review QA Importer", "Synthetic QA assumption from Packing List/BL page 1; omitted from Invoice, not an Invoice-observed fact.");
  await editField("Issue Date", "2026-11-07", "Synthetic QA assumption from Packing List/BL page 1; omitted from Invoice, not an Invoice-observed fact.");
  for (const label of ["Exporter", "Gross Weight", "Invoice Total"]) {
    const field = page.getByRole("article", { name: new RegExp(`^${label}`) });
    const response = page.waitForResponse((res) => /\/api\/fields\/.+\/review$/.test(res.url()));
    await field.getByRole("button", { name: "Confirm", exact: true }).click();
    expect((await response).status()).toBe(200); await ready(page);
  }
  // A clearly labeled intentional QA entry error enables a real correction/audit-link flow.
  await editField("Invoice Total", "16300.00", "Synthetic QA deliberate input error for correction-history testing, not a source observation.");
  const errorRun = await crosschecks();
  const arithmetic = errorRun.latestRun.results.find((check: { ruleKey: string }) => check.ruleKey === "invoice_line_total");
  expect(arithmetic.status).toBe("MISMATCH");
  evidence.historicalArithmeticCheck = arithmetic.id;
  await editField("Invoice Total", "16320.00", "Correct synthetic QA input error: Invoice page 2 states USD 16320.00.");
  await page.getByRole("tab", { name: /^History$/ }).click();
  await expect(page.getByText("Loading check history", { exact: true })).toHaveCount(0);
  const historical = page.getByText(`Revision ${errorRun.latestRun.revision} · Historical run`, { exact: true });
  await historical.click();
  const historyCheck = page.locator(`#history-check-${arithmetic.id}`);
  await historyCheck.getByRole("button", { name: "Link saved correction", exact: true }).click();
  await historyCheck.getByLabel("Resolution reason (at least 5 characters)").fill("Synthetic QA saved Invoice total now agrees with source page 2 and the current arithmetic check.");
  await historyCheck.getByLabel("I reviewed the compared values and inspected the source documents.").check();
  const linkResponse = page.waitForResponse((res) => res.url().endsWith(`/api/crosschecks/${arithmetic.id}/resolve`));
  await historyCheck.getByRole("button", { name: "Record link", exact: true }).click();
  expect((await linkResponse).status()).toBe(201); await ready(page);
  const linked = await crosschecks();
  const preserved = linked.history.find((run: { id: string }) => run.id === errorRun.latestRun.id).results.find((check: { id: string }) => check.id === arithmetic.id);
  expect(preserved.status).toBe("MISMATCH");
  expect(preserved.resolutions.some((entry: { type: string }) => entry.type === "SOURCE_CORRECTED")).toBe(true);
  checks.push("real saved correction and historical link; original machine MISMATCH and input snapshot preserved");

  await page.getByRole("tab", { name: /^Checks/ }).click();
  const quantity = page.getByTestId("check-invoice_quantity_vs_packing_list");
  await quantity.getByLabel("Mapping reason (at least 5 characters)").fill("Synthetic QA page 2: pair first goods line with first packing line, not a subtotal.");
  await quantity.getByLabel("Packing list line for invoice line 1", { exact: true }).selectOption({ index: 1 });
  const mapResponse = page.waitForResponse((res) => res.url().endsWith(`/api/shipments/${shipment.id}/line-mappings`));
  await quantity.getByRole("button", { name: "Map lines", exact: true }).first().click();
  const mapDialog = page.getByRole("dialog", { name: "Start a new check run?" });
  if (await mapDialog.isVisible()) await mapDialog.getByRole("button", { name: "Continue with new run" }).click();
  expect((await mapResponse).status()).toBe(201); await ready(page);
  evidence.stage = "mapped"; await checkpoint();
  } else {
    await page.goto(`/review/${evidence.shipmentId}`); await ready(page);
    await expect(page.getByRole("banner")).toContainText(reference);
    const resumed = await crosschecks();
    expect(resumed.lineMappings.length).toBeGreaterThan(0);
    expect(resumed.latestRun.results.find((check: { ruleKey: string }) => check.ruleKey === "invoice_quantity_vs_packing_list").status).toBe("PASS");
    expect(resumed.history.some((run: { results: { status: string; resolutions: { type: string }[] }[] }) => run.results.some((check) => check.status === "MISMATCH" && check.resolutions.some((entry) => entry.type === "SOURCE_CORRECTED")))).toBe(true);
    checks.push(`Resumed same synthetic shipment at ${resumedStage}; verified active mapping and preserved historical correction link`);
    await page.getByRole("tab", { name: /^Checks/ }).click();
  }
  const shipment = { id: String(evidence.shipmentId) };
  const memo = `${reference}-MEMO`;
  if (before("exception")) {
  await expect(page.getByText("1 unresolved", { exact: true })).toBeVisible();
  const weight = page.getByTestId("check-gross_weight_comparison");
  await weight.getByRole("button", { name: "Record exception", exact: true }).click();
  await weight.getByLabel("Resolution reason (at least 5 characters)").fill("Synthetic QA workflow exception only: Invoice 3120kg differs from supporting 3165kg; discrepancy is not corrected.");
  await weight.getByLabel("I reviewed the compared values and inspected the source documents.").check();
  await expect(weight.getByRole("button", { name: "Record exception", exact: true })).toBeDisabled();
  await writeFile(`${out}/synthetic-evidence-memo.md`, `# ${memo}\nSynthetic QA only, not supplier correspondence or customs clearance.\nInvoice 3120kg vs PL/BL 3165kg remains a 45kg mismatch. Human exception solely tests sign-off guards.\n`);
  await weight.getByLabel("External evidence / query reference (required)").fill(memo);
  await weight.getByRole("button", { name: "Close (keep draft)", exact: true }).click();
  await weight.getByRole("button", { name: "Record exception", exact: true }).click();
  await expect(weight.getByLabel("External evidence / query reference (required)")).toHaveValue(memo);
  const exceptionResponse = page.waitForResponse((res) => /\/api\/crosschecks\/.+\/resolve$/.test(res.url()));
  await weight.getByRole("button", { name: "Record exception", exact: true }).click();
  expect((await exceptionResponse).status()).toBe(201); await ready(page);
  await expect(weight.getByText("Exception awaiting approval", { exact: true })).toBeVisible();
  await expect(weight).toContainText("Original machine result: Mismatch");
  checks.push("required evidence and retained resolution draft; human exception recorded without changing the weight mismatch");
  evidence.stage = "exception"; await checkpoint();
  }
  if (before("submitted")) {
  await page.getByRole("button", { name: "Submit to manager", exact: true }).click();
  await ready(page);
  await expect(page.locator('header [data-status="READY_FOR_APPROVAL"]')).toBeVisible();
  evidence.stage = "submitted"; await checkpoint();
  }
  const current = await crosschecks();
  const revision = current.currentRevision;
  const unauthorized = await page.request.post(`/api/shipments/${shipment.id}/decision`, { data: { decision: "APPROVE", expectedRevision: revision, comment: "Unauthorized synthetic QA" } });
  expect(unauthorized.status()).toBe(403);
  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const manager = await managerContext.newPage();
  manager.on("pageerror", (error) => errors.push(error.message));
  await login(manager, managerEmail!, managerPassword!);
  await manager.goto(`/review/${shipment.id}`); await ready(manager);
  if (before("returned")) {
  await manager.getByRole("button", { name: "Manager decision", exact: true }).click();
  let decision = manager.getByRole("dialog", { name: /^Manager decision/ });
  await expect(decision).toContainText(memo);
  await expect(decision).toContainText("Original machine result: Mismatch");
  await decision.getByRole("button", { name: "Approve shipment", exact: true }).click();
  await expect(decision.getByRole("alert")).toContainText("meaningful comment");
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) { await manager.setViewportSize({ width, height }); await capture(manager, `manager-decision-${width}`); }
  await decision.getByRole("button", { name: "Inspect audit history", exact: true }).click();
  await expect(decision).not.toBeVisible();
  await expect(manager.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(manager.getByText("Loading check history", { exact: true })).toHaveCount(0);
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) { await manager.setViewportSize({ width, height }); await manager.getByTestId("history-scroll").evaluate((el) => { el.scrollTop = 0; }); await capture(manager, `history-${width}`); }
  await manager.getByRole("button", { name: /^Audit \(/ }).click();
  await manager.getByLabel("Search events, actors or evidence").fill(memo);
  await expect(manager.getByRole("status").filter({ hasText: /[1-9]\d* of \d+ loaded events/ })).toBeVisible();
  await expect(manager.getByTestId("history-scroll").getByText(`Evidence: ${memo}`, { exact: true })).toBeVisible();
  await manager.getByLabel("Search events, actors or evidence").fill("NO-SUCH-QA-EVENT");
  await expect(manager.getByText("No matching audit events", { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "Clear audit search", exact: true }).click();
  checks.push("manager sees exact revision and exception evidence; required comment, audit navigation/search/empty/reset");
  const stale = await manager.request.post(`/api/shipments/${shipment.id}/decision`, { data: { decision: "APPROVE", expectedRevision: revision - 1, comment: "Synthetic QA stale revision" } });
  expect(stale.status()).toBe(409); expect((await stale.json()).code).toBe("STALE_REVISION");
  await manager.setViewportSize({ width: 1440, height: 900 });
  await manager.getByRole("button", { name: "Manager decision", exact: true }).click();
  decision = manager.getByRole("dialog", { name: /^Manager decision/ });
  await decision.getByLabel("Decision", { exact: true }).selectOption("REJECT");
  await decision.getByLabel(/Decision comment/).fill("Synthetic QA return: review the documented weight exception before resubmitting.");
  const rejection = manager.waitForResponse((res) => res.url().endsWith(`/api/shipments/${shipment.id}/decision`));
  await decision.getByRole("button", { name: "Return to review", exact: true }).click();
  expect((await rejection).status()).toBe(200); await ready(manager);
  evidence.stage = "returned"; await checkpoint();
  }
  if (before("resubmitted")) {
  await page.getByRole("button", { name: "Refresh latest shipment" }).click(); await ready(page);
  await page.getByRole("button", { name: "Submit to manager", exact: true }).click(); await ready(page);
  evidence.stage = "resubmitted"; await checkpoint();
  }
  if (before("approved")) {
  await manager.getByRole("button", { name: "Refresh latest shipment" }).click(); await ready(manager);
  await manager.getByRole("button", { name: "Manager decision", exact: true }).click();
  const decision = manager.getByRole("dialog", { name: /^Manager decision/ });
  await decision.getByLabel(/Decision comment/).fill(`Synthetic QA sign-off ${memo}; accepts workflow exception only, not customs clearance.`);
  const approval = manager.waitForResponse((res) => res.url().endsWith(`/api/shipments/${shipment.id}/decision`));
  await decision.getByRole("button", { name: "Approve shipment", exact: true }).click();
  expect((await approval).status()).toBe(200); await ready(manager);
  evidence.stage = "approved"; await checkpoint();
  }
  const approved = await crosschecks(manager);
  const approvedWeight = approved.latestRun.results.find((check: { ruleKey: string }) => check.ruleKey === "gross_weight_comparison");
  expect(approvedWeight.status).toBe("MISMATCH"); expect(approvedWeight.derivedStatus).toBe("HUMAN_CLEARED");
  evidence.approvedRevision = revision;
  evidence.approvedWeight = { status: approvedWeight.status, derivedStatus: approvedWeight.derivedStatus };
  checks.push("Executive 403, stale Manager 409, rejection/resubmission/approval and real sign-off; weight stays MISMATCH");

  if (before("exported")) {
  await manager.getByRole("button", { name: "Export preview", exact: true }).click();
  const exportDialog = manager.getByTestId("export-preview-dialog");
  await expect(exportDialog.getByRole("heading", { name: "Server preflight allows export" })).toBeVisible();
  const preflight = await (await manager.request.get(`/api/shipments/${shipment.id}/export?preview=1`)).json();
  evidence.previewChecksum = preflight.checksumSha256;
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) { await manager.setViewportSize({ width, height }); await capture(manager, `export-ready-${width}`); }
  await manager.route(`**/api/shipments/${shipment.id}/export`, async (route) => {
    const response = await route.fetch();
    const bytes = Buffer.from(await response.body()); bytes[bytes.length - 1] ^= 1;
    await route.fulfill({ response, body: bytes });
  });
  let downloads = 0; manager.on("download", () => { downloads++; });
  await exportDialog.getByRole("button", { name: "Download guarded CSV", exact: true }).click();
  await expect(exportDialog.getByText(/No file was downloaded/)).toBeVisible();
  expect(downloads).toBe(0);
  await expect(exportDialog.getByRole("button", { name: /^(Re-download CSV|Download guarded CSV)$/ })).toBeDisabled();
  await expect(exportDialog.getByRole("heading", { name: "Most recent server export" })).toBeVisible();
  await manager.unroute(`**/api/shipments/${shipment.id}/export`);
  await exportDialog.getByRole("button", { name: "Refresh preflight", exact: true }).click();
  await expect(exportDialog.getByRole("button", { name: "Re-download CSV", exact: true })).toBeEnabled();
  const downloaded = manager.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Re-download CSV", exact: true }).click();
  const download = await downloaded;
  await download.saveAs(`${out}/verified-export.csv`);
  const bytes = await readFile(`${out}/verified-export.csv`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(hash).toBe(preflight.checksumSha256);
  evidence.download = { fileName: download.suggestedFilename(), bytes: bytes.length, sha256: hash };
  evidence.stage = "exported"; await checkpoint();
  await expect(exportDialog.getByText("CSV download started. The server export receipt is shown below.", { exact: true })).toBeVisible();
  await exportDialog.getByRole("button", { name: "Copy checksum", exact: true }).click();
  await exportDialog.getByRole("button", { name: "Close export preview" }).click();
  const lockedField = approved.latestRun.inputSnapshot;
  evidence.hasImmutableSnapshot = Boolean(lockedField);
  checks.push("tampered CSV refused without download, real receipt retained, fresh preflight and actual file SHA-256 verified");
  }
  const final = await crosschecks(manager);
  expect(final.currentRevision).toBe(revision);
  const verificationDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
  try {
    const saved = await verificationDb.shipment.findFirstOrThrow({ where: { id: shipment.id, reference, createdBy: { email: executiveEmail } }, include: { exportEvents: true, approvals: true } });
    expect(saved.status).toBe("EXPORTED");
    expect(saved.currentRevision).toBe(revision);
    expect(saved.exportEvents.length).toBeGreaterThanOrEqual(2);
    evidence.finalStatus = saved.status;
    evidence.serverExportIds = saved.exportEvents.map((event) => event.id);
    evidence.approvalIds = saved.approvals.map((approval) => approval.id);
    evidence.preservedPriorShipments = await verificationDb.shipment.findMany({ where: { id: { in: ["a35fb03a-46c3-426a-8440-13cdfc19cc51"] } }, select: { id: true, reference: true, currentRevision: true, status: true } });
  } finally { await verificationDb.$disconnect(); }

  await page.goto("/reports");
  const realReport = await (await page.request.get("/api/reports/accuracy")).json();
  await expect(page.getByRole("heading", { name: "Extraction & supplier reports", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Measured extraction results" })).toContainText(realReport.summary.accuracy.formattedPercentage);
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) { await page.setViewportSize({ width, height }); await capture(page, `reports-${width}`); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width); }
  await page.getByRole("tab", { name: /^By supplier/ }).click();
  await page.getByLabel("Search suppliers").fill("Synthetic Review QA Supplier");
  await expect(page.getByRole("region", { name: "Scrollable suppliers report" })).toContainText("Synthetic Review QA Supplier");
  await page.getByLabel("Search suppliers").fill("NO-SUCH-SUPPLIER-QA");
  await expect(page.getByRole("region", { name: "Scrollable suppliers report" }).getByText("No matching report groups", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("tab", { name: "Method & targets", exact: true }).click();
  await expect(page.getByText("Target not claimed", { exact: true })).toBeVisible();
  await page.route("**/api/reports/accuracy", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh report", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("previous snapshot remains");
  await page.unroute("**/api/reports/accuracy");
  await page.getByRole("button", { name: "Retry report", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  const anonymous = await browser.newContext();
  const anon = await anonymous.newPage();
  expect((await anon.request.get("/api/reports/accuracy")).status()).toBe(401);
  expect((await anon.request.get(`/api/shipments/${shipment.id}/export?preview=1`)).status()).toBe(401);
  await anonymous.close(); await managerContext.close();
  checks.push("report agrees with real role-scoped metrics; supplier search, no-match reset, method/targets, failed refresh and real recovery; anonymous 401");
  expect(errors).toEqual([]);
  evidence.finalRevision = final.currentRevision;
  await checkpoint();
  } finally { await checkpoint(); }
});
