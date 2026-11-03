import { NextResponse } from "next/server";

import { ConfigurationError, ProviderError } from "@/lib/errors";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    const target =
      "meta" in error &&
      typeof error.meta === "object" &&
      error.meta !== null &&
      "target" in error.meta &&
      Array.isArray(error.meta.target)
        ? error.meta.target.map(String)
        : [];
    const conflictMessage = target.includes("reference")
      ? "That shipment reference already exists. Choose a unique reference."
      : "A record with those details already exists.";

    return NextResponse.json({ error: conflictMessage, code: "CONFLICT" }, { status: 409 });
  }

  if (message === "AUTHENTICATION_REQUIRED") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "You do not have permission for this action." }, { status: 403 });
  }
  if (error instanceof ConfigurationError || /not configured|configuration is missing/i.test(message)) {
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (error instanceof ProviderError) {
    const status = error.code === "RATE_LIMIT" ? 429 : error.code === "TIMEOUT" ? 504 : error.code === "AUTHENTICATION" ? 502 : 503;
    return NextResponse.json({ error: message, code: error.code }, { status });
  }

  return NextResponse.json({ error: message }, { status: 400 });
}
