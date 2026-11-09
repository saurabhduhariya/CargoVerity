import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Week 2 definition of done, in the browser: CI/PL/BL can be uploaded, replaced and viewed by an
 * authorized user; invalid files are rejected server-side with plain-language errors; synthetic
 * samples load through the same private storage path. Uses synthetic files only.
 */
const accounts = [
  { email: process.env.PLAYWRIGHT_E2E_EMAIL, password: process.env.PLAYWRIGHT_E2E_PASSWORD },
  { email: process.env.PLAYWRIGHT_MANAGER_EMAIL, password: process.env.PLAYWRIGHT_MANAGER_PASSWORD },
].filter((account) => account.email && account.password);
const account = accounts[0];

test.skip(!account, "Set PLAYWRIGHT_E2E_* or PLAYWRIGHT_MANAGER_* credentials for the upload E2E flow.");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const samplePdf = (name: string) => readFileSync(join(process.cwd(), "public", "sample-docs", name));

async function loginAndCreateShipment(page: Page, reference: string) {
  // On a cold dev server the first /login load can be reloaded by Fast Refresh right after it
  // hydrates; a click on the not-yet-hydrated form then does a native reload. Retry the login.
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/login");
    await page.waitForFunction(() => {
      const form = document.querySelector("form");
      return Boolean(form && Object.keys(form).some((key) => key.startsWith("__reactProps")));
    });
    await page.getByLabel("Email").fill(account!.email!);
    await page.getByLabel("Password", { exact: true }).fill(account!.password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }

  await page.getByRole("button", { name: "New shipment", exact: true }).click();
  await page.locator("input#reference").fill(reference);
  await page.getByRole("button", { name: /create shipment/i }).click();
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

test("upload, reject, replace and preview a document through private storage", async ({ page, browser }) => {
  await loginAndCreateShipment(page, `E2E-UPLOAD-${Date.now()}`);
  const invoiceSlot = page.getByTestId("slot-INVOICE");

  // Limits come from server configuration.
  await expect(page.getByTestId("upload-limits-INVOICE")).toHaveText(/PDF up to .* MB and \d+ pages/);

  // A text file renamed to .pdf passes the browser check but is rejected by the server's magic-byte check.
  await invoiceSlot.locator("#file-input-INVOICE").setInputFiles({
    name: "not-really.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("plain text pretending to be a PDF"),
  });
  await invoiceSlot.getByRole("button", { name: "Upload Document", exact: true }).click();
  await expect(invoiceSlot.getByText(/genuine PDF or image/)).toBeVisible({ timeout: 30_000 });
  await expect(invoiceSlot.getByText("Version 1", { exact: true })).toHaveCount(0);

  // A real (synthetic) PDF uploads directly to Storage and becomes version 1.
  const completion = page.waitForResponse((r) => r.url().endsWith("/documents/complete") && r.request().method() === "POST");
  await invoiceSlot.locator("#file-input-INVOICE").setInputFiles({
    name: "shp-24811-invoice.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf("shp-24811-invoice.pdf"),
  });
  await invoiceSlot.getByRole("button", { name: "Upload Document", exact: true }).click();
  const completed = await completion;
  expect(completed.status()).toBe(201);
  const documentId = (await completed.json()).document.id as string;
  await expect(invoiceSlot.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(page.getByText("rev 2").first()).toBeVisible();

  // Replacement needs explicit confirmation and produces version 2.
  await invoiceSlot.getByRole("button", { name: "Replace", exact: true }).click();
  await invoiceSlot.locator("#file-input-INVOICE").setInputFiles({
    name: "shp-24812-invoice.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf("shp-24812-invoice.pdf"),
  });
  await invoiceSlot.getByRole("button", { name: "Upload Replacement", exact: true }).click();
  await expect(invoiceSlot.getByText(/check the confirmation box/)).toBeVisible();
  await invoiceSlot.getByLabel("Confirm document replacement").check();
  await invoiceSlot.getByRole("button", { name: "Upload Replacement", exact: true }).click();
  await expect(invoiceSlot.getByText("Version 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("rev 3").first()).toBeVisible();

  // Preview opens a short-lived signed URL for the current version.
  // (Headless Chromium downloads PDFs instead of rendering them, so check the URL the button used.)
  const previewResponse = page.waitForResponse((r) => /\/api\/documents\/[0-9a-f-]+$/.test(r.url()));
  const popupPromise = page.waitForEvent("popup");
  await invoiceSlot.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = await previewResponse;
  expect(preview.status()).toBe(200);
  expect(preview.headers()["cache-control"]).toContain("no-store");
  const { signedUrl, document: previewed } = await preview.json();
  expect(previewed.documentVersion).toBe(2);
  expect(signedUrl).toMatch(/\/storage\/v1\/object\/sign\/.+token=/);
  const file = await page.request.get(signedUrl);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await (await popupPromise).close();

  // A logged-out browser cannot obtain a URL for the stored file.
  const anonymous = await browser.newContext();
  const denied = await anonymous.request.get(`/api/documents/${documentId}`);
  expect(denied.status()).toBe(401);
  await anonymous.close();
});

test("loads a sample scenario into all three slots", async ({ page }) => {
  await loginAndCreateShipment(page, `E2E-SAMPLE-${Date.now()}`);

  await page.locator("summary", { hasText: "Load sample documents" }).click();
  await page.getByLabel("Sample scenario").selectOption("SHP-24811");
  await page.getByRole("button", { name: "Load sample documents" }).click();

  await expect(page.getByText(/SHP-24811 sample documents loaded/)).toBeVisible({
    timeout: 60_000,
  });
  for (const slot of ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"]) {
    await expect(page.getByTestId(`slot-${slot}`).getByText("Version 1", { exact: true })).toBeVisible();
  }
  await expect(page.getByText("rev 2").first()).toBeVisible();

  // Loading the same scenario again is rejected instead of creating duplicate versions.
  await page.getByRole("button", { name: "Load sample documents" }).click();
  await expect(page.getByText("These sample documents are already loaded for this shipment.")).toBeVisible();
});
