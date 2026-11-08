# Deployment runbook (Week 6 Step 7)

Personal synthetic-data demo on Vercel Hobby + Supabase. Do not record secret values here. Fill in the "Recorded configuration" table after deploying.

## 1. Before deploying

1. `npm run lint && npm run typecheck && npm test && npm run build` pass locally.
2. `npm run db:migrate` has been run against the Supabase project from a controlled terminal (uses `DIRECT_URL`). Check with `npx prisma migrate status`.
3. `npm run storage:setup` has created the private `shipment-documents` bucket.
4. Demo data is only synthetic. Remove automated-test leftovers with `node --env-file=.env scripts/cleanup-test-shipments.mjs` (dry run) and add `--apply` to delete. It keeps `SHP-DEMO-*` and `QA-REVIEW-*`. Rerun it after any E2E run.
5. Roles are seeded once with `npm run db:seed` (needs `SEED_*` values for users that already exist in Supabase Auth).

## 2. Vercel

1. Vercel dashboard, Add New Project, import the GitHub repository. Framework: Next.js. Build command: `npm run build`.
2. Settings, Environment Variables. Add these for Production (Sensitive for the secrets):
   - Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Server only: `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `DATABASE_URL` (transaction pooler), `DIRECT_URL`
   - AI: `AI_PROVIDER` plus `GROQ_API_KEY` and `GROQ_MODEL` (or the OpenRouter pair)
   - `APP_URL` = the Vercel URL
   - Optional: the limits and budget values from `.env.example`
3. Deploy. Note the production URL.
4. Supabase dashboard, Authentication, URL Configuration: set Site URL to the Vercel URL and add `https://<your-app>.vercel.app/auth/callback` to Redirect URLs. Redeploy is not needed for this.
5. Vercel serverless time limits apply to extraction batches. Each request handles at most 3 pages; confirm a 3-page document completes.

## 3. Smoke test on the deployed URL

Use the Executive account first, then the Manager account.

| # | Check | Expected |
|---|---|---|
| 1 | Open `/login`, sign in as Executive | Dashboard loads |
| 2 | Shipment list | Only the Executive's shipments |
| 3 | Create a shipment, upload invoice, packing list and bill of lading (sample PDFs from `public/sample-docs`) | Each upload completes |
| 4 | Run extraction | Fields appear; completes within the time limit |
| 5 | Review: confirm or correct fields, run checks, submit | Status becomes ready for approval |
| 6 | Open a document | Opens via a short-lived signed URL; the same URL fails after about 5 minutes |
| 7 | Sign in as Manager, approve, export CSV | CSV downloads; Executive cannot approve (403) |
| 8 | Logged-out request to `/api/shipments` | 401 |

## 4. Log review

Vercel, Logs. Search for and confirm none of these appear: `eyJ`, `sb_secret`, `gsk_`, `postgres://`, `token=` (signed URLs), importer or exporter names, document text, base64 image data. Expected log lines are `ai_extraction`, `api_error` (error ID and code only) and `budget_alert`.

## 5. Region and provider checks (verify separately)

- Supabase project region: Dashboard, Project Settings, General. Record it below. The target is Mumbai `ap-south-1`; the project used so far connects through an `ap-southeast-1` (Singapore) pooler, so the region may not be Mumbai.
- AI provider and model availability: run `npm run test:smoke` against the production keys. Groq does not process only in India.

## Recorded configuration (fill in; no secrets)

| Item | Value |
|---|---|
| Vercel URL | |
| Deployed commit | |
| Supabase region | |
| AI provider / model | |
| Migrations applied up to | `20261109000000_extraction_usage_metrics` |
| Date and result of smoke test | |
