# CargoVerity

**An AI document reader and cross-checker for customs brokers handling import shipments.**

Live demo: https://cargo-verity-32o7.vercel.app  
Repository: https://github.com/saurabhduhariya/CargoVerity

CargoVerity reads a shipment's commercial invoice, packing list and bill of lading, pulls out the fields with the exact source quote and page for each one, compares the three documents with fixed rules, and lets a Manager approve the exact reviewed version before a CSV is exported for the filing software.

> **Demo only.** The app runs on synthetic data. Do not upload real client documents. It does not file anything on the customs portal, does not classify HSN codes and does not calculate duty. People stay responsible for those decisions.

## The problem

A customs documentation team retypes data from three PDFs per shipment into filing software. Typos and mismatches between documents (for example, a gross weight of 3,120 kg on the invoice and 3,165 kg on the packing list) lead to amended Bills of Entry later. CargoVerity removes the retyping and catches those mismatches before anything is filed.

## How it works

```text
Upload 3 documents  ->  AI extraction  ->  Human review  ->  Cross-checks
                                                                   |
                         CSV export  <-  Manager approval  <-  Submit
```

1. An **Executive** creates a shipment and uploads the invoice, packing list and bill of lading (PDF, PNG or JPEG).
2. The server validates each file (size, real file type, checksum, page count) and stores it in a private bucket.
3. The browser renders PDF pages and sends them to a vision AI model in small batches. The model returns fields with a source quote, page number and confidence.
4. The Executive reviews every flagged value: confirm it, correct it with a reason, or enter it manually.
5. Fixed rules compare the documents. Any failed check must be resolved and stays in the history.
6. The Executive submits the shipment. A **Manager** approves or rejects the exact revision they reviewed.
7. Only an approved revision can be exported as CSV. Any later edit invalidates the approval.

## Features

- **Source evidence on every value.** Each extracted field keeps its source quote and page number, so a reviewer can verify it against the document.
- **Human in the loop.** Low-confidence, missing or unsupported values must be confirmed, corrected or entered manually before submission. The model's confidence is shown as an estimate, not a probability.
- **Six cross-check rules.** Invoice line arithmetic, gross weight, package count, invoice against packing list quantities, gross against net weight, and exporter name consistency. Calculations use exact decimals, never floating point.
- **Revision control.** Every edit, upload or re-extraction creates a new revision. Checks and approvals belong to one revision, so a stale approval cannot be used.
- **Two roles enforced on the server.** Executives see only their own shipments and cannot approve. Managers see all shipments, approve or reject, and export.
- **Guarded export.** A 21-column CSV (`demo-v1` profile) with an export record and checksum. Export is blocked, with the exact reason, if anything required is missing or ambiguous.
- **Audit trail.** Corrections, resolutions, decisions and exports are recorded with who, what and when.
- **Manual fallback.** If the AI fails, hits a quota, or cannot read a page, the reviewer enters values by hand. There is no automatic paid fallback.
- **Operating controls.** Upload limits, a monthly AI budget with an alert, idempotent extraction, safe error IDs and logs that never contain document content.
- **Accuracy report.** Per-field and per-supplier correction rates with sample sizes, clearly labelled as synthetic data.

## Try the demo

Open https://cargo-verity-32o7.vercel.app. The home page has an interactive example that works without signing in.

To use the full app you need an account. Accounts get their role from the database, so sign-up alone gives no access. **Demo logins for the Executive and Manager roles are given privately in the submission, not in this repository.** To run your own copy, see [Run it locally](#run-it-locally).

Suggested walkthrough:

1. Sign in as the **Executive**, choose **New shipment**, and create one.
2. In the shipment, open **Load sample documents**, choose `SHP-24811` and load it. The three PDFs come from `public/sample-docs/`.
3. Run extraction, then review the flagged fields.
4. Run the checks. You should see the **45 kg gross weight difference** between the invoice (3,120 kg) and the packing list (3,165 kg). The app reports it and never explains it away.
5. Resolve the failed check, then submit the shipment.
6. Sign in as the **Manager**, approve, and export the CSV.

Every sample page carries a "SYNTHETIC" banner. The sample set (`SHP-24811` to `SHP-24815`) includes a euro invoice with wooden crates and a degraded scan.

## Tech stack

| Area | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5.9 |
| Styling | Tailwind CSS 4 |
| Auth | Supabase Auth (`@supabase/ssr`) |
| Database | PostgreSQL on Supabase, Prisma ORM 7 with `@prisma/adapter-pg` |
| File storage | Supabase Storage, private bucket, signed URLs |
| AI | Groq `qwen/qwen3.8-27b` (vision, JSON mode). OpenRouter is an alternative |
| PDF rendering | PDF.js in the browser |
| Validation | Zod 4 |
| Arithmetic | decimal.js |
| Tests | Vitest and Playwright |
| Hosting | Vercel Hobby (demo), optional Docker image |
| Runtime | Node.js 24.22.2 |

## Architecture

```text
Browser (React, PDF.js)
   |  HTTPS + Supabase session cookie
   v
Next.js on Vercel  (proxy.ts, Route Handlers)
   |-- Prisma ------------> Supabase PostgreSQL
   |-- service client ----> Supabase Storage (private bucket)
   |-- AIProvider --------> Groq or OpenRouter
```

It is a Next.js modular monolith. Route Handlers do all authenticated work. The cross-check engine is plain TypeScript with no AI call, so its results are repeatable. Details are in [`docs/architecture.md`](docs/architecture.md) and the Technical Design Document.

## Run it locally

You need Node.js 24.22.2 (see `.nvmrc`) and npm. A Supabase project and a Groq API key are needed only for the full app; the first block works with nothing configured.

**1. Check that the code builds and tests (no secrets needed)**

```bash
git clone https://github.com/saurabhduhariya/CargoVerity.git
cd CargoVerity
npm ci          # also generates the Prisma client
npm test        # unit tests
npm run build
```

**2. Run the full app**

```bash
cp .env.example .env     # then fill in the values (see below)
npm run db:migrate       # applies the database migrations (needs DIRECT_URL)
npm run storage:setup    # creates the private bucket
npm run db:seed          # grants the Executive and Manager roles
npm run dev              # http://localhost:3000
```

**3. Create the two users**

Roles are granted only by the seed script, never by sign-up:

1. In the Supabase dashboard, go to Authentication, Users, and create an Executive and a Manager.
2. Put their user IDs and emails in the `SEED_*` variables in `.env`.
3. Run `npm run db:seed`.

An account without a role is rejected with `ACCOUNT_NOT_PROVISIONED`.

**Optional: Docker**

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx \
  -t cargoverity .
docker run -d -p 8080:8080 --env-file .env.production cargoverity
```

Write values in the env file without quotes. The full guide is [`docs/deployment.md`](docs/deployment.md).

## Environment variables

[`.env.example`](.env.example) lists every setting. The important ones:

| Variable | Visible to browser | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | No | Private storage operations |
| `DATABASE_URL`, `DIRECT_URL` | No | Pooled and direct PostgreSQL connections |
| `AI_PROVIDER` | No | `groq` or `openrouter` |
| `GROQ_API_KEY`, `GROQ_MODEL` | No | Groq key and model |
| `AI_MONTHLY_BUDGET_USD`, `AI_BUDGET_ALERT_PERCENT` | No | Monthly AI budget and alert |
| `MAX_PDF_BYTES`, `MAX_IMAGE_BYTES`, `MAX_PDF_PAGES` | No | Upload limits |

Never give a secret a `NEXT_PUBLIC_` name. `.env` and every `.env.*` file except `.env.example` are ignored by Git.

## Testing

| Suite | Command | Needs |
|---|---|---|
| Lint | `npm run lint` | nothing |
| Types | `npm run typecheck` | nothing |
| Unit tests (927) | `npm test` | nothing |
| Integration tests (80) | `npm run test:integration` | a database and storage |
| End-to-end tests (27) | `npm run test:e2e` | a browser and test accounts |
| Real AI smoke test | `npm run test:smoke` | an AI key; makes live calls |

Last results (2026-11-09): 927 unit tests passed, 80 integration tests passed, 26 end-to-end tests passed and 1 opt-in test was skipped. Full detail is in [`docs/test-results.md`](docs/test-results.md). The GitHub Actions workflow runs install, lint, typecheck, schema validation, unit tests and build with no secrets.

The integration and end-to-end tests create shipments in the configured database. Remove them with:

```bash
node --env-file=.env scripts/cleanup-test-shipments.mjs          # dry run
node --env-file=.env scripts/cleanup-test-shipments.mjs --apply  # delete
```

## Deployment

The demo runs on Vercel Hobby with a Supabase project in `ap-southeast-1` (Singapore). After the first deploy, set the Supabase Site URL and add `<your-url>/auth/callback` under Redirect URLs, otherwise login fails. Step-by-step instructions, the smoke-test table and troubleshooting are in [`docs/deployment.md`](docs/deployment.md).

## Security and privacy

- Every API route checks the session and the role on the server. Browser role claims are ignored.
- Shipment lookups are scoped to the user: an Executive cannot read another Executive's shipment.
- Files sit in a private bucket under random keys. Downloads use signed links that expire after 5 minutes.
- Uploads are checked on the server for file signature, size, SHA-256 and PDF page count.
- Unexpected errors return a generic message and a short error ID. Logs hold no document text, prompts, images or personal data.
- Secret keys and database URLs are server-only.

Details and the checklist are in [`docs/security-and-privacy.md`](docs/security-and-privacy.md). The AI provider processes pages outside India and the database is in Singapore, so no residency or compliance claim is made. See the same document.

## Status: what is proven and what is not

| Item | State |
|---|---|
| Full workflow: upload, extract, review, check, submit, approve, export | Built and tested |
| Live AI on synthetic documents | 32 of 32 expected fields matched on 5 documents. This shows the pipeline works. It is **not** an accuracy estimate |
| 95 percent field accuracy | **Not measured.** Needs the client's 200 labelled shipments |
| Entry time under 15 minutes | **Not measured.** Only machine time (about 29 seconds per page) was measured |
| Fewer amended Bills of Entry | **Not measured.** Needs 90 days of production use |
| Export columns | **Assumptions.** No filing-software template was supplied, so `demo-v1` is a stand-in |

Details: [`docs/benchmark-and-success-targets.md`](docs/benchmark-and-success-targets.md).

## Known limitations

- The AI is slow for this use (2 to 45 seconds per page) and its free-tier availability can change. There is no automatic failover.
- Extraction runs from the browser in batches of up to 3 pages, so a long document needs the tab to stay open. A background worker would remove this limit.
- Handwriting, other languages, other document types and very degraded scans are untested.
- No data retention policy has been agreed. Backup and restore are documented but not rehearsed.
- There is no user administration screen. Roles are set by the seed script.

The full list and next steps are in section 13 of the Technical Design Document.

## Project layout

```text
src/app/            Pages and API Route Handlers (21 endpoints)
src/features/       Dashboard, review workspace and document UI
src/lib/ai/         Providers, prompts, validation, extraction workflow, budget
src/lib/crosschecks/  Rule engine and line matching
src/lib/documents/  Upload validation, storage, sample loader
src/lib/export/     Export profile and CSV builder
src/lib/manager/    Approval decisions
prisma/             Schema and migrations
public/sample-docs/ Synthetic sample documents
scripts/            Seed, storage setup, smoke test, cleanup
tests/              Unit, integration and end-to-end tests
docs/               Design, security, operations and test records
```

## Documentation

| Document | Content |
|---|---|
| [`docs/deployment.md`](docs/deployment.md) | Local setup, Supabase, Vercel, Docker, smoke test |
| [`docs/architecture.md`](docs/architecture.md) | Stack and request flow |
| [`docs/ai-extraction.md`](docs/ai-extraction.md) | Provider contract, runs, retries |
| [`docs/ai-feasibility.md`](docs/ai-feasibility.md) | Model choice, limits and cost |
| [`docs/real-ai-smoke-test-report.md`](docs/real-ai-smoke-test-report.md) | Live AI test record |
| [`docs/assumptions.md`](docs/assumptions.md) | Decision log, field policy, export mapping |
| [`docs/sample-data-manifest.md`](docs/sample-data-manifest.md) | Sample documents and expected values |
| [`docs/security-and-privacy.md`](docs/security-and-privacy.md) | Security checklist |
| [`docs/operations.md`](docs/operations.md) | Limits, AI budget, backup, cost model |
| [`docs/benchmark-and-success-targets.md`](docs/benchmark-and-success-targets.md) | Success target status |
| [`docs/test-results.md`](docs/test-results.md) | Test run results |

## License

MIT. See [`LICENSE`](LICENSE).
