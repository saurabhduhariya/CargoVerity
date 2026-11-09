import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPrisma } from "@/lib/db";

export type AppRole = "EXECUTIVE" | "MANAGER";

/** Thrown messages understood by `apiError` and the page auth helper. */
export const AUTH_ERRORS = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  ACCOUNT_NOT_PROVISIONED: "ACCOUNT_NOT_PROVISIONED",
  FORBIDDEN: "FORBIDDEN",
} as const;

export async function getAuthenticatedSupabaseUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createSupabaseServerClient();
  // getClaims() verifies the session JWT signature and expiry against the project's published
  // signing keys (cached), so a forged or expired cookie is rejected without a Supabase Auth
  // round trip on every page and API request. The role still comes only from the database.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/**
 * Validates the Supabase session and loads the application user and role from the database.
 *
 * Roles are never taken from the browser or from Supabase user metadata. A user who has a
 * valid Supabase session but no application row is rejected: application roles are granted
 * only through the controlled seed (`npm run db:seed`), not by self sign-up.
 */
export async function requireAppUser() {
  const authUser = await getAuthenticatedSupabaseUser();

  if (!authUser?.email) {
    throw new Error(AUTH_ERRORS.AUTHENTICATION_REQUIRED);
  }

  const prisma = getPrisma();
  let appUser = await prisma.user.findUnique({ where: { id: authUser.id } });

  if (!appUser) {
    throw new Error(AUTH_ERRORS.ACCOUNT_NOT_PROVISIONED);
  }

  // Keep the stored email in sync with Supabase Auth; the role is never changed here.
  if (appUser.email !== authUser.email) {
    appUser = await prisma.user.update({
      where: { id: appUser.id },
      data: { email: authUser.email },
    });
  }

  return { authUser, appUser };
}

export async function requireUser() {
  const { authUser } = await requireAppUser();
  return authUser;
}

export async function requireRole(role: AppRole) {
  const current = await requireAppUser();

  if (current.appUser.role !== role) {
    throw new Error(AUTH_ERRORS.FORBIDDEN);
  }

  return current;
}
