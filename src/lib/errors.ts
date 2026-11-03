export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";
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
