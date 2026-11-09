# Week 1 AI feasibility spike

**Recorded:** 2026-11-04 (cost estimate and limits updated 2026-11-07)  
**Data used:** synthetic CargoVerity packing-list PNG only  
**Primary provider:** Groq  
**Decision:** proceed with a synthetic-only Groq demo; keep OpenRouter as an explicit optional provider, never an automatic fallback.

## Observed Groq result

| Item | Result |
|---|---|
| Model | `qwen/qwen3.8-27b` (listed by third-party trackers as a Groq *preview* model) |
| Availability | Groq models endpoint returned HTTP 200; configured model was listed as active. |
| Input modalities | Text and image. |
| Output mode | JSON object mode accepted. |
| Request shape | `groq-sdk` chat completion with a system prompt, user text part and base64 `image_url` part. |
| Application batch limit | At most 3 rendered images per request (`MAX_AI_IMAGES_PER_REQUEST`, capped at 3). |
| Application file/page limits | 10 MB PDF, 7 MB image, 50 pages (`MAX_PDF_BYTES`, `MAX_IMAGE_BYTES`, `MAX_PDF_PAGES`). |
| Provider image limit | Provider documentation reports a 20 MB image-request limit; the app applies its own lower limits. |
| Smoke result | HTTP success; `finish_reason=stop`; JSON content returned. |
| Observed latency | 885 ms for the small one-image identification request. The Week 6 full-extraction smoke runs took 2.3 s to 45.5 s per page (average 29 s), so plan for tens of seconds per page, not sub-second. |
| Observed usage | Identification request: 1,843 prompt + 9 completion tokens. Full one-page extraction (Week 6 smoke runs): about 2,190 prompt + 800 completion tokens per page. |
| Quota/cost | No-charge status was not provable from the API response. Free-tier terms can change; no paid fallback is configured. |
| Provider region | Groq Cloud is not an India-only processing location (see privacy boundary below). |

The full synthetic invoice, packing-list and bill-of-lading flow was also exercised through the application. Responses are normalized with Zod before persistence; malformed provider shapes fail safely instead of being trusted.

## Cost estimate `[DERIVED]` `[ASSUMPTION]`

Price used: **$0.80 per million input tokens and $4.00 per million output tokens** for `qwen/qwen3.8-27b` on Groq, as listed by [TypingMind's Groq cost calculator](https://custom.typingmind.com/tools/estimate-llm-usage-costs/groq/qwen3-8-27b), [LiteLLM's Groq model list](https://models.litellm.ai/providers/groq) and [Sim's model page](https://www.sim.ai/models/groq/qwen-qwen3-8-27b) (checked 2026-11-07). Groq's own pricing page renders client-side and could not be read programmatically, so **verify this price on [groq.com/pricing](https://groq.com/pricing) before relying on it**.

| Unit | Tokens (in / out) | Estimated cost |
|---|---|---|
| One rendered page, full extraction | ~2,190 / 800 | ~$0.0050 |
| Same page if the output reaches the app's 1,000-token cap | ~2,190 / 1,000 | ~$0.0058 |
| One shipment: 3 one-page documents, no retries | ~6,570 / 2,400 | ~$0.015 |
| 1,100 shipments/month, one page per document, no retries | | ~$16/month |

The monthly figure scales roughly linearly with pages per document and with retries (`MAX_AI_RETRIES=1` can double the cost of a failing batch). A 3-page document costs about three times a one-page document. Treat these as planning estimates; the Week 6 operating-controls step owns the full cost model and budget alert.


## Provider and privacy boundary

- `GROQ_API_KEY`, `OPENROUTER_API_KEY`, database URLs and the Supabase secret key remain server-only.
- The browser sends rendered page images to authenticated route handlers; it never receives a provider key.
- Groq's current privacy policy states that Cloud Services customer data is governed by its Services Agreement and Data Processing Addendum, and describes global processing/transfer possibilities. This is not an India-only processing guarantee.
- OpenRouter is optional and its free-model availability, limits, routing and retention conditions can change. It was not used for this live smoke test.
- Real customs documents and personal data are explicitly out of scope until region, terms, retention and access controls are approved.

## Failure boundary

Unit tests cover invalid JSON/schema responses, provider-independent normalization, batching and safe error handling. Live quota, timeout and provider outage behavior must be tested with mocks or a controlled provider test; repeated live failures are not required.

## Go/no-go

**Proceed for synthetic demo:** the selected Groq model accepts the required image and JSON request shape, the bounded request completed, and the response is schema-validated.  
**Do not proceed to real documents:** quota, commercial terms, retention, regional processing and the target filing-software template remain unresolved.
