import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_ERRORS, requireAppUser } from "@/lib/auth";
import { buildLoginPath } from "@/lib/auth-paths";

/** Supabase SSR stores the session in `sb-<project-ref>-auth-token` (optionally chunked `.0`, `.1`). */
export function hasSupabaseAuthCookie(cookieNames: string[]) {
  return cookieNames.some((name) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

/**
 * Protected-page guard. Server Components call this instead of `requireAppUser` so that:
 * - a visitor without a session is redirected to `/login` (with a return path),
 * - a visitor whose session cookie no longer validates sees the "session expired" state,
 * - a signed-in user without an application role sees the "not provisioned" state.
 * Any other error (for example missing configuration) is rethrown to the error boundary.
 */
export async function requirePageAppUser(currentPath: string) {
  let failure: unknown;

  try {
    return await requireAppUser();
  } catch (error) {
    failure = error;
  }

  const message = failure instanceof Error ? failure.message : "";

  if (message === AUTH_ERRORS.ACCOUNT_NOT_PROVISIONED) {
    redirect(buildLoginPath({ reason: "not-provisioned" }));
  }

  if (message === AUTH_ERRORS.AUTHENTICATION_REQUIRED) {
    const cookieStore = await cookies();
    const hadSession = hasSupabaseAuthCookie(cookieStore.getAll().map((cookie) => cookie.name));
    redirect(
      buildLoginPath({
        reason: hadSession ? "session-expired" : undefined,
        next: currentPath,
      }),
    );
  }

  throw failure;
}
