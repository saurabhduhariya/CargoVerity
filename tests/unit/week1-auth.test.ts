import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Week 1 Step 4 tests: unauthenticated page/API access, valid Executive and Manager sessions,
 * Executive access to Manager-only routes, the browser never choosing its own role, and the
 * login redirect/session-expired states.
 */

const getClaims = vi.fn();
const exchangeCodeForSession = vi.fn();
const cookieNames: string[] = [];
const prisma = {
  user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  shipment: { findMany: vi.fn() },
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims, exchangeCodeForSession } }),
  createSupabaseAdminClient: () => {
    throw new Error("Admin client must not be used by auth helpers.");
  },
}));
vi.mock("@/lib/db", () => ({ getPrisma: () => prisma }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieNames.map((name) => ({ name, value: "x" })) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: path });
  },
}));

const { requireAppUser, requireRole } = await import("@/lib/auth");
const { requirePageAppUser, hasSupabaseAuthCookie } = await import("@/lib/auth-page");
const { buildLoginPath, parseLoginReason, safeNextPath } = await import("@/lib/auth-paths");
const { describeAuthError } = await import("@/lib/auth-messages");
const { apiError } = await import("@/lib/api-response");
const shipmentsRoute = await import("@/app/api/shipments/route");
const approveRoute = await import("@/app/api/shipments/[id]/approve/route");
const decisionRoute = await import("@/app/api/shipments/[id]/decision/route");
const callbackRoute = await import("@/app/auth/callback/route");
const { ConfigurationError } = await import("@/lib/errors");

const EXECUTIVE = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "exec@example.test",
  fullName: "Synthetic Executive",
  role: "EXECUTIVE" as const,
};
const MANAGER = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "manager@example.test",
  fullName: "Synthetic Manager",
  role: "MANAGER" as const,
};

function signedInAs(user: { id: string; email: string }, metadata: Record<string, unknown> = {}) {
  getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, email: user.email, user_metadata: metadata, app_metadata: {} } },
    error: null,
  });
}

function signedOut() {
  getClaims.mockResolvedValue({ data: null, error: null });
}

async function redirectTarget(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { redirectTo?: string }).redirectTo;
  }
  throw new Error("Expected a redirect.");
}

const params = { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) };

beforeEach(() => {
  vi.clearAllMocks();
  cookieNames.length = 0;
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.shipment.findMany.mockResolvedValue([]);
});

describe("requireAppUser / requireRole", () => {
  it("rejects a request without a Supabase session", async () => {
    signedOut();
    await expect(requireAppUser()).rejects.toThrow("AUTHENTICATION_REQUIRED");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a valid Supabase session that has no application role and never self-provisions", async () => {
    signedInAs({ id: "44444444-4444-4444-8444-444444444444", email: "stranger@example.test" });

    await expect(requireAppUser()).rejects.toThrow("ACCOUNT_NOT_PROVISIONED");
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("loads the role from the database and ignores a role claimed in user metadata", async () => {
    signedInAs(EXECUTIVE, { role: "MANAGER" });
    prisma.user.findUnique.mockResolvedValue(EXECUTIVE);

    const { appUser } = await requireAppUser();

    expect(appUser.role).toBe("EXECUTIVE");
    await expect(requireRole("MANAGER")).rejects.toThrow("FORBIDDEN");
  });

  it("accepts a valid Manager session for a Manager-only check", async () => {
    signedInAs(MANAGER);
    prisma.user.findUnique.mockResolvedValue(MANAGER);

    const { appUser } = await requireRole("MANAGER");
    expect(appUser.id).toBe(MANAGER.id);
  });

  it("syncs a changed Auth email without touching the role", async () => {
    signedInAs({ id: EXECUTIVE.id, email: "new-exec@example.test" });
    prisma.user.findUnique.mockResolvedValue(EXECUTIVE);
    prisma.user.update.mockResolvedValue({ ...EXECUTIVE, email: "new-exec@example.test" });

    const { appUser } = await requireAppUser();

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: EXECUTIVE.id },
      data: { email: "new-exec@example.test" },
    });
    expect(appUser.role).toBe("EXECUTIVE");
  });
});

describe("API access (Route Handlers)", () => {
  it("returns 401 for unauthenticated shipment list and create requests", async () => {
    signedOut();

    const list = await shipmentsRoute.GET(new Request("http://localhost/api/shipments"));
    const create = await shipmentsRoute.POST(
      new Request("http://localhost/api/shipments", {
        method: "POST",
        body: JSON.stringify({ reference: "SHP-NEW-1" }),
      }),
    );

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    await expect(list.json()).resolves.toEqual({
      error: "Authentication required.",
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(prisma.shipment.findMany).not.toHaveBeenCalled();
  });

  it("returns 403 ACCOUNT_NOT_PROVISIONED for an Auth user without a role", async () => {
    signedInAs({ id: "44444444-4444-4444-8444-444444444444", email: "stranger@example.test" });

    const response = await shipmentsRoute.GET(new Request("http://localhost/api/shipments"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "ACCOUNT_NOT_PROVISIONED" });
  });

  it("scopes a valid Executive session to the Executive's own shipments", async () => {
    signedInAs(EXECUTIVE);
    prisma.user.findUnique.mockResolvedValue(EXECUTIVE);

    const response = await shipmentsRoute.GET(new Request("http://localhost/api/shipments"));

    expect(response.status).toBe(200);
    expect(prisma.shipment.findMany.mock.calls[0][0].where).toEqual({ createdById: EXECUTIVE.id });
  });

  it("does not scope a valid Manager session by creator", async () => {
    signedInAs(MANAGER);
    prisma.user.findUnique.mockResolvedValue(MANAGER);

    const response = await shipmentsRoute.GET(new Request("http://localhost/api/shipments"));

    expect(response.status).toBe(200);
    expect(prisma.shipment.findMany.mock.calls[0][0].where).toEqual({ AND: [] });
  });

  it("returns 403 when an Executive calls the Manager-only approve and decision routes", async () => {
    signedInAs(EXECUTIVE, { role: "MANAGER" });
    prisma.user.findUnique.mockResolvedValue(EXECUTIVE);

    const approve = await approveRoute.POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ decision: "APPROVE" }) }),
      params,
    );
    const decision = await decisionRoute.POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ decision: "APPROVE" }) }),
      params,
    );

    expect(approve.status).toBe(403);
    expect(decision.status).toBe(403);
    await expect(approve.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 401 for unauthenticated Manager-only routes", async () => {
    signedOut();
    const approve = await approveRoute.POST(new Request("http://localhost/x", { method: "POST" }), params);
    expect(approve.status).toBe(401);
  });

  it("maps auth error messages to fixed responses", async () => {
    expect(apiError(new Error("AUTHENTICATION_REQUIRED")).status).toBe(401);
    expect(apiError(new Error("FORBIDDEN")).status).toBe(403);
    const notProvisioned = apiError(new Error("ACCOUNT_NOT_PROVISIONED"));
    expect(notProvisioned.status).toBe(403);
    await expect(notProvisioned.json()).resolves.toMatchObject({ code: "ACCOUNT_NOT_PROVISIONED" });
  });
});

describe("protected pages (requirePageAppUser)", () => {
  it("redirects a visitor without a session to /login with a return path", async () => {
    signedOut();
    await expect(redirectTarget(requirePageAppUser("/reports"))).resolves.toBe("/login?next=%2Freports");
  });

  it("shows the session-expired state when a stale Supabase auth cookie is present", async () => {
    signedOut();
    cookieNames.push("sb-abcdefgh-auth-token.0");

    await expect(redirectTarget(requirePageAppUser("/shipments/abc"))).resolves.toBe(
      "/login?reason=session-expired&next=%2Fshipments%2Fabc",
    );
  });

  it("shows the not-provisioned state for a signed-in user without a role", async () => {
    signedInAs({ id: "44444444-4444-4444-8444-444444444444", email: "stranger@example.test" });
    await expect(redirectTarget(requirePageAppUser("/dashboard"))).resolves.toBe(
      "/login?reason=not-provisioned",
    );
  });

  it("returns the application user for valid Executive and Manager sessions", async () => {
    signedInAs(EXECUTIVE);
    prisma.user.findUnique.mockResolvedValueOnce(EXECUTIVE);
    await expect(requirePageAppUser("/dashboard")).resolves.toMatchObject({ appUser: { role: "EXECUTIVE" } });

    signedInAs(MANAGER);
    prisma.user.findUnique.mockResolvedValueOnce(MANAGER);
    await expect(requirePageAppUser("/dashboard")).resolves.toMatchObject({ appUser: { role: "MANAGER" } });
  });

  it("rethrows non-auth failures instead of hiding them behind a login redirect", async () => {
    getClaims.mockRejectedValue(new ConfigurationError("NEXT_PUBLIC_SUPABASE_URL is required"));
    await expect(requirePageAppUser("/dashboard")).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("recognises only Supabase auth-token cookie names", () => {
    expect(hasSupabaseAuthCookie(["sb-ref-auth-token"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-ref-auth-token.1"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-ref-auth-token-code-verifier", "theme"])).toBe(false);
  });
});

describe("login redirect helpers", () => {
  it("accepts only same-origin relative return paths", () => {
    expect(safeNextPath("/shipments/1?tab=docs")).toBe("/shipments/1?tab=docs");
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/login",
      "/login?next=/x",
      "/ok\nSet-Cookie:x",
      "",
      42,
      undefined,
    ]) {
      expect(safeNextPath(unsafe)).toBeNull();
    }
  });

  it("builds login paths and drops unsafe or default return paths", () => {
    expect(buildLoginPath()).toBe("/login");
    expect(buildLoginPath({ next: "/dashboard" })).toBe("/login");
    expect(buildLoginPath({ next: "//evil.example" })).toBe("/login");
    expect(buildLoginPath({ reason: "session-expired", next: "/reports" })).toBe(
      "/login?reason=session-expired&next=%2Freports",
    );
  });

  it("parses only known login reasons", () => {
    expect(parseLoginReason("session-expired")).toBe("session-expired");
    expect(parseLoginReason("not-provisioned")).toBe("not-provisioned");
    expect(parseLoginReason("<script>")).toBeNull();
    expect(parseLoginReason(["session-expired"])).toBeNull();
  });

  it("maps Supabase auth errors to fixed messages, never echoing raw text", () => {
    expect(describeAuthError({ code: "invalid_credentials", message: "x" }, "sign-in")).toBe(
      "Email or password is incorrect.",
    );
    expect(describeAuthError(new Error("Invalid login credentials"), "sign-in")).toBe(
      "Email or password is incorrect.",
    );
    expect(describeAuthError({ code: "email_not_confirmed" }, "sign-in")).toMatch(/confirm your email/i);
    expect(describeAuthError(new Error("internal db host 10.0.0.5 refused"), "sign-in")).toBe(
      "Sign-in failed. Try again.",
    );
  });
});

describe("auth callback route", () => {
  it("redirects to the dashboard after a successful code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await callbackRoute.GET(new Request("http://localhost/auth/callback?code=abc"));
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("shows the callback-failed state when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid flow state" } });
    const response = await callbackRoute.GET(new Request("http://localhost/auth/callback?code=bad"));
    expect(response.headers.get("location")).toBe("http://localhost/login?reason=callback-failed");
  });

  it("sends a request without a code to the login page", async () => {
    const response = await callbackRoute.GET(new Request("http://localhost/auth/callback"));
    expect(response.headers.get("location")).toBe("http://localhost/login");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
