import { expect, test } from "@playwright/test";

const email = process.env.PLAYWRIGHT_E2E_EMAIL;
const password = process.env.PLAYWRIGHT_E2E_PASSWORD;

test.skip(!email || !password, "Set PLAYWRIGHT_E2E_EMAIL and PLAYWRIGHT_E2E_PASSWORD for the authenticated E2E flow.");

test("login, create shipment and open its detail queue", async ({ page }) => {
  const reference = `E2E-${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.locator("input#reference").fill(reference);
  await page.locator("input#supplier").fill("Synthetic E2E Supplier");
  await page.getByRole("button", { name: /create shipment/i }).click();

  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]+$/);
  await expect(page.getByText(reference).first()).toBeVisible();
  await expect(page.getByText("Synthetic E2E Supplier").first()).toBeVisible();
  await expect(page.getByText("rev 1").first()).toBeVisible();
});
