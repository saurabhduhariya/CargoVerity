export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
}

export type DocumentUploadErrorCode =
  | "EMPTY_FILE"
  | "INVALID_MAGIC_BYTES"
  | "INVALID_MIME"
  | "FILE_OVERSIZED"
  | "CORRUPTED_PDF"
  | "PASSWORD_PROTECTED_PDF"
  | "PAGE_LIMIT_EXCEEDED"
  | "INVALID_STORAGE_KEY"
  | "OBJECT_NOT_FOUND"
  | "DUPLICATE_CONTENT"
  | "DUPLICATE_COMPLETION"
  | "REPLACEMENT_REQUIRED"
  | "STALE_REVISION"
  | "SHIPMENT_LOCKED"
  | "STORAGE_UNAVAILABLE";

/** Upload/validation failure with a fixed, user-safe message, a stable code and an HTTP status. */
export class DocumentUploadError extends Error {
  constructor(
    message: string,
    readonly code: DocumentUploadErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "DocumentUploadError";
  }
}

export type ProviderErrorCode =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "REQUEST_FAILED";

/**
 * AI provider failure. `message` is always a fixed, user-safe sentence written by our adapters;
 * raw provider bodies, keys and model output are never placed in it.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ProviderErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /**
   * Transient failures worth one retry: rate limits (429), timeouts (408/504) and provider
   * 5xx outages. Quota/credit exhaustion (402), authentication, bad requests, invalid model
   * output and "provider not configured" are permanent for this request and are never retried.
   */
  get retryable(): boolean {
    if (this.code === "RATE_LIMIT" || this.code === "TIMEOUT") return true;
    return this.code === "UNAVAILABLE" && typeof this.status === "number" && this.status >= 500;
  }
}

/** Extraction workflow failure with a fixed, user-safe message, a stable code and an HTTP status. */
export type ExtractionErrorCode =
  | "DOCUMENT_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "RUN_CLOSED"
  | "EXTRACTION_IN_PROGRESS"
  | "EXTRACTION_LOCKED"
  | "INVALID_PAGES"
  | "INVALID_IMAGE"
  | "MANUAL_ENTRY_NOT_UNLOCKED"
  | "UNKNOWN_FIELD"
  | "INVALID_FIELD_VALUE"
  | "INVALID_PAGE"
  | "STALE_REVISION";

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly code: ExtractionErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}
