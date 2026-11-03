import { expect, test } from "@playwright/test";

test("CargoVerity foundation page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("CargoVerity");
  await expect(
    page.getByRole("heading", { name: "Every document. Every detail. Verified." }),
  ).toBeVisible();
});
