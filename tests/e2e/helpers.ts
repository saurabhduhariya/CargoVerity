import { expect, type Page } from "@playwright/test";

/**
 * Waits until React has hydrated the login form. On a cold `next dev` server the first page load
 * can be refreshed by Fast Refresh right after it renders; a click before hydration does a
 * native form GET to "/login?" instead of signing in.
 */
export async function waitForLoginForm(page: Page) {
  await page.goto("/login");
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return Boolean(form && Object.keys(form).some((key) => key.startsWith("__reactProps")));
  });
}

/** Signs in through the real form, retrying only the hydration race (never a wrong password). */
export async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  for (let attempt = 1; ; attempt += 1) {
    await waitForLoginForm(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt >= 3 || !page.url().endsWith("/login?")) throw error;
    }
  }
}
