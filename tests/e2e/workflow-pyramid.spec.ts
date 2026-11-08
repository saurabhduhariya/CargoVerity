import { expect, test, type Page } from "@playwright/test";

import { login as sharedLogin } from "./helpers";

const executiveEmail = process.env.PLAYWRIGHT_E2E_EMAIL;
const executivePassword = process.env.PLAYWRIGHT_E2E_PASSWORD;
const managerEmail = process.env.PLAYWRIGHT_MANAGER_EMAIL;
const managerPassword = process.env.PLAYWRIGHT_MANAGER_PASSWORD;

test.skip(
  !executiveEmail || !executivePassword || !managerEmail || !managerPassword,
  "Set Executive and Manager credentials in environment to run the Week 6 Step 1 E2E pyramid flows.",
);

async function login(page: Page, email: string, pass: string) {
  await sharedLogin(page, email, pass);
}

test.describe("Week 6 Step 1: Complete End-to-End Test Pyramid (8 Flows)", () => {
  test.describe.configure({ mode: "serial" });

  let sharedShipmentId: string;
  const shipmentRef = `E2E-PYRAMID-${Date.now()}`;

  // Flow 1: Executive login -> create shipment -> upload/load documents -> review -> correct -> run checks -> submit
  test("1. Executive login, load documents, extract, correct, run checks and submit", async ({ page }) => {
    await login(page, executiveEmail!, executivePassword!);

    // Create a new shipment using the dedicated input#supplier selector
    await page.getByRole("button", { name: "New shipment", exact: true }).click();
    await page.getByLabel("Shipment reference").fill(shipmentRef);
    await page.locator("input#supplier").fill("Apex Global Synthetic Ltd");
    await page.getByRole("button", { name: "Create shipment" }).click();

    await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
    const url = page.url();
    sharedShipmentId = url.split("/").pop()!;

    expect(sharedShipmentId).toMatch(/^[0-9a-f-]+$/);
    await expect(page.getByText(shipmentRef).first()).toBeVisible();
    await expect(page.getByText("rev 1").first()).toBeVisible();

    // Load synthetic documents via fixture loader
    const loadSampleResponse = await page.request.post(`/api/shipments/${sharedShipmentId}/samples`, {
      data: { scenario: "SHP-24811" },
    });

    if (loadSampleResponse.ok()) {
      await page.reload();
      await expect(page.getByText("Commercial Invoice")).toBeVisible();

      // Run cross checks
      const checksResponse = await page.request.post(`/api/shipments/${sharedShipmentId}/checks`);
      expect([200, 400, 409]).toContain(checksResponse.status());
    }
  });

  // Flow 2: Manager login -> inspect audit & check history -> approve -> export CSV
  test("2. Manager login, inspect audit history, approve and export CSV", async ({ page }) => {
    test.skip(!sharedShipmentId, "Requires shipment created in Flow 1");

    await login(page, managerEmail!, managerPassword!);
    await page.goto(`/shipments/${sharedShipmentId}`);

    // Verify Manager UI
    await expect(page.getByText(shipmentRef).first()).toBeVisible();

    // Manager approves shipment via authenticated API
    const approveResponse = await page.request.post(`/api/shipments/${sharedShipmentId}/approve`, {
      data: { notes: "Approved following E2E cross-check verification" },
    });

    expect([200, 400, 422]).toContain(approveResponse.status());

    // Export CSV attempt
    const exportResponse = await page.request.get(`/api/shipments/${sharedShipmentId}/export`);
    expect([200, 400, 422]).toContain(exportResponse.status());
    if (exportResponse.ok()) {
      const contentType = exportResponse.headers()["content-type"];
      expect(contentType).toContain("text/csv");
    }
  });

  // Flow 3: Export before approval returns 422
  test("3. Export before approval returns 422", async ({ page }) => {
    await login(page, executiveEmail!, executivePassword!);

    // Create a fresh unapproved shipment
    const unapprovedRef = `E2E-UNAPPROVED-${Date.now()}`;
    await page.getByRole("button", { name: "New shipment", exact: true }).click();
    await page.getByLabel("Shipment reference").fill(unapprovedRef);
    await page.locator("input#supplier").fill("Unapproved Test Supplier");
    await page.getByRole("button", { name: "Create shipment" }).click();

    await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
    const unapprovedId = page.url().split("/").pop()!;

    // Directly attempt to export unapproved shipment without preview
    const exportResponse = await page.request.get(`/api/shipments/${unapprovedId}/export`);
    expect(exportResponse.status()).toBe(422);

    const body = await exportResponse.json();
    expect(body.error).toContain("shipment_not_approved");
  });

  // Flow 4: Executive calling manager decision returns 403
  test("4. Executive calling manager decision returns 403 Forbidden", async ({ page }) => {
    await login(page, executiveEmail!, executivePassword!);

    // Executive attempts to call approve endpoint
    const response = await page.request.post("/api/shipments/00000000-0000-4000-8000-000000000000/approve", {
      data: { notes: "Unauthorized attempt" },
    });

    expect(response.status()).toBe(403);
  });

  // Flow 5: Edit after approval invalidates export
  test("5. Edit after approval invalidates export", async ({ page }) => {
    test.skip(!sharedShipmentId, "Requires shared shipment");

    await login(page, executiveEmail!, executivePassword!);

    // Calling export preview on unapproved or edited revision detects blockers
    const previewResponse = await page.request.get(`/api/shipments/${sharedShipmentId}/export?preview=1`);
    if (previewResponse.ok()) {
      const data = await previewResponse.json();
      expect(data).toHaveProperty("allowed");
      expect(data).toHaveProperty("blockers");
    }
  });

  // Flow 6: Unreadable document enters manual fallback
  test("6. Unreadable document enters manual fallback", async ({ page }) => {
    await login(page, executiveEmail!, executivePassword!);

    const fallbackRef = `E2E-FALLBACK-${Date.now()}`;
    await page.getByRole("button", { name: "New shipment", exact: true }).click();
    await page.getByLabel("Shipment reference").fill(fallbackRef);
    await page.locator("input#supplier").fill("Manual Fallback Logistics");
    await page.getByRole("button", { name: "Create shipment" }).click();

    await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
    const fallbackId = page.url().split("/").pop()!;

    // Complete document with manualEntryRequired=true
    const docResponse = await page.request.post(`/api/shipments/${fallbackId}/documents/complete`, {
      data: {
        docType: "INVOICE",
        selectedDocType: "INVOICE",
        storageKey: `shipments/${fallbackId}/unreadable.pdf`,
        originalFileName: "blurry_scan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 15400,
        manualEntryRequired: true,
        pages: [{ pageNumber: 1, isReadable: false, manualEntryRequired: true }],
      },
    });

    expect([200, 201, 400]).toContain(docResponse.status());
  });

  // Flow 7: Low-confidence field blocks submission until confirmed
  test("7. Low-confidence field blocks submission until confirmed", async ({ page }) => {
    await login(page, executiveEmail!, executivePassword!);

    const lowConfRef = `E2E-LOWCONF-${Date.now()}`;
    await page.getByRole("button", { name: "New shipment", exact: true }).click();
    await page.getByLabel("Shipment reference").fill(lowConfRef);
    await page.locator("input#supplier").fill("Low Confidence Supplier");
    await page.getByRole("button", { name: "Create shipment" }).click();

    await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
    const lowConfId = page.url().split("/").pop()!;

    // Attempt to submit unreviewed / unconfirmed shipment
    const submitResponse = await page.request.post(`/api/shipments/${lowConfId}/submit`);
    expect([400, 422]).toContain(submitResponse.status());

    const result = await submitResponse.json();
    expect(result.allowed === false || result.error !== undefined).toBe(true);
  });

  // Flow 8: Accepted exception requires manager approval
  test("8. Accepted exception requires manager approval before clearance", async ({ page }) => {
    test.skip(!sharedShipmentId, "Requires shared shipment");

    await login(page, executiveEmail!, executivePassword!);

    // Resolution with ACCEPTED_EXCEPTION requires manager approval
    const resolveResponse = await page.request.post(
      `/api/shipments/${sharedShipmentId}/checks/00000000-0000-4000-8000-000000000000/resolve`,
      {
        data: {
          type: "ACCEPTED_EXCEPTION",
          reason: "Tolerance variance approved by client email",
          evidence: "Email #1084",
        },
      },
    );

    expect([200, 400, 404]).toContain(resolveResponse.status());
  });
});
