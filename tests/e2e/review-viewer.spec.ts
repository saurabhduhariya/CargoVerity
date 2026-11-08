import { expect, test, type Page } from "@playwright/test";

import { login } from "./helpers";

/**
 * Week 4 Step 6 in the browser: the review workspace renders PDFs on a PDF.js canvas (no iframe),
 * page / zoom / rotate controls change what is drawn, a failed signed URL shows an error with
 * Retry, and the Document / Fields / Checks tabs work on a phone-sized viewport.
 * Uses the synthetic SHP-24811 documents only.
 */
const account =
  process.env.PLAYWRIGHT_E2E_EMAIL && process.env.PLAYWRIGHT_E2E_PASSWORD
    ? { email: process.env.PLAYWRIGHT_E2E_EMAIL, password: process.env.PLAYWRIGHT_E2E_PASSWORD }
    : null;

test.skip(!account, "Set PLAYWRIGHT_E2E_* credentials for the review viewer E2E flow.");
test.describe.configure({ mode: "serial", timeout: 180_000 });

let shipmentId: string | null = null;

async function ensureShipmentWithDocuments(page: Page) {
  await login(page, account!.email, account!.password);
  if (shipmentId) return shipmentId;

  await page.getByRole("button", { name: "New shipment", exact: true }).click();
  await page.locator("input#reference").fill(`E2E-VIEWER-${Date.now()}`);
  await page.getByRole("button", { name: /create shipment/i }).click();
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/, { timeout: 30_000 });
  shipmentId = page.url().split("/").pop()!;

  await page.getByText("Load sample documents", { exact: true }).click();
  await page.getByLabel("Sample scenario").selectOption("SHP-24811");
  await page.getByRole("button", { name: "Load sample documents" }).click();
  await expect(page.getByText(/SHP-24811 sample documents loaded/)).toBeVisible({ timeout: 60_000 });
  return shipmentId;
}

/** Canvas size and whether any pixel differs from the first one (i.e. something was drawn). */
async function canvasState(page: Page) {
  return page.getByTestId("pdf-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return { width: canvas.width, height: canvas.height, drawn: false };
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let drawn = false;
    for (let index = 4; index < data.length; index += 4 * 97) {
      if (data[index] !== data[0] || data[index + 1] !== data[1] || data[index + 2] !== data[2]) {
        drawn = true;
        break;
      }
    }
    return { width: canvas.width, height: canvas.height, drawn };
  });
}

async function waitForRender(page: Page) {
  await expect(page.getByTestId("document-viewer").locator("p[aria-live]")).toHaveText(/Showing page/, { timeout: 60_000 });
}

test("renders the PDF on a non-blank canvas without an iframe; zoom and rotate redraw it", async ({ page }) => {
  const id = await ensureShipmentWithDocuments(page);
  await page.goto(`/review/${id}`);

  await waitForRender(page);
  await expect(page.locator("iframe")).toHaveCount(0);
  const initial = await canvasState(page);
  expect(initial.width).toBeGreaterThan(0);
  expect(initial.height).toBeGreaterThan(0);
  expect(initial.drawn).toBe(true);

  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await waitForRender(page);
  const zoomed = await canvasState(page);
  expect(zoomed.width).toBeGreaterThan(initial.width);

  await page.getByRole("button", { name: "Rotate document 90 degrees", exact: true }).click();
  await waitForRender(page);
  const rotated = await canvasState(page);
  // A portrait page rotated 90 degrees becomes landscape.
  expect(rotated.width > rotated.height).not.toBe(zoomed.width > zoomed.height);
  expect(rotated.drawn).toBe(true);

  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("aria-label", /page 1 of \d+/);
});

test("a failed document URL shows an error state and Retry fetches a fresh link", async ({ page }) => {
  const id = await ensureShipmentWithDocuments(page);
  let blocked = true;
  await page.route(/\/storage\/v1\/object\/sign\//, async (route) => {
    if (blocked) await route.abort();
    else await route.continue();
  });

  await page.goto(`/review/${id}`);
  await expect(page.getByRole("alert").filter({ hasText: "Private document unavailable" })).toBeVisible({ timeout: 60_000 });

  blocked = false;
  const fresh = page.waitForResponse((response) => /\/api\/documents\/[0-9a-f-]+$/.test(response.url()));
  await page.getByRole("button", { name: "Retry secure document", exact: true }).click();
  expect((await fresh).status()).toBe(200);
  await waitForRender(page);
  expect((await canvasState(page)).drawn).toBe(true);
});

test("Document / Fields / Checks tabs work on a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await ensureShipmentWithDocuments(page);
  await page.goto(`/review/${id}`);

  const viewerSection = page.getByRole("region", { name: "Document evidence viewer" });
  await expect(page.getByTestId("review-workspace")).toHaveAttribute("data-layout", "mobile");
  await page.getByRole("tab", { name: "Document", exact: true }).click();
  await expect(viewerSection).toBeVisible();
  await waitForRender(page);

  await page.getByRole("tab", { name: /^Review/ }).click();
  await page.getByRole("tab", { name: /^Checks/ }).click();
  await expect(viewerSection).toBeHidden();
  await expect(page.getByRole("heading", { name: "Cross-checks", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /^Fields/ }).click();
  await expect(page.getByRole("heading", { name: "Cross-checks", exact: true })).toBeHidden();
});
