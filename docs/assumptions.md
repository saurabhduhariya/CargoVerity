# CargoVerity Week 1 decision log

**First recorded:** 2026-11-04  
**Last reviewed:** 2026-11-07  
**Owner:** CargoVerity implementation owner (unless a row names another owner)  
**Scope:** synthetic-data development/demo only

## Source labels

- `[BRIEF FACT]`: supplied by the product brief or an external policy source.
- `[DERIVED]`: calculated or observed from the repository, fixtures, configuration or a test.
- `[ASSUMPTION]`: temporary choice required to keep development moving.
- `[SYNTHETIC]`: invented demo value; not a client or customs record.
- `[PROPOSED]`: recommended decision awaiting product-owner confirmation.

## Decisions and open questions

| Decision | Label | Status | Date | Owner | Next action |
|---|---|---|---|---|---|
| Filing-software export template | `[ASSUMPTION]` `[PROPOSED]` | **Open.** No filing-software template was supplied. The guarded `demo-v1` CSV is the temporary export profile and is not an official customs or ICEGATE format. | 2026-11-04 | Product owner | Supply the target template and confirm column names, ordering and code lists before any production export. |
| Required/optional field policy | `[DERIVED]` `[PROPOSED]` | **Implemented as a proposal** in `src/lib/ai/review-policy.service.ts` (`DOCUMENT_FIELD_POLICIES`); see the field table below. Missing required fields block submission; missing optional fields are never treated as mismatches. | 2026-11-07 | Product owner | Confirm the required/optional split against two representative supplier templates per document type. |
| Units | `[ASSUMPTION]` `[PROPOSED]` | Money, weights and quantities are decimal strings parsed with `decimal.js` (no floats). Weights normalize g/lb/kg to kg. Package quantities keep the source unit; package-type compatibility is required before comparison. | 2026-11-04 | Product owner / customs SME | Confirm the unit list and package-type vocabulary. |
| Tolerances | `[ASSUMPTION]` | **Placeholders, not agreed values.** Defaults in `src/lib/normalizers/tolerances.ts`: monetary 0.05 currency units (rounding only), weight 0.00 kg (exact), quantity 0 (exact), party-name similarity 0.85, item-description similarity 0.80. No percentage tolerance is applied. | 2026-11-07 | Product owner / customs SME | Supply an approved tolerance per rule. Until then, any non-zero weight difference (for example the 45 kg SHP-24811 gap) is reported as a mismatch. |
| Low-confidence review threshold | `[ASSUMPTION]` | `LOW_CONFIDENCE_THRESHOLD=0.85`. Model confidence is a model estimate, not a calibrated probability; fields below the threshold require human review. | 2026-11-04 | Product owner | Revisit after the labelled benchmark is available. |
| Accepted exceptions | `[PROPOSED]` | A failed check stays in history and needs a documented resolution. A reason alone never clears it. `ACCEPTED_EXCEPTION` needs evidence, a reason and manager approval for the exact shipment revision before export. | 2026-11-04 | Product owner | Confirm permitted resolution types and evidence requirements. |
| Roles and account provisioning | `[DERIVED]` | **Decided.** Roles (`EXECUTIVE`, `MANAGER`) are stored in the application database and granted only through the controlled seed (`npm run db:seed`). A Supabase Auth account without an application row is rejected (`ACCOUNT_NOT_PROVISIONED`); the app no longer auto-creates Executives on first login. Roles in Supabase user metadata are ignored. | 2026-11-07 | Project owner | Keep sign-up closed for real data (see next row). |
| Supabase Auth sign-up | `[DERIVED]` | Observed from the project's Auth settings endpoint: email/password provider enabled, `disable_signup=false`, `mailer_autoconfirm=false` (email confirmation required). Open sign-up is harmless for access because unprovisioned accounts are rejected, but it still lets anyone create Auth users. | 2026-11-07 | Project owner | Disable public sign-up in Supabase (Authentication → Sign In / Providers) before any non-synthetic use. |
| Hosting and database region | `[DERIVED]` `[ASSUMPTION]` | The development Supabase project's pooler host is `aws-0-ap-southeast-1` (**Singapore**), not the preferred Mumbai `ap-south-1`. Vercel Hobby is a personal synthetic-demo target only. | 2026-11-07 | Project owner | Decide whether Singapore is acceptable; if India residency is required, create a Mumbai project and migrate before sharing any non-synthetic data. |
| Runtime database connection | `[DERIVED]` | The app runtime uses `DIRECT_URL` (session pooler, port 5432) when set, otherwise `DATABASE_URL` (transaction pooler, port 6543), because interactive transactions need a session connection. The Prisma CLI uses `DIRECT_URL` only. | 2026-11-07 | Implementation owner | Re-check connection limits before production traffic. |
| AI provider, region and terms | `[BRIEF FACT]` `[ASSUMPTION]` | Groq `qwen/qwen3.8-27b` is the primary provider; OpenRouter `openrouter/free` is an optional alternative chosen by `AI_PROVIDER` (no automatic failover). Provider processing is not treated as India-only; only synthetic documents are allowed. See `ai-feasibility.md`. | 2026-11-04 | Project owner / legal owner | Re-check current provider terms, retention and transfer conditions before any real-data use. |
| Document upload path | `[DERIVED]` | **Decided.** One path only: `upload-url` issues a server-chosen key → the browser PUTs bytes straight to private Storage → `complete` re-reads and validates the stored bytes (magic bytes, size, SHA-256, PDF parse/page count) and records the version, revision bump and audit in one transaction. The completion key must match the shipment and document it was issued for. The older multipart `POST /api/documents` route and the dashboard "Upload and extract" card were removed because they skipped revision, replacement, duplicate and audit checks. | 2026-11-07 | Implementation owner | None. |
| Signed upload URL lifetime | `[DERIVED]` | Supabase signed upload URLs are valid for 2 hours and the lifetime is not configurable per URL. Each URL allows one object at one server-chosen key (`upsert: false`). Download URLs are signed for 300 s after an authorization check. | 2026-11-07 | Project owner | Accept, or proxy uploads through the server if a shorter window is required. |
| Storage-layer limits | `[DERIVED]` | `npm run storage:setup` sets the bucket to private, a 10,485,760-byte object limit (largest of `MAX_PDF_BYTES`/`MAX_IMAGE_BYTES`) and a PDF/PNG/JPEG MIME allow-list. Applied to the development bucket on 2026-11-07. | 2026-11-07 | Implementation owner | Re-run after changing the size limits. |
| Document changes after export | `[PROPOSED]` | Uploads and replacements are refused (`SHIPMENT_LOCKED`) once a shipment is `EXPORTED`. Before that, any document change bumps the revision, sets `IN_REVIEW` and so invalidates a prior approval. | 2026-11-07 | Product owner | Confirm whether exported shipments may ever be reopened, and by whom. |
| Retention and deletion | `[ASSUMPTION]` `[PROPOSED]` | **Pending client policy.** No production retention promise is made. `DOCUMENT_RETENTION_DAYS` is intentionally empty and unused; the demo keeps records until removed. | 2026-11-04 | Product owner / legal owner | Provide retention, deletion, export and legal-hold policy. |
| Accuracy benchmark | `[DERIVED]` | **Not available.** The required 200-shipment labelled benchmark has not been supplied. Synthetic fixtures validate workflow logic only and cannot establish the 95% target. | 2026-11-04 | Product owner | Supply a permitted labelled benchmark and define the denominator before reporting accuracy. |

## Field policy (proposed)

| Document | Required | Optional |
|---|---|---|
| Commercial Invoice | exporter, importer, documentNumber, issueDate, currency, invoiceTotal | incoterm, packageCount, netWeight, grossWeight |
| Packing List | exporter, importer, documentNumber, issueDate, packageCount, grossWeight | netWeight |
| Bill of Lading | exporter, importer, documentNumber, issueDate, packageCount, grossWeight, portOfLoading, portOfDischarge | vessel, containerNumber, netWeight |

Line items are extracted for Invoice and Packing List and reviewed per line; they are not single required fields.

## Current synthetic fixture decision `[SYNTHETIC]`

- `public/sample-docs/` holds generated scenarios `SHP-24811` to `SHP-24815` (Invoice, Packing List, Bill of Lading each), produced by `npm run generate:sample-docs` with a visible "SYNTHETIC DEMO DOCUMENT" watermark. Ground truth is in `sample-data-manifest.md`.
- `sample-docs/` (git-ignored) holds local manual-upload samples for `SHP-DEMO-002`.
- None of these are client or customs records and they must not be used for filing.

## Week 1 gate status (Gate A)

| Gate A item | Status | Evidence |
|---|---|---|
| Real synthetic AI smoke test succeeds or a fallback decision exists | **Met** | `ai-feasibility.md` (Groq call on a synthetic page image, JSON mode, schema-validated). |
| Model, region, SDK shape, terms, limits, latency and cost recorded | **Met, with an unverified price** | `ai-feasibility.md`. The token price comes from third-party trackers; Groq's own pricing page could not be read programmatically. |
| Export-template decision recorded | **Met (temporary)** | `demo-v1`; the target template is still pending. |
| Auth, role lookup and a database-backed shipment demonstrated | **Met** | `tests/unit/week1-auth.test.ts`, `tests/integration/shipments.test.ts`, `tests/e2e/authenticated.spec.ts`, `tests/e2e/roles.spec.ts`, `tests/e2e/home.spec.ts` (run 2026-11-07, all passing). |
