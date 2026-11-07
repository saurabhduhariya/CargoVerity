/**
 * Login redirect helpers shared by Server Components, Route Handlers and the login form.
 * Kept free of server-only imports so the browser bundle can use them too.
 */

export const LOGIN_REASONS = ["session-expired", "not-provisioned", "callback-failed"] as const;
export type LoginReason = (typeof LOGIN_REASONS)[number];

export function parseLoginReason(value: unknown): LoginReason | null {
  return typeof value === "string" && (LOGIN_REASONS as readonly string[]).includes(value)
    ? (value as LoginReason)
    : null;
}

/**
 * Accepts only same-origin relative paths so `?next=` cannot become an open redirect.
 * Rejects protocol-relative (`//host`), backslash tricks, control characters and the login page itself.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return null;
  return value;
}

export function buildLoginPath(options: { reason?: LoginReason; next?: string | null } = {}) {
  const params = new URLSearchParams();
  if (options.reason) params.set("reason", options.reason);
  const next = safeNextPath(options.next);
  if (next && next !== "/dashboard") params.set("next", next);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
