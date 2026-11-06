import "server-only";

export type ExtractionLogPayload = {
  runId: string;
  shipmentId: string;
  modelId: string;
  promptVersion: string;
  latencyMs: number;
  errorCode?: string | null;
};

/**
 * Structured AI extraction logger.
 * Enforces the plan specification:
 * "Log run ID, shipment ID, model ID, prompt version, latency and safe error code only."
 * Strictly prevents leaking sensitive prompt texts, image buffers, API credentials, or customer PII.
 */
export function logExtractionAttempt(payload: ExtractionLogPayload): void {
  const safeLog = {
    event: "ai_extraction",
    runId: payload.runId,
    shipmentId: payload.shipmentId,
    modelId: payload.modelId,
    promptVersion: payload.promptVersion,
    latencyMs: Math.max(0, Math.round(payload.latencyMs)),
    ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
  };

  console.info(JSON.stringify(safeLog));
}

