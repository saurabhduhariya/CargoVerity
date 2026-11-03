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
2. Uses the selected provider only.
3. Retries the same provider at most once for rate limits, timeouts or temporary unavailability.
4. Merges fields by confidence and line items by normalized description/HSN/quantity/total.
5. Retains source quotes, page numbers, model confidence and `PENDING` review status.

There is no automatic paid fallback.

## Document schemas

Invoice, packing-list and bill-of-lading schemas expose only applicable fields. Missing values are represented as missing or `null`; the model is instructed not to invent data. The server then normalizes values into the persistence model.

The confidence score is a model estimate, not a calibrated probability. A field requires review when it is missing, lacks source evidence, lacks a confidence value, or falls below `LOW_CONFIDENCE_THRESHOLD` (default `0.85`).

## PDF and image path

The original PDF/PNG/JPEG is uploaded first to private Supabase Storage. PDF pages are rendered in the browser with PDF.js and sent to authenticated Route Handlers in bounded batches. The original file remains in private Storage if rendering or extraction fails.

This avoids sending a complete PDF to a provider that expects images, but the browser must still respect `MAX_PDF_PAGES`, file-size limits and Vercel request limits. A production-scale asynchronous job worker is outside this free demo architecture.

## Test boundary

Provider tests use mocked responses and prove request-independent normalization, batching, validation and error boundaries. They do not prove live model quality. A live smoke test requires a user-supplied provider key and synthetic documents.
