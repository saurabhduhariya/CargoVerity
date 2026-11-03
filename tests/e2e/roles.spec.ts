import { expect, test } from "@playwright/test";

const executiveEmail = process.env.PLAYWRIGHT_E2E_EMAIL;
const executivePassword = process.env.PLAYWRIGHT_E2E_PASSWORD;
const managerEmail = process.env.PLAYWRIGHT_MANAGER_EMAIL;
const managerPassword = process.env.PLAYWRIGHT_MANAGER_PASSWORD;

test.skip(
  !executiveEmail || !executivePassword || !managerEmail || !managerPassword,
  "Set Executive and Manager Playwright credentials for role-bound E2E checks.",
);

test("an Executive cannot call the Manager approval route", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(executiveEmail!);
  await page.getByLabel("Password").fill(executivePassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const response = await page.request.post("/api/shipments/00000000-0000-4000-8000-000000000000/approve");
  expect(response.status()).toBe(403);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(managerEmail!);
  await page.getByLabel("Password").fill(managerPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const managerResponse = await page.request.get("/api/shipments");
  expect(managerResponse.status()).toBe(200);
});
