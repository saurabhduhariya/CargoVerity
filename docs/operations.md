# Operating controls (Week 6 Step 5)

## Limits and where they are set

| Control | Setting (default) | Enforced in |
|---|---|---|
| Max PDF size | `MAX_PDF_BYTES` (10,485,760) | upload validation |
| Max image size | `MAX_IMAGE_BYTES` (7,000,000) | upload validation and extraction page images |
| Max page count | `MAX_PDF_PAGES` (50) | upload validation |
| Pages per AI request | `MAX_AI_IMAGES_PER_REQUEST` (3, max 3) | extraction workflow |
| AI retries | `MAX_AI_RETRIES` (1, max 1) | AI extraction service |
| Output cap / timeout | `AI_MAX_COMPLETION_TOKENS` (1000), `AI_REQUEST_TIMEOUT_MS` (60000) | provider adapters |

## Idempotency

- Extraction: every run has a unique `idempotencyKey` (document, version, provider, model, prompt version). Repeated "Run extraction" requests return the existing run. A retry key is derived from the failed run, so a double-clicked retry creates one run. A batch already stored is not sent to the provider again.
- Upload completion: completing the same stored object twice returns `DUPLICATE_COMPLETION` and does not create a second document or version.

## Usage and latency metrics (no PII)

Each `ExtractionRun` stores `latencyMs`, `promptTokens` and `completionTokens`. Per-batch usage is kept in the run's bookkeeping JSON. The structured log line `ai_extraction` carries only run ID, shipment ID, model ID, prompt version, latency and a safe error code. No prompts, images, document text or party names are stored in these counters.

## Monthly AI budget

- `AI_MONTHLY_BUDGET_USD` (default 25) and `AI_BUDGET_ALERT_PERCENT` (default 80). Spend is estimated for the current UTC calendar month from stored token counts and `AI_INPUT_PRICE_PER_MTOK_USD` / `AI_OUTPUT_PRICE_PER_MTOK_USD`.
- At the alert percentage, each new extraction run writes a `budget_alert` log line (percent used, spend, budget). Wire your log platform to alert on that event.
- At 100%, starting a new extraction run fails with `AI_BUDGET_REACHED` (HTTP 503) and a message telling the reviewer to enter values manually or ask an administrator to raise the budget. Manual entry, review, cross-checks, approval and export keep working. Runs already in progress are not cut off.
- The default budget is a placeholder. The client must approve the real figure, and the per-token prices must be checked against the provider's current pricing page before launch.

## Safe error IDs

Provider, configuration, storage and unexpected failures return a short `errorId` and a fixed message. The server logs `{"event":"api_error","errorId":"…","code":"…","type":"…"}` with no message text, stack or values. Support matches the user's ID to that log line.

## Backup and restore

Not tested in this repository's environment (no database client or production database was available). Treat this as the procedure to rehearse before go-live.

1. Supabase Free does not include scheduled backups. Use a manual logical dump from a controlled machine with the direct connection string:
   `pg_dump "$DIRECT_URL" --format=custom --no-owner --file=cargoverity-YYYYMMDD.dump`
2. Dumps contain business data. Store them encrypted, outside the repository, with the same access limits as production, and delete them per the retention policy.
3. Private Storage objects are not part of the dump. Export the `shipment-documents` bucket separately (Supabase dashboard or storage API) if document files must be recoverable.
4. Restore rehearsal: create a scratch Supabase project, run `pg_restore --no-owner --clean --if-exists -d "$SCRATCH_DIRECT_URL" cargoverity-YYYYMMDD.dump`, then run `npm run db:validate` and open a known shipment.
5. Before any production schema change: take a fresh dump, confirm it restores in the scratch project, run `npm run db:migrate` against the scratch project first, and only then against production. Migrations here are additive (new nullable or defaulted columns and indexes), so rollback means restoring the dump.

## Expected monthly cost at 1,100 shipments

Assumptions: Groq `qwen/qwen3.8-27b` at $0.80 / $4.00 per million input / output tokens (third-party listings checked 2026-11-07; verify on the provider's pricing page), 3 one-page documents per shipment, about 2,190 input and 800 output tokens per page. See `docs/ai-feasibility.md` for the source and caveats.

| Scenario | Calculation | Cost per month |
|---|---|---|
| No retries | 1,100 × 3 pages × ~$0.0050 | ~$16.5 |
| 10% of pages retried once | ~$16.5 × 1.10 | ~$18 |
| Every page retried once (upper bound) | ~$16.5 × 2 | ~$33 |
| Longer documents (average 2 pages) | ~$16.5 × 2 | ~$33 |

Supabase and hosting costs are separate and depend on the plan the client chooses. The default $25 budget with an 80% alert ($20) covers the no-retry and 10%-retry cases but would stop extraction in the upper-bound cases; set it with the client.
