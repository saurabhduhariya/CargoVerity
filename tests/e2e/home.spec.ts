import { expect, test } from "@playwright/test";

import { waitForLoginForm } from "./helpers";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

test("CargoVerity foundation page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("CargoVerity");
  await expect(
    page.getByRole("heading", { name: "Stop retyping what the PDF already says." }),
  ).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`review preview compares and corrects only local sample data at ${width}px`, async ({ page }) => {
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        mutations.push(`${request.method()} ${request.url()}`);
      }
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const preview = page.getByRole("region", { name: "Interactive review example" });
    await expect(preview.getByText("Needs review", { exact: true })).toBeVisible();
    await expect(preview.getByText("3,210", { exact: true })).toBeVisible();

    await preview.getByRole("tab", { name: "Packing list", exact: true }).click();
    await expect(preview.getByRole("figure", { name: "Packing list synthetic source, page 1" })).toBeVisible();
    await expect(preview.getByRole("tabpanel").getByText("Matches source", { exact: true })).toBeVisible();
    await preview.getByRole("tab", { name: "Bill of lading", exact: true }).click();
    await expect(preview.getByRole("figure", { name: "Bill of lading synthetic source, page 1" })).toBeVisible();
    await preview.getByRole("button", { name: "Compare with invoice", exact: true }).click();
    await expect(preview.getByRole("tab", { name: "Invoice", exact: true })).toBeFocused();
    await expect(preview.getByText("Source: 3,120 kg. Two digits were transposed.")).toBeVisible();
    await expect(preview.getByText("3,210", { exact: true })).toBeVisible();

    await preview.getByRole("button", { name: "Use source value", exact: true }).click();
    await expect(preview.getByText("Corrected by you", { exact: true })).toBeVisible();
    await expect(preview.getByText("Original: 3,210 kg. The packing list still differs by 45 kg.")).toBeVisible();
    await expect(preview.getByText("Cross-document difference", { exact: true })).toBeVisible();
    await expect(preview.getByText("45 kg", { exact: true })).toBeVisible();
    await expect(preview.getByRole("status")).toContainText("No shipment was changed.");
    await preview.getByRole("tab", { name: "Packing list", exact: true }).click();
    await expect(preview.getByRole("tabpanel").getByText("This document reads 3,165 kg. The invoice source reads 3,120 kg.")).toBeVisible();
    await preview.getByRole("button", { name: "View corrected invoice", exact: true }).click();
    await expect(preview.getByRole("status")).toContainText("original sample extraction was 3,210 kg");
    await expect(preview.getByText("Corrected by you", { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(preview.getByRole("button", { name: "Compare with source", exact: true })).toBeVisible();
    await expect(preview.getByText("3,210", { exact: true })).toBeVisible();
    expect(mutations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("review preview supports keyboard document switching and explicit review", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByRole("region", { name: "Interactive review example" });
  const invoice = preview.getByRole("tab", { name: "Invoice", exact: true });
  await invoice.focus();
  await page.keyboard.press("ArrowRight");
  await expect(preview.getByRole("tab", { name: "Packing list", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(preview.getByRole("tab", { name: "Bill of lading", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(invoice).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(preview.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(preview.getByRole("button", { name: "Compare with source", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(preview.getByRole("button", { name: "Use source value", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(preview.getByText("Corrected by you", { exact: true })).toBeVisible();
});

test("review preview keeps enlarged document labels inside their tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const preview = page.getByRole("region", { name: "Interactive review example" });
  await expect(preview).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  for (const label of ["Invoice", "Packing list", "Bill of lading"]) {
    await preview.getByRole("tab", { name: label, exact: true }).click();
    expect(await preview.getByRole("tab").evaluateAll((tabs) => tabs.every((tab) => {
      const label = tab.querySelector("span")!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const box = tab.getBoundingClientRect();
      return [...range.getClientRects()].every((rect) => rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom);
    }))).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("login page renders its sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("login page shows the session-expired and not-provisioned states", async ({ page }) => {
  await page.goto("/login?reason=session-expired");
  await expect(page.getByTestId("login-message")).toHaveText(/session has expired/i);

  await page.goto("/login?reason=not-provisioned");
  await expect(page.getByTestId("login-message")).toHaveText(/no CargoVerity role/i);

  await page.goto("/login?reason=unknown-value");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByTestId("login-message")).toHaveCount(0);
});

test("unauthenticated API requests are rejected with 401", async ({ request }) => {
  test.skip(!supabaseConfigured, "Requires Supabase configuration.");

  const list = await request.get("/api/shipments");
  expect(list.status()).toBe(401);
  await expect(list.json()).resolves.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

  const create = await request.post("/api/shipments", { data: { reference: "E2E-NOAUTH" } });
  expect(create.status()).toBe(401);

  const approve = await request.post("/api/shipments/00000000-0000-4000-8000-000000000000/approve");
  expect(approve.status()).toBe(401);
});

test("unauthenticated protected pages redirect to login with a return path", async ({ page }) => {
  test.skip(!supabaseConfigured, "Requires Supabase configuration.");

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();

  await page.goto("/reports");
  await expect(page).toHaveURL(/\/login\?next=%2Freports$/);

  await page.goto("/shipments/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/login\?next=%2Fshipments%2F00000000-0000-4000-8000-000000000000$/);
});

test("invalid credentials show a fixed error message", async ({ page }) => {
  test.skip(!supabaseConfigured, "Requires Supabase configuration.");

  await waitForLoginForm(page);
  await page.getByLabel("Email").fill("no-such-user@example.test");
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("login-message")).toHaveText(
    /Email or password is incorrect\.|Too many attempts/,
  );
  await expect(page).toHaveURL(/\/login$/);
});
