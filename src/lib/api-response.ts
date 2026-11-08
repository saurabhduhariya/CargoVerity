import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  ConfigurationError,
  ConflictError,
  DocumentUploadError,
  ExtractionError,
  ProviderError,
  ReviewError,
  SafeRequestError,
  safeErrorCode,
} from "@/lib/errors";

/** Short reference shown to the user and written to the log so support can match the two. */
function newErrorId() {
  return randomUUID().slice(0, 8);
}

/** Logs only the error ID, our code and the error class; never the message, stack or values. */
function logApiError(errorId: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: "api_error",
      errorId,
      code: safeErrorCode(error),
      type: error instanceof Error ? error.name : "unknown",
    }),
  );
}

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

  if (error instanceof DocumentUploadError && error.code === "STORAGE_UNAVAILABLE") {
    const errorId = newErrorId();
    logApiError(errorId, error);
    return NextResponse.json({ error: error.message, code: error.code, errorId }, { status: error.status });
  }

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
    const errorId = newErrorId();
    logApiError(errorId, error);
    return NextResponse.json(
      { error: "This feature is not configured on the server.", code: "CONFIGURATION_ERROR", errorId },
      { status: 503 },
    );
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
    const errorId = newErrorId();
    logApiError(errorId, error);
    const retryAfterSeconds = error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : undefined;
    return NextResponse.json(
      { error: message, code: error.code, errorId, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
      { status, ...(retryAfterSeconds ? { headers: { "Retry-After": String(retryAfterSeconds) } } : {}) },
    );
  }

  if (error instanceof SafeRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "The request is invalid.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  const errorId = newErrorId();
  logApiError(errorId, error);
  return NextResponse.json(
    { error: "Something went wrong. Quote this reference if you contact support.", code: "INTERNAL_ERROR", errorId },
    { status: 500 },
  );
}
