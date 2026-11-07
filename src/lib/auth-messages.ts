import type { LoginReason } from "@/lib/auth-paths";

export const LOGIN_REASON_MESSAGES: Record<LoginReason, string> = {
  "session-expired": "Your session has expired. Sign in again to continue.",
  "not-provisioned":
    "This account is signed in but has no CargoVerity role yet. Ask an administrator to provision it, or sign in with a different account.",
  "callback-failed": "That sign-in link is invalid or has expired. Sign in with your email and password.",
};

/** Maps Supabase Auth errors to fixed user-facing text; raw provider messages are never shown. */
export function describeAuthError(error: unknown, mode: "sign-in" | "sign-up"): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "Email or password is incorrect.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "Confirm your email address using the link we sent, then sign in.";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (code === "user_already_exists" || /already registered/i.test(message)) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (code === "weak_password" || /password should be/i.test(message)) {
    return "Choose a stronger password (at least 8 characters).";
  }
  if (/configuration is missing/i.test(message)) {
    return "Sign-in is not configured for this environment.";
  }
  return mode === "sign-in" ? "Sign-in failed. Try again." : "Account creation failed. Try again.";
}
