import { expect, test } from "@playwright/test";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

test("CargoVerity foundation page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("CargoVerity");
  await expect(
    page.getByRole("heading", { name: "Every document. Every detail. Verified." }),
  ).toBeVisible();
});

test("login page renders its sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to the workbench" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("login page shows the session-expired and not-provisioned states", async ({ page }) => {
  await page.goto("/login?reason=session-expired");
  await expect(page.getByTestId("login-message")).toHaveText(/session has expired/i);

  await page.goto("/login?reason=not-provisioned");
  await expect(page.getByTestId("login-message")).toHaveText(/no CargoVerity role/i);

  await page.goto("/login?reason=unknown-value");
  await expect(page.getByRole("heading", { name: "Sign in to the workbench" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Sign in to the workbench" })).toBeVisible();

  await page.goto("/reports");
  await expect(page).toHaveURL(/\/login\?next=%2Freports$/);

  await page.goto("/shipments/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/login\?next=%2Fshipments%2F00000000-0000-4000-8000-000000000000$/);
});

test("invalid credentials show a fixed error message", async ({ page }) => {
  test.skip(!supabaseConfigured, "Requires Supabase configuration.");

  await page.goto("/login");
  await page.getByLabel("Email").fill("no-such-user@example.test");
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("login-message")).toHaveText(
    /Email or password is incorrect\.|Too many attempts/,
  );
  await expect(page).toHaveURL(/\/login$/);
});
