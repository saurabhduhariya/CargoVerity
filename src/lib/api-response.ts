import { NextResponse } from "next/server";

import {
  ConfigurationError,
  ConflictError,
  DocumentUploadError,
  ExtractionError,
  ProviderError,
  ReviewError,
} from "@/lib/errors";

/**
 * Field or index names involved in a Prisma P2002 unique-constraint error.
 * The classic engine reports `meta.target` (field list). Prisma 7 driver adapters
 * (`@prisma/adapter-pg`) instead report `meta.driverAdapterError.cause.constraint`
 * with `fields` or an `index` name such as `Shipment_reference_key`.
 */
function uniqueConstraintTargets(error: object): string[] {
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? (error.meta as Record<string, unknown>)
    : null;
  if (!meta) return [];

  if (Array.isArray(meta.target)) return meta.target.map(String);
  if (typeof meta.target === "string") return [meta.target];

  const cause = (meta.driverAdapterError as { cause?: { constraint?: unknown } } | undefined)?.cause;
  const constraint = cause?.constraint as { fields?: unknown; index?: unknown } | undefined;
  if (Array.isArray(constraint?.fields)) return constraint.fields.map(String);
  if (typeof constraint?.index === "string") return [constraint.index];
  return [];
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";

  if (error instanceof DocumentUploadError || error instanceof ExtractionError || error instanceof ReviewError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }

  if (error instanceof ConflictError || /stale shipment revision/i.test(message)) {
    return NextResponse.json({ error: message, code: "CONFLICT" }, { status: 409 });
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    const target = uniqueConstraintTargets(error);
    const conflictMessage = target.some((name) => /(^|_)reference($|_)/i.test(name))
      ? "That shipment reference already exists. Choose a unique reference."
      : "A record with those details already exists.";

    return NextResponse.json({ error: conflictMessage, code: "CONFLICT" }, { status: 409 });
  }

  if (message === "AUTHENTICATION_REQUIRED") {
    return NextResponse.json(
      { error: "Authentication required.", code: "AUTHENTICATION_REQUIRED" },
      { status: 401 },
    );
  }
  if (message === "ACCOUNT_NOT_PROVISIONED") {
    return NextResponse.json(
      {
        error: "Your account has no CargoVerity role yet. Ask an administrator to provision it.",
        code: "ACCOUNT_NOT_PROVISIONED",
      },
      { status: 403 },
    );
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json(
      { error: "You do not have permission for this action.", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  if (error instanceof ConfigurationError || /not configured|configuration is missing/i.test(message)) {
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (error instanceof ProviderError) {
    const status =
      error.code === "RATE_LIMIT"
        ? 429
        : error.code === "TIMEOUT"
          ? 504
          : error.code === "AUTHENTICATION" || error.code === "INVALID_RESPONSE"
            ? 502
            : error.code === "REQUEST_FAILED"
              ? 502
              : 503;
    return NextResponse.json({ error: message, code: error.code }, { status });
  }

  return NextResponse.json({ error: message }, { status: 400 });
}
