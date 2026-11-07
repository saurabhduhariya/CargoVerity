import { expect, test } from "@playwright/test";

/**
 * Week 1 Step 6.7: login -> create shipment -> see it in the database-backed queue.
 * Runs as the Executive when PLAYWRIGHT_E2E_* is set, otherwise as the Manager account.
 * Shipment creation is allowed for both roles; the role-specific checks live in roles.spec.ts.
 */
const accounts = [
  { label: "Executive", email: process.env.PLAYWRIGHT_E2E_EMAIL, password: process.env.PLAYWRIGHT_E2E_PASSWORD },
  { label: "Manager", email: process.env.PLAYWRIGHT_MANAGER_EMAIL, password: process.env.PLAYWRIGHT_MANAGER_PASSWORD },
].filter((account) => account.email && account.password);

const account = accounts[0];

test.skip(!account, "Set PLAYWRIGHT_E2E_* or PLAYWRIGHT_MANAGER_* credentials for the authenticated E2E flow.");

test(`login, create shipment, open its detail page and see it in the queue (${account?.label ?? "none"})`, async ({ page }) => {
  const reference = `E2E-${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Email").fill(account!.email!);
  await page.getByLabel("Password").fill(account!.password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("current-role")).toHaveText(account!.label);

  await page.locator("input#reference").fill(reference);
  await page.locator("input#supplier").fill("Synthetic E2E Supplier");
  await page.getByRole("button", { name: /create shipment/i }).click();

  // Redirect to the detail route with status and revision.
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
  await expect(page.getByText(reference).first()).toBeVisible();
  await expect(page.getByText("Synthetic E2E Supplier").first()).toBeVisible();
  await expect(page.getByText("rev 1").first()).toBeVisible();

  // The new shipment appears in the database-backed queue.
  await page.goto("/dashboard");
  await page.getByPlaceholder("Search reference or supplier...").fill(reference);
  await expect(page.getByText(reference).first()).toBeVisible();

  // A duplicate reference is rejected with the safe conflict message.
  const duplicate = await page.request.post("/api/shipments", { data: { reference } });
  expect(duplicate.status()).toBe(409);
  await expect(duplicate.json()).resolves.toMatchObject({
    error: "That shipment reference already exists. Choose a unique reference.",
  });

  // Sign out ends the session: the API rejects the request afterwards.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  const afterSignOut = await page.request.get("/api/shipments");
  expect(afterSignOut.status()).toBe(401);
});
