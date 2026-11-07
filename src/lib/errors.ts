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

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AUTHENTICATION"
      | "RATE_LIMIT"
      | "TIMEOUT"
      | "INVALID_RESPONSE"
      | "UNAVAILABLE"
      | "REQUEST_FAILED",
    readonly status?: number,
  ) {
    super(message);
  }
}
