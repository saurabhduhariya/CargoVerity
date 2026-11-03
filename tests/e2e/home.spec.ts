import { expect, test } from "@playwright/test";

test("CargoVerity foundation page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("CargoVerity");
  await expect(
    page.getByRole("heading", { name: "Every document. Every detail. Verified." }),
  ).toBeVisible();
});

test("authentication and setup states are reachable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to the workbench" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Configure Supabase before signing in|Sign in to the workbench/ }),
  ).toBeVisible();
});
