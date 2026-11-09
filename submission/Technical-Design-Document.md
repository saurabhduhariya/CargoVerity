# CargoVerity Technical Design Document

**Project:** Customs broker's AI document extraction and cross-check tool for import shipments  
**GitHub repository:** https://github.com/saurabhduhariya/CargoVerity  
**Deployed demo:** https://cargo-verity-32o7.vercel.app  
**Author:** Saurabh Prajapat 
**Document date:** 2026-11-09  
**Status:** Demo build with synthetic data only. Not a production system.

## 1. Summary

CargoVerity helps a customs broker's documentation team stop retyping data from shipping documents. An Executive uploads the commercial invoice, packing list and bill of lading for a shipment. An AI vision model reads the pages and returns fields with source quotes and page numbers. The Executive reviews the values, a deterministic rule engine compares the three documents, a Manager approves the exact reviewed revision, and the system exports a CSV for the filing software.

The application does not file anything on the customs portal, does not classify HSN codes, and does not calculate duty. People remain responsible for those decisions.

### 1.1 What is implemented

- Email and password sign-in through Supabase Auth, with two application roles (Executive and Manager) enforced on the server.
- Shipment creation, a dashboard with a work queue, and a shipment page with three document slots.
- Private document upload with server-side validation of size, file signature (magic bytes), checksum and PDF page count.
- AI extraction in bounded page batches with schema validation, source quotes, page references and confidence labels.
- Field-by-field human review: confirm, correct (with a reason), mark a page for manual entry, enter a missing value manually.
- Six deterministic cross-checks with a resolution workflow for failures.
- Submission for approval, Manager approve or reject with a comment, and revision-based invalidation of stale approvals.
- A guarded CSV export (`demo-v1` profile) with an export record and checksum.
- An audit trail, a monthly AI budget, safe error IDs and structured logs without personal data.
- A production container, a CI workflow, and a deployment on Vercel with Supabase.

### 1.2 What is synthetic or demo-only

- Every document in `public/sample-docs/` and every test fixture is invented. Each page carries a visible "SYNTHETIC" banner.
- The `demo-v1` export columns are a temporary assumption. No filing-software template was supplied (see section 9).
- The hosted demo must not receive real client documents.

## 2. Users and workflow

| Role | Can do | Cannot do |
|---|---|---|
| Executive | Create shipments, upload and replace documents, run extraction, review and correct fields, resolve checks, submit | See other Executives' shipments, approve, export |
| Manager | See all shipments, approve or reject submitted shipments, export approved shipments | Approve a shipment that was not submitted, or a revision they did not review |

Shipment status moves through these values: `DRAFT`, `IN_REVIEW`, `EXTRACTING`, `NEEDS_REVIEW`, `READY_FOR_APPROVAL`, `APPROVED`, `EXPORTED`.

```text
Upload 3 documents -> AI extraction -> Executive review -> Cross-checks
   -> Executive submits -> Manager approves or rejects -> CSV export
```

Every edit, upload or new extraction increases the shipment `currentRevision`. Cross-check runs and approvals refer to one revision, so any later change invalidates them and the shipment returns to review. A Manager decision must name the revision it reviewed, otherwise the request is rejected as stale.

## 3. Architecture

CargoVerity is a Next.js modular monolith. Route Handlers perform authenticated server work, and React components handle interaction. PDF pages are rendered in the browser with PDF.js and sent to the server as images.

```text
Browser (React, PDF.js)
   |  HTTPS, Supabase session cookie
   v
Next.js on Vercel (proxy.ts session refresh, Route Handlers)
   |-- Prisma 7 + pg adapter ---> Supabase PostgreSQL
   |-- service-role client -----> Supabase Storage (private bucket)
   |-- AIProvider interface ----> Groq (qwen/qwen3.8-27b) or OpenRouter
```

| Concern | Choice |
|---|---|
| Framework | Next.js 16.4.4 (App Router), React 19.3.0, TypeScript 5.9.3 |
| Styling | Tailwind CSS 4.3.4 |
| Auth | Supabase Auth with `@supabase/ssr` and `@supabase/supabase-js` 2.118.0 |
| Database | PostgreSQL on Supabase through Prisma ORM 7.10.1 and `@prisma/adapter-pg` |
| Storage | Supabase Storage, private bucket, signed URLs |
| AI | `groq-sdk` 1.6.0, provider-independent `AIProvider` interface |
| PDF rendering | `pdfjs-dist` 6.5.438 in the browser |
| Validation | Zod 4 schemas for AI output and request bodies |
| Arithmetic | `decimal.js` (no floating point for money, weights or quantities) |
| Tests | Vitest 5.1.0 and Playwright 1.64.1 |
| Runtime | Node.js 24.22.2 |

Key source locations:

| Path | Content |
|---|---|
| `src/app/api/` | Route Handlers (21 route files, listed in appendix A) |
| `src/lib/ai/` | Providers, prompts, response validation, extraction workflow, persistence, budget |
| `src/lib/crosschecks/` | Rule engine, line matching, resolution logic |
| `src/lib/documents/` | Upload validation, storage helpers, sample loader |
| `src/lib/export/` | Export profile, CSV builder, export guard |
| `src/lib/manager/` | Manager decision logic |
| `src/features/` | Dashboard, review workspace and document UI |
| `prisma/` | Schema and 10 migrations |
| `tests/` | Unit, integration and end-to-end tests |

## 4. Data model

Prisma models: `User`, `Supplier`, `Shipment`, `Document`, `DocumentPage`, `ExtractionRun`, `ExtractedField`, `LineItem`, `FieldCorrection`, `CrossCheckRun`, `CrossCheckResult`, `CrossCheckResolution`, `LineItemMapping`, `Approval`, `AuditEvent` and `ExportEvent`.

Design points:

- A shipment owns up to one current document per type. Replacing a document creates a new version (`documentVersion`, `isCurrent`) and keeps the old one. A partial unique index allows one current version per shipment and type.
- An `ExtractionRun` is never overwritten. A retry is a new run linked to the failed one. Each run has a unique `idempotencyKey`, token counters, latency, and a safe error code.
- `ExtractedField` keeps the model value (`modelValue`) and the current value separately, plus confidence, source quote, page number, and a review status (`PENDING`, `REQUIRES_REVIEW`, `CONFIRMED`, `CORRECTED`, `MANUAL_ENTRY`, `NOT_PRESENT`, `NOT_APPLICABLE`).
- Corrections write a `FieldCorrection` row with the previous value, new value and reason, and an `AuditEvent`.
- Cross-check results belong to a `CrossCheckRun` tied to a shipment revision. Resolutions are separate rows, so a failed check stays in history.
- Deleting a shipment cascades to its documents, runs, fields, checks, approvals, audit events and export events. Storage objects do not cascade and are removed by application code or the cleanup script.

## 5. AI extraction design

### 5.1 Provider and verified facts

| Item | Value | Source |
|---|---|---|
| Primary model | `qwen/qwen3.8-27b` on Groq | `docs/ai-feasibility.md` |
| SDK | `groq-sdk` 1.6.0 | `package.json` |
| Alternative | OpenRouter `openrouter/free` (no automatic failover) | `docs/ai-extraction.md` |
| Prompt version | `2026.11-v2` | `src/lib/ai/extraction-prompts.ts` |
| Schema version | `2026.11-v1` | same |
| Provider region | Not India-only. Groq Cloud processes requests in its own infrastructure | `docs/ai-feasibility.md` |
| Verified by | Live calls on synthetic documents on 2026-11-06 and 2026-11-07, and by the owner's manual test of the deployed app | `docs/real-ai-smoke-test-report.md` |

The smoke test script used prompt version `2026.11-v1`. The application has since moved to `2026.11-v2`. The newer prompt was exercised through the deployed app but has no separate scripted accuracy run.

### 5.2 Flow

1. The original file is uploaded to private Storage and validated on the server.
2. The browser renders PDF pages with PDF.js and posts batches of at most 3 page images to `/api/extractions`, naming the extraction run.
3. The server checks that the run belongs to that exact document version and the user's scope, that the pages match the batch slot, and that each image is a real JPEG or PNG within the size limit.
4. The provider is called in JSON mode. The reply is parsed and validated with a Zod schema for the document type. Invalid or truncated output fails safely and is never trusted.
5. Values are normalized (decimals as strings, weights to kilograms, dates to ISO format) and stored with source quote, page number and confidence.
6. The review policy marks a field as needing review when it is required and missing, has no source evidence, has no confidence, or has confidence below `LOW_CONFIDENCE_THRESHOLD` (0.85). Confidence is the model's own estimate, not a calibrated probability.
7. On the final batch the run completes, the shipment revision increases, and earlier checks and approvals stop applying.

### 5.3 Reliability controls

- At most one retry (`MAX_AI_RETRIES`), only for rate limits, timeouts and provider 5xx errors. Quota, authentication and invalid-output errors are not retried.
- Extraction is idempotent. Repeating a request returns the existing run. A batch already stored is not sent to the provider again.
- A run left in progress for 30 minutes is marked failed with code `ABANDONED`.
- Extraction is refused once a shipment is submitted, approved or exported.
- If the AI cannot read a page, a person can mark it for manual entry. Manual fallback is always available.

### 5.4 Measured latency and cost

From five live runs on synthetic one-page documents (`docs/real-ai-smoke-test-report.md`): 2.3 to 45.5 seconds per page, 29 seconds on average, about 2,190 input and 800 output tokens per page. All five runs reported exactly 800 completion tokens, which equals that script's output cap, so the replies were probably cut off at the cap while still parsing correctly. The application uses a 1,000 token cap and treats a reply cut off at the cap as a safe failure.

Cost at $0.80 per million input tokens and $4.00 per million output tokens (third-party listings, not read from Groq's own pricing page) is about $0.005 per page.

## 6. Cross-check engine

The engine is pure TypeScript with no AI call. It runs on the current confirmed or corrected values.

| Rule | Compares | Default severity |
|---|---|---|
| `invoice_line_total` | Invoice quantity times unit price against line total, and lines against the stated invoice total | Blocking |
| `gross_weight_comparison` | Gross weight across invoice, packing list and bill of lading | Blocking |
| `package_count_comparison` | Package count and type across documents | Blocking |
| `invoice_quantity_vs_packing_list` | Matched line quantities between invoice and packing list | Blocking |
| `gross_weight_vs_net_weight` | Net weight does not exceed gross weight | Blocking |
| `exporter_consistency` | Exporter name across documents, normalized for text comparison only (no legal identity claim) | Warning |

Warning failures are shown to the reviewer but never block submission, approval or export.

Statuses are `PASS`, `MISMATCH`, `INCOMPLETE` and `NOT_APPLICABLE`. Default tolerances are placeholders, not agreed values: gross weight within 0.5 percent of the larger weight (`CHECK_WEIGHT_TOLERANCE_PERCENT`, with an absolute kilogram floor of 0), money within 0.01 currency units (`CHECK_MONETARY_TOLERANCE`), quantity exact.

The provided brief contains a deliberate example: shipment `SHP-24811` has an invoice gross weight of 3,120 kg and a packing list weight of 3,165 kg. The engine reports the 45 kg difference. It never explains or reconciles it.

### 6.1 Resolving a failed check

A failed check remains in history. To proceed, the Executive records a resolution:

- `SOURCE_CORRECTED`: a field was wrong and has been corrected, then checks are re-run.
- `DOCUMENT_REPLACEMENT`: a new document version replaces the wrong one.
- `ACCEPTED_EXCEPTION`: needs evidence and a reason, and requires Manager approval for that exact revision before export. A reason alone never clears a check.

Line items from the invoice and packing list are matched automatically by description, HSN text, quantity and total. Unmatched lines can be mapped manually; each mapping is versioned.

## 7. Export

The guarded export builds a CSV from the approved revision only.

- Profile `demo-v1` (version 1.1.0) has 21 columns: `Shipment_Ref`, `Supplier_Name`, `Invoice_No`, `Invoice_Date`, `Currency`, `Incoterm`, `Item_Sr`, `HSN_Code`, `Item_Description`, `Quantity`, `Unit`, `Unit_Price`, `Line_Total`, `Gross_Weight_KG`, `Net_Weight_KG`, `Package_Count`, `Package_Type`, `Container_No`, `BL_No`, `Port_Of_Loading`, `Port_Of_Discharge`.
- One row per goods line, with shipment-level values repeated. Dates are `YYYY-MM-DD`. Weights are converted to kilograms from their stated unit. Missing values are empty cells.
- An export is blocked with an exact reason when a required value is missing, a weight has no unit, a date is ambiguous, or the shipment is not approved at the current revision.
- No personal contacts are written. Cells are quoted, and text that could be read as a spreadsheet formula is prefixed with an apostrophe.
- The same revision always produces the same bytes. Each export stores the profile, version, SHA-256, file name and row count in an `ExportEvent`.

**Assumption:** the column names, order and mappings are not an official customs or ICEGATE format. A real template must be supplied and registered as a new profile. Shipment data does not need to change.

## 8. Security and privacy

Details and evidence are in `docs/security-and-privacy.md`. Summary:

- Every API route checks the Supabase session and then the application role, on the server. Role claims from the browser are ignored.
- Shipment lookups are scoped: an Executive can only reach shipments they created, a Manager can reach all.
- Files stay in a private bucket under random keys with no original file name. Downloads use signed URLs valid for 300 seconds, issued after an access check. Upload URLs are valid for up to 2 hours and allow one object at one server-chosen key.
- The server validates every stored object: file signature, size, SHA-256, and for PDFs a parse that also rejects password-protected or corrupt files and enforces the page limit.
- `apiError()` returns only fixed messages from our own code. Unexpected errors return HTTP 500, a generic message and a short `errorId`. Logs hold the ID, a safe code and the error class, never message text, stacks, prompts, images or document contents.
- Provider keys, the Supabase secret key and database URLs are server-only. Only the project URL and the publishable key reach the browser.
- A pattern scan of tracked files for provider keys and database URLs with passwords found no matches on 2026-11-09. This is not a full audit of Git history.
- Importer and exporter contact details are not exported. Audit metadata holds field keys, values and reasons only.

### 8.1 Data processing terms, region and retention

- Supabase database and storage: region `ap-southeast-1` (Singapore). This is not the preferred Mumbai region and not an India-only location.
- Groq processes extraction requests outside India. No claim is made about provider non-training terms or DPDP compliance. Only synthetic documents are allowed in this demo.
- Vercel Hobby is a personal demo plan and is not a commercial compliance decision.
- Retention: no client policy has been supplied. `DOCUMENT_RETENTION_DAYS` is empty and unused. The demo keeps records until they are removed. Deleting a document removes the stored object and its extraction data, and invalidates any approval.

## 9. Assumptions and open decisions

Full table: `docs/assumptions.md`. The ones that affect acceptance:

| Item | State |
|---|---|
| Filing-software export template | Open. `demo-v1` is a stand-in |
| Required and optional fields per document | Proposed, implemented in `src/lib/ai/review-policy.service.ts`, needs product-owner confirmation |
| Cross-check tolerances | Placeholders, need confirmation |
| Retention and deletion policy | Pending the client |
| Database region | Singapore, India residency not confirmed as acceptable |
| Reopening an exported shipment | Not allowed in this build. Needs a decision |
| Accuracy benchmark set | Not supplied |

## 10. Operating controls

Details: `docs/operations.md`.

| Control | Setting |
|---|---|
| PDF and image size | `MAX_PDF_BYTES` 10,485,760 and `MAX_IMAGE_BYTES` 7,000,000 |
| Pages per document | `MAX_PDF_PAGES` 50 |
| Pages per AI request | At most 3 |
| AI retries | At most 1 |
| Monthly AI budget | `AI_MONTHLY_BUDGET_USD` (default 25) with an alert at `AI_BUDGET_ALERT_PERCENT` (default 80). At 100 percent new extractions are refused and users continue manually |
| Usage metrics | Latency and prompt and completion token counts per run, without personal data |
| Idempotency | Extraction runs, retries, batches and upload completion |

Estimated AI cost at 1,100 shipments a month with three one-page documents each: about $16.5 without retries, about $18 with 10 percent of pages retried once, and about $33 in the upper-bound cases (every page retried, or two-page documents). The prices are unverified planning figures. Supabase and hosting costs are separate.

Backups: Supabase Free has no scheduled backups. The manual `pg_dump` and restore procedure is documented but has not been rehearsed.

## 11. Testing and verification

| Layer | Evidence |
|---|---|
| Unit tests | 927 tests in `tests/unit`, all passing when last run on 2026-11-09 (`npm test`). They cover normalizers, cross-check rules, providers with mocked responses, validation, error mapping, routes, budget logic and security rules |
| Integration tests | `tests/integration` (8 files): 80 tests against PostgreSQL and private Storage with a scripted AI provider, all passed on 2026-11-09, run twice in a row. |
| End-to-end tests | `tests/e2e` (Playwright, 27 tests): 26 passed and 1 opt-in test skipped on 2026-11-09, after fixing 4 outdated tests and one real mobile layout overflow on the landing page. Details in `appendix/test-results.md` |
| CI | `.github/workflows/ci.yml` runs install, lint, typecheck, `db:validate`, unit tests and build without secrets |
| Real AI | Live Groq calls on synthetic documents: 32 of 32 expected fields matched on five documents. This shows the pipeline works. It is not an accuracy estimate |
| Deployed app | The owner signed in and ran extraction on https://cargo-verity-32o7.vercel.app. The owner completed the smoke test in `deployment.md` section 10 on 2026-11-09 and recorded it as passed, including the 3-page document extraction and the log review (see the recorded configuration table in `deployment.md`). Results per row were not written down individually. |
| Container | Built and run locally on 2026-11-09: healthy, non-root user, listens on 0.0.0.0:8080 |

## 12. Success targets: measured, unmeasured, deferred

Source: `docs/benchmark-and-success-targets.md`.

| Target | Status | Evidence |
|---|---|---|
| Field extraction accuracy of at least 95 percent | **Not measured** | Needs the client's 200 labelled shipments. Synthetic result only |
| Entry time under 15 minutes | **Not measured** | Only machine time was measured (29 seconds per page on average). Reviewer time and the manual baseline were not measured |
| Fewer amended Bills of Entry in 3 months | **Not measured** | Needs 90 days before and after. A measurement plan is documented |

An earlier version of the benchmark script produced a simulated entry time. It was removed and the document was corrected.

## 13. Known limitations and next steps

Limitations:

1. No filing, HSN classification or duty calculation, by design.
2. Export columns are assumptions until a real template is supplied.
3. Accuracy, entry time and amendment reduction are unmeasured.
4. The server cannot prove that page images were rendered from the stored PDF, because rendering happens in the browser. Server-side rendering would close this gap.
5. Extraction runs through browser-driven batches. A long document needs many requests and depends on the browser staying open. Vercel Hobby time limits apply. A background worker would remove both limits.
6. The AI model is slow for this use (tens of seconds per page) and its free or low-cost availability can change. There is no automatic provider failover.
7. The supplied examples cover three document types and a small set of scenarios. Handwriting, other languages, other document types and very degraded scans are untested.
8. The database region is Singapore. Retention policy is undefined. No row level security policies exist, so the database must only be reached through the server.
9. Backup and restore are documented but untested. Roles can only be set through the seed script. There is no user administration screen.
10. Open Supabase sign-up is enabled in the Auth settings. Unprovisioned accounts are rejected, but anyone can create an Auth user until sign-up is disabled.

Next steps in priority order:

1. Obtain the filing-software template and implement it as a new export profile.
2. Obtain 200 labelled shipments and publish a real accuracy result.
3. Run timed operator sessions to measure entry time against a manual baseline.
4. Agree retention, deletion and region with the client, and move to a Mumbai project if required.
5. Confirm field policy and tolerances with the product owner.
6. Add a background extraction worker and server-side page rendering.
7. Add user administration, disable open sign-up, and add row level security as defense in depth.
8. Rehearse backup and restore, and add monitoring on the `budget_alert` and `api_error` events.

## 14. Document index

| Document | Content |
|---|---|
| `deployment.md` | Local development, Vercel, Supabase, Docker, smoke test |
| `appendix/architecture.md` | Stack and request flow |
| `appendix/ai-extraction.md` | Provider contract, runs, retries |
| `appendix/ai-feasibility.md` | Model, limits and cost record |
| `appendix/real-ai-smoke-test-report.md` | Live AI test record |
| `appendix/benchmark-and-success-targets.md` | Success target status |
| `appendix/assumptions.md` | Decision log, field policy, export profile mapping |
| `appendix/sample-data-manifest.md` | Synthetic sample documents and ground truth |
| `appendix/security-and-privacy.md` | Security checklist and evidence |
| `appendix/operations.md` | Limits, budget, backup, cost model |
| `appendix/deployment-runbook.md` | Deployment checklist |
| `appendix/test-results.md` | Results of unit, integration and other test runs |

## Appendix A: API endpoints

| Method and path | Purpose |
|---|---|
| `/api/shipments` | GET: list. POST: create |
| `/api/shipments/[id]/documents/upload-url` | Issue a signed upload URL and key |
| `/api/shipments/[id]/documents/complete` | Validate the stored object and record the document |
| `/api/shipments/[id]/load-sample` | Load a synthetic sample scenario |
| `/api/shipments/[id]/extract` | Start extraction for a shipment |
| `/api/documents/[id]` | GET: signed download link. DELETE: delete document and stored object |
| `/api/documents/[id]/extract` | Start or retry extraction for a document |
| `/api/documents/[id]/pages/manual` | Mark a page for manual entry |
| `/api/documents/[id]/fields/manual` | Enter a missing value manually |
| `/api/extractions` | Run one batch of page images |
| `/api/fields/[id]/review` | Confirm a field |
| `/api/fields/[id]/correction` | Correct a field |
| `/api/shipments/[id]/crosschecks` | POST: run checks. GET: read results |
| `/api/crosschecks/[id]/resolve` | Record a resolution |
| `/api/shipments/[id]/line-mappings` | Create a manual line mapping |
| `/api/shipments/[id]/line-mappings/[mappingId]` | Remove a line mapping |
| `/api/shipments/[id]/submit` | Submit for approval |
| `/api/shipments/[id]/decision` | Manager approve or reject |
| `/api/shipments/[id]/approve` | Alias of the decision endpoint |
| `/api/shipments/[id]/export` | Guarded CSV export |
| `/api/reports/accuracy` | Field and supplier accuracy report with sample sizes (synthetic data set) |
