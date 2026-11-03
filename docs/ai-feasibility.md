# Week 1 AI feasibility spike

**Recorded:** 2026-11-04  
**Data used:** synthetic CargoVerity packing-list PNG only  
**Primary provider:** Groq  
**Decision:** proceed with a synthetic-only Groq demo; keep OpenRouter as an explicit optional provider, never an automatic fallback.

## Observed Groq result

| Item | Result |
|---|---|
| Model | `qwen/qwen3.8-27b` |
| Availability | Groq models endpoint returned HTTP 200; configured model was listed as active. |
| Input modalities | Text and image. |
| Output mode | JSON object mode accepted. |
| Request shape | `groq-sdk` chat completion with a system prompt, user text part and base64 `image_url` part. |
| Application batch limit | At most 3 rendered images per request. |
| Provider image limit | Current provider documentation reports a 20 MB image-request limit; the app applies its own file/page limits. |
| Smoke result | HTTP success; `finish_reason=stop`; JSON content returned. |
| Observed latency | 885 ms for the small synthetic one-image identification smoke request in this environment. |
| Observed usage | 1,843 prompt tokens, 9 completion tokens, 1,852 total tokens for that smoke request. |
| Quota/cost | No-charge status was not independently provable from the API response. Billing/free-tier terms can change; no paid fallback is configured. |

The full synthetic invoice, packing-list and bill-of-lading flow was also exercised through the application. Responses are normalized with Zod before persistence; malformed provider shapes fail safely instead of being trusted.

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
