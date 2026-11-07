# AI extraction implementation

## Verified provider facts

The current Groq documentation lists `qwen/qwen3.8-27b` as accepting text and images, with JSON mode and structured-output capability. The documented vision limit is a maximum of three images per request and a 20 MB image request limit. CargoVerity uses three images as the application batch ceiling and additionally enforces file/page limits.

OpenRouter's official documentation supports base64 image inputs and documents `openrouter/free` as a dynamic router that filters for the requested capabilities, including vision and structured output. Because free-model availability changes, the application defaults to `openrouter/free` rather than claiming a permanent specific free model. The response model is recorded by the adapter when the provider returns it.

These facts are implementation inputs, not a guarantee of quota, uptime, model quality or future availability. Re-check the provider documentation before a live demo.

## Provider contract

`src/lib/ai/types.ts` defines the shared contract. `groq.provider.ts` and `openrouter.provider.ts` own provider-specific request construction. `extraction.service.ts` owns page batching and result merging. The cross-check engine never imports either provider.

Both adapters send image data as base64 data URLs, request JSON mode, and pass the response through document-specific Zod validation. An invalid response becomes a failed extraction rather than trusted data.

The extraction service:

1. Splits pages into batches of at most three.
2. Uses the selected provider only (`AI_PROVIDER`); there is no automatic failover and no paid fallback.
3. Retries at most once (`MAX_AI_RETRIES`, capped at 1), only for HTTP 429, 408/504 timeouts and provider 5xx/network errors. 402 quota, authentication, invalid output and configuration errors are not retried. The Groq SDK's own retries are disabled (`maxRetries: 0`), so one batch makes at most two provider calls.
4. Merges fields by confidence and line items by normalized description/HSN/quantity/total.
5. Retains source quotes, page numbers, model confidence and review status.

Request bounds: `AI_MAX_COMPLETION_TOKENS` (default 1000) and `AI_REQUEST_TIMEOUT_MS` (default 60 s, 5–120 s). A response cut off at the token cap (`finish_reason: "length"`) fails as `INVALID_RESPONSE` instead of being parsed. Provider and validation failures carry fixed messages; model output, keys and raw provider bodies never reach the browser, the database error fields or logs.

## Run lifecycle and idempotency

`src/lib/ai/extraction-workflow.ts` is the single server path used by the Route Handlers.

- **Start** (`POST /api/documents/:id/extract`, or per document via `POST /api/shipments/:id/extract`): creates a `PROCESSING` run for the current document version, keyed `extract:<doc>:v<version>:<provider>:<model>:<promptVersion>`. Repeating the request returns the same run; a completed run is served from the database without a provider call. `retry: true` creates a new run keyed `retry:<latestRunId>` and linked through `retryOfRunId`; asking twice returns the same retry run. History is never overwritten.
- **Batch** (`POST /api/extractions` with `runId`): the run must belong to that exact document version and the user's shipment scope. Pages must be exactly the batch's slot (`batchNumber × 3 + 1 …`) within the page count measured at upload; images must decode to the declared JPEG/PNG within `MAX_IMAGE_BYTES`. The server decides the final batch from the stored page count. A batch number already stored is not sent to the provider again.
- **Finish**: the final batch sets the document to `EXTRACTED` or `REVIEW_REQUIRED`, bumps the shipment revision (new values invalidate prior cross-checks and approvals) and moves the shipment to `NEEDS_REVIEW` once no other current document is still processing. Failures mark the run `FAILED` with a safe code and keep it in history.
- Runs left `PROCESSING` for 30 minutes (browser closed) are marked `FAILED` with code `ABANDONED`.
- Extraction is refused (`EXTRACTION_LOCKED`) once a shipment is `READY_FOR_APPROVAL`, `APPROVED` or `EXPORTED`.
- Run statuses in the schema are `QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`; `QUEUED` is unused because a run is created when work starts.

## Manual fallback

The AI can report a page unreadable (`isReadable: false`); only a person marks it for manual entry (`manualEntryRequired`), which bumps the revision. Manual entry is unlocked for fields on marked pages and for values the AI did not find; if no AI run completed (failure, quota, unreadable scan) the whole document is unlocked. Other fields go through field correction. Manual values are validated (numbers canonicalized, dates checked, unknown keys rejected), saved as `MANUAL_ENTRY` with a `FieldCorrection` recording the actor and time, and written to the latest completed run, or to a separate `manual` run when no AI run completed. Failed AI runs are kept.

## Document schemas

Invoice, packing-list and bill-of-lading schemas expose only applicable fields. Missing values are represented as missing or `null`; the model is instructed not to invent data. The server then normalizes values into the persistence model.

The confidence score is a model estimate, not a calibrated probability. A field requires review when it is missing, lacks source evidence, lacks a confidence value, or falls below `LOW_CONFIDENCE_THRESHOLD` (default `0.85`).

## PDF and image path

The original PDF/PNG/JPEG is uploaded first to private Supabase Storage. PDF pages are rendered in the browser with PDF.js and sent to authenticated Route Handlers in bounded batches. The original file remains in private Storage if rendering or extraction fails.

This avoids sending a complete PDF to a provider that expects images, but the browser must still respect `MAX_PDF_PAGES`, file-size limits and Vercel request limits. A production-scale asynchronous job worker is outside this free demo architecture.

Known limitation: the server validates the page images (type, size, page slot) but cannot prove they were rendered from the stored file, because PDFs are rendered in the browser. Server-side rendering would need a Node canvas dependency and is not part of this demo.

## Test boundary

Unit tests use mocked providers and prove normalization, batching, retry policy, validation and error mapping. `tests/integration/extraction-workflow.test.ts` runs the whole workflow against PostgreSQL with a scripted provider whose JSON goes through the real validator: multi-batch extraction, batch and run idempotency, concurrent starts, foreign-run rejection, quota/rate-limit/invalid-output failures, partial completion, type mismatch, abandoned runs and manual fallback. None of these prove live model quality; the live smoke test (`npm run test:smoke`) needs a provider key and synthetic documents.
