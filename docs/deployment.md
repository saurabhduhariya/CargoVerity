# CargoVerity Deployment and Local Development Guide

**Repository:** https://github.com/saurabhduhariya/CargoVerity  
**Deployed demo:** https://cargo-verity-32o7.vercel.app  
**Last revised:** 2026-11-09

This guide covers local development, the hosted demo (Vercel Hobby plus Supabase), the optional Docker image, database migrations, seeding, the smoke test, and the settings that must never reach the browser. No secret values appear in this document.

The deployment is a personal demo for synthetic data only. It does not claim commercial Vercel eligibility, India-only processing, provider non-training terms, or production readiness. Do not upload real client documents.

## 1. What is deployed

| Part | Service | Detail |
|---|---|---|
| Web app and API | Vercel Hobby | Next.js 16.4.4, built with `npm run build` |
| Database and Auth | Supabase (free) | PostgreSQL, email and password Auth. Region `ap-southeast-1` (Singapore), confirmed in the Supabase dashboard |
| File storage | Supabase Storage | Private bucket `shipment-documents` |
| AI extraction | Groq | Model `qwen/qwen3.8-27b`. OpenRouter (`openrouter/free`) is an alternative selected by `AI_PROVIDER` |

The Supabase region is Singapore, not the preferred Mumbai (`ap-south-1`). If India residency is required, create a Mumbai project and migrate before any non-synthetic data is used.

## 2. Requirements

- Node.js 24.22.2 (see `.nvmrc`) and npm.
- A Supabase project with email and password Auth enabled.
- A Groq API key (or an OpenRouter key).
- Optional: Docker, to run the production image locally.
- Optional: PostgreSQL client tools (`pg_dump`, `pg_restore`) for backups.

## 3. Environment variables

Copy `.env.example` to `.env` for local work. `.env` and every `.env.*` file except `.env.example` are ignored by Git. Never commit real values and never put quotes around values in files passed to Docker or in the Vercel dashboard.

| Variable | Exposure | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser | Supabase publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Server only | Used for private Storage operations |
| `SUPABASE_STORAGE_BUCKET` | Server only | Bucket name, default `shipment-documents` |
| `DATABASE_URL` | Server only | Transaction pooler connection string |
| `DIRECT_URL` | Server only | Session or direct connection string. Used by Prisma migrations and preferred by the app runtime |
| `AI_PROVIDER` | Server only | `groq` or `openrouter` |
| `GROQ_API_KEY`, `GROQ_MODEL` | Server only | Groq key and model |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Server only | OpenRouter key and model |
| `APP_URL` | Server only | Public app URL. Only used as the OpenRouter referer header |
| `MAX_PDF_BYTES`, `MAX_IMAGE_BYTES`, `MAX_PDF_PAGES` | Server only | Upload limits (defaults 10,485,760 bytes, 7,000,000 bytes, 50 pages) |
| `MAX_AI_IMAGES_PER_REQUEST`, `MAX_AI_RETRIES` | Server only | AI batch size (max 3) and retries (max 1) |
| `AI_MAX_COMPLETION_TOKENS`, `AI_REQUEST_TIMEOUT_MS` | Server only | Output cap and timeout |
| `AI_MONTHLY_BUDGET_USD`, `AI_BUDGET_ALERT_PERCENT` | Server only | Monthly AI budget and alert threshold |
| `AI_INPUT_PRICE_PER_MTOK_USD`, `AI_OUTPUT_PRICE_PER_MTOK_USD` | Server only | Prices used for the budget estimate |
| `LOW_CONFIDENCE_THRESHOLD` | Server only | Fields below this model confidence need review (default 0.85) |
| `CHECK_WEIGHT_TOLERANCE_PERCENT`, `CHECK_WEIGHT_TOLERANCE_KG`, `CHECK_MONETARY_TOLERANCE` | Server only | Cross-check tolerances |
| `EXPORT_PROFILE_ID` | Server only | Export profile, default `demo-v1` |
| `DOCUMENT_RETENTION_DAYS` | Server only | Left empty. Retention policy is pending client approval |

Only the two `NEXT_PUBLIC_` values are visible in the browser. They are the project URL and the publishable key. The secret key, database URLs and AI keys must never be given a `NEXT_PUBLIC_` name and must never be passed as Docker build arguments.

## 4. Local development

```bash
git clone https://github.com/saurabhduhariya/CargoVerity.git
cd CargoVerity
npm ci                     # also runs prisma generate
cp .env.example .env       # then fill in the values from section 3
npm run db:migrate         # applies all migrations using DIRECT_URL
npm run storage:setup      # creates or checks the private bucket
npm run db:seed            # grants the Executive and Manager roles (see section 6)
npm run dev                # http://localhost:3000
```

Checks before pushing:

```bash
npm run lint
npm run typecheck
npm run db:validate
npm test                   # unit tests, no database needed
npm run build
```

Optional suites that need a database and test accounts: `npm run test:integration` and `npm run test:e2e`. The E2E tests create shipments whose references start with `E2E-` or `QA-`. Remove them afterwards with `node --env-file=.env scripts/cleanup-test-shipments.mjs` (a dry run) and add `--apply` to delete.

## 5. Supabase setup

1. Create a Supabase project. Record its region.
2. Enable the email and password provider under Authentication.
3. Create the users that will use the app (an Executive and a Manager) in Authentication, Users.
4. Copy the project URL and publishable key. Copy the secret key and the two database connection strings (transaction pooler for `DATABASE_URL`, session pooler or direct for `DIRECT_URL`).
5. Run `npm run db:migrate`, then `npm run storage:setup`.
6. After the app has a URL, open Authentication, URL Configuration:
   - Set **Site URL** to `https://cargo-verity-32o7.vercel.app` (one address, no trailing slash).
   - Under **Redirect URLs** add each entry on its own row: `https://cargo-verity-32o7.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`. Add `http://localhost:8080/auth/callback` if the Docker image is used locally.

The app checks the signed-in user and role in every route handler. Row level security policies are not part of this build, so do not give browsers direct database access.

## 6. Roles and seeding

Roles (`EXECUTIVE`, `MANAGER`) live in the application database. A Supabase Auth account without an application row is rejected with `ACCOUNT_NOT_PROVISIONED`. Roles are granted only by the seed script:

1. Create the two users in Supabase Auth.
2. Set `SEED_EXECUTIVE_ID`, `SEED_EXECUTIVE_EMAIL`, `SEED_MANAGER_ID` and `SEED_MANAGER_EMAIL` (and optional names) in `.env`. The IDs are the Supabase Auth user IDs.
3. Run `npm run db:seed`.

Seed only synthetic users and records. Sample documents for demos are generated by `npm run generate:sample-docs` and are served from `public/sample-docs/`. Every page carries a "SYNTHETIC" banner.

## 7. Migrations

Run migrations from a controlled terminal, never from the web app:

```bash
npx prisma migrate status     # lists pending migrations
npm run db:migrate            # prisma migrate deploy, uses DIRECT_URL
```

There are 10 migrations. The latest, `20261109000000_extraction_usage_metrics`, adds token counters used by the monthly AI budget. Before changing a production schema, take a backup and rehearse the restore (see `docs/operations.md`).

## 8. Deploying to Vercel

1. In Vercel, choose Add New Project and import https://github.com/saurabhduhariya/CargoVerity. Framework Next.js, build command `npm run build`. Skip the optional Prisma Postgres and Supabase integrations, because the project already has its own Supabase database.
2. Add environment variables from section 3 for Production. Mark secrets as Sensitive. Do not add quotes.
3. Deploy. The production URL is https://cargo-verity-32o7.vercel.app.
4. Complete the Supabase URL configuration in section 5, step 6.
5. Sign in only from the main `*.vercel.app` address. Per-deployment preview addresses are not in the Supabase redirect list and will be rejected.
6. Vercel serverless time limits apply. Each extraction request carries at most 3 page images. Measured model latency was 2.3 to 45.5 seconds per page, so a long document needs many requests.

Pushing to the connected branch triggers a new deployment. The GitHub Actions workflow in `.github/workflows/ci.yml` runs install, lint, typecheck, `db:validate`, unit tests and build with no secrets.

## 9. Docker (optional production image)

The `Dockerfile` has three stages (dependencies, build, runtime) on Node 24.22.2. It uses Next.js standalone output, runs as the non-root `node` user, listens on `0.0.0.0:8080` (`HOSTNAME=0.0.0.0` is set explicitly), and has a health check. `.dockerignore` excludes `.env*`, `.git` and local tool folders.

Build. The two browser-visible values are baked in at build time:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx \
  -t cargoverity:local .
```

Run. Server-only values come from an env file at run time and are not in the image:

```bash
docker run -d --name cargoverity -p 8080:8080 --env-file .env.production cargoverity:local
docker logs cargoverity
docker exec cargoverity id        # expected: uid=1000(node)
docker stop cargoverity && docker rm cargoverity
```

Checks run on 2026-11-09 against a local container: it reported healthy, `/login` returned 200, the process ran as user `node` (uid 1000), and `HOSTNAME` and `PORT` were `0.0.0.0` and `8080`. In that first run `/api/shipments` returned 503 because the env file held invalid database URLs (quoted values), which is the expected safe failure. A run with a corrected env file is not recorded here. Changing `NEXT_PUBLIC_` values requires a rebuild. The image does not run migrations. In an env file for Docker, quotes around values are kept literally and break the PostgreSQL connection string check, so write values without quotes.

## 10. Smoke test of the deployed app

Run these on https://cargo-verity-32o7.vercel.app. Use the Executive account first, then the Manager.

| # | Check | Expected |
|---|---|---|
| 1 | Open `/login` and sign in as Executive | Dashboard loads |
| 2 | Open the shipment list | Only the Executive's shipments |
| 3 | Create a shipment and upload an invoice, packing list and bill of lading (from `public/sample-docs`) | Each upload completes |
| 4 | Run extraction | Fields appear with source quotes |
| 5 | Confirm or correct fields, run checks, submit | Status becomes ready for approval |
| 6 | Open a document | Opens through a signed link that expires after about 5 minutes |
| 7 | Sign in as Manager, approve, export the CSV | CSV downloads. An Executive cannot approve (403) |
| 8 | Request `/api/shipments` while signed out | 401 |

Record the date, the result of each row and the deployed commit in the table at the end of this document. Also read the Vercel logs and confirm they contain no secrets, signed URLs, party names or document text. The expected log events are `ai_extraction`, `api_error` and `budget_alert`.

## 11. Operations

- **Budget:** at `AI_BUDGET_ALERT_PERCENT` of `AI_MONTHLY_BUDGET_USD` a `budget_alert` log line is written. At 100 percent new extractions fail with `AI_BUDGET_REACHED` and reviewers continue by manual entry.
- **Error IDs:** provider, storage, configuration and unexpected failures return a short `errorId`. The matching log line (`event: api_error`) holds only the ID, a safe code and the error class.
- **Backup:** Supabase Free has no scheduled backups. Take `pg_dump` dumps and export the storage bucket separately. The procedure is in `docs/operations.md` and has not been rehearsed.
- **Cleanup:** `scripts/cleanup-test-shipments.mjs` removes test shipments and their stored files, keeping `SHP-DEMO-*` and `QA-REVIEW-*`.

## 12. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "This page couldn't load" after login | An environment variable is empty, has quotes, or `DATABASE_URL` and `DIRECT_URL` are not PostgreSQL connection strings. Check the Vercel or Docker logs for `CONFIGURATION_ERROR` |
| Login returns to the login page | The URL is missing from Supabase Redirect URLs, or you used a preview address |
| 503 with `AI_BUDGET_REACHED` | The monthly budget is used. Raise `AI_MONTHLY_BUDGET_USD` or continue manually |
| 429 or 503 from extraction | Provider rate limit or quota. Wait and retry once, or enter values manually |
| `ACCOUNT_NOT_PROVISIONED` | The Auth user has no application role. Run the seed with that user's ID |

## 13. Recorded configuration

Fill in after the final deployment. Do not record secret values.

| Item | Value |
|---|---|
| Vercel URL | https://cargo-verity-32o7.vercel.app |
| Deployed commit | af13f39 |
| Supabase region | `ap-southeast-1` (Singapore) |
| AI provider and model | Groq, `qwen/qwen3.8-27b` |
| Migrations applied up to | `20261109000000_extraction_usage_metrics` |
| Smoke test date and result | 2026-11-09 PASS |
| 3-page document extraction on Vercel | completed  |
| Log review result | clean |
