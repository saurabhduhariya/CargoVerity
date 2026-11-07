# CargoVerity

CargoVerity is an AI-assisted customs-document workbench for invoices, packing lists and bills of lading. It keeps source evidence, validates extracted values, runs deterministic cross-checks and blocks CSV export until the current revision is manager-approved.

## Current implementation

The repository now contains a working zero-cost development/demo slice:

- Next.js 16 App Router, React, TypeScript and Tailwind CSS 4.
- Local shadcn/ui-style components and Lucide icons.
- Supabase SSR authentication, PostgreSQL and private Storage adapters.
- Prisma 7 with `prisma.config.ts`, generated client output and PostgreSQL driver adapter.
- Server-only Groq provider using `qwen/qwen3.8-27b` vision/JSON mode.
- Server-only OpenRouter provider using the official `openrouter/free` dynamic free-model router.
- Zod document-specific extraction validation and confidence review policy.
- PDF.js browser rendering with bounded three-page AI batches.
- Immutable extraction runs, field corrections, audit events and deterministic cross-check utilities.
- Manager approval and `demo-v1` guarded CSV export endpoints.

The internal blueprint remains in the locally ignored `plan/` directory. It is not included in GitHub.

## Important demo limitation

This architecture is for synthetic-data development and a personal demo. Groq and OpenRouter free/developer quotas can change, and Groq's model catalog lists paid token pricing even though free developer access may be available. The application never adds a paid fallback: when the selected provider is unavailable or rate-limited, it reports the error and preserves manual review.

Do not send real confidential customs documents or personal data to free-tier providers. Vercel Hobby also has personal/non-commercial use restrictions. This is not a production compliance or India-residency guarantee.

## Requirements

- Node.js `24.22.2` (`.nvmrc` and `.node-version`)
- npm `11.19.1`
- A Supabase project for authentication, PostgreSQL and private Storage
- A Groq API key or OpenRouter API key for live extraction

Docker is optional and is not required for local development or Vercel deployment.

## Local setup

A fresh checkout installs, tests and builds without any secrets:

```bash
npm ci            # runs `prisma generate`; no DIRECT_URL needed
npm test
npm run build
```

To run the app against Supabase:

```bash
cp .env.example .env
# Fill the Supabase, database and AI provider values in .env.
npm run db:migrate      # requires DIRECT_URL
npm run storage:setup   # private bucket, 10 MB object limit, PDF/PNG/JPEG only (needs SUPABASE_SECRET_KEY)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Configure the Supabase and provider variables in `.env` before using `/login` or the dashboard.

The Prisma CLI (migrations) uses `DIRECT_URL`. The app runtime also prefers `DIRECT_URL` when it is set, because interactive transactions need a session connection; otherwise it uses `DATABASE_URL`.

### Accounts and roles

Application roles (`EXECUTIVE`, `MANAGER`) are stored in the database and granted only by the controlled seed. Signing up in Supabase Auth does not give access: a signed-in account without a role sees "no CargoVerity role yet" and every API call returns `403 ACCOUNT_NOT_PROVISIONED`.

1. Create the synthetic users in the Supabase dashboard (Authentication → Users).
2. Put their Auth user IDs and emails in the `SEED_*` variables in `.env`.
3. Run `npm run db:seed`. When `SUPABASE_SECRET_KEY` is set, the seed first checks that each ID exists in Supabase Auth with the same email.

## Environment variables

See [`.env.example`](.env.example), which lists every variable the app reads, including operating limits, the role seed and Playwright credentials. The most important values are:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=shipment-documents
DATABASE_URL=
DIRECT_URL=
AI_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=qwen/qwen3.8-27b
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
```

Never use `NEXT_PUBLIC_` for `SUPABASE_SECRET_KEY`, database URLs or AI keys. `.env` is ignored by Git.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration   # needs DIRECT_URL or DATABASE_URL; creates and removes synthetic rows
```

The Playwright tests require a browser installation. Unauthenticated checks run with only the Supabase public variables; the login and role flows need the `PLAYWRIGHT_*` synthetic accounts in `.env`:

```bash
npx playwright install chromium
npm run test:e2e
```

## Documentation

- [`docs/assumptions.md`](docs/assumptions.md): decision log (export template, field policy, tolerances, roles, regions, retention, benchmark).
- [`docs/ai-feasibility.md`](docs/ai-feasibility.md): Week 1 provider spike, limits, latency and cost estimate.
- [`docs/architecture.md`](docs/architecture.md): implemented application and provider architecture.
- [`docs/ai-extraction.md`](docs/ai-extraction.md): provider limits, schemas and failure handling.
- [`docs/deployment.md`](docs/deployment.md): Supabase, Vercel Hobby and free-provider setup.

No secrets, real client documents or generated build output belong in this repository.
