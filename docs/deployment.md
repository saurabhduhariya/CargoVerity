# Free demo deployment

This document describes a personal synthetic-data demo. It does not claim commercial Vercel eligibility, India-only processing, provider non-training terms, or production readiness.

## Supabase Free setup

1. Create a Supabase project. Select Mumbai `ap-south-1` if it is available in the account.
2. Enable email/password Auth.
3. Create a private Storage bucket named `shipment-documents`.
4. Copy the project URL and publishable key to Vercel environment variables as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Copy the secret key only to the server environment as `SUPABASE_SECRET_KEY`; never expose it in a browser variable.
6. Copy the transaction pooler URL to `DATABASE_URL` and the direct/session-pooler URL to `DIRECT_URL`.
7. Run `npm run db:migrate` from a controlled local terminal with `DIRECT_URL` configured.

The application performs server-side ownership and role checks. Add Supabase RLS policies before using any non-demo direct client access.

The new publishable/secret key naming follows Supabase's current API-key migration. `@supabase/supabase-js` accepts the opaque `sb_publishable_*` and `sb_secret_*` values directly; the SDK does not require the deprecated JWT-shaped key names.

## Provider setup

Choose exactly one provider per environment:

```env
AI_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=qwen/qwen3.8-27b
```

or:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free
```

Use only a no-charge/free quota for this assignment. Do not enable billing or configure a paid fallback. If the provider returns 402, 429 or an unavailable-model error, the application reports it and manual review remains the safe path.

## Vercel Hobby

1. Import the GitHub repository into Vercel.
2. Keep the framework as Next.js and the build command as `npm run build`.
3. Configure the environment variables from `.env.example` for Preview/Development. Add production values only for synthetic demo data.
4. Set Supabase Auth Site URL and redirect URL to the Vercel deployment URL plus `/auth/callback`.
5. Do not upload real client documents.

The current PDF rendering and provider calls are bounded, but Vercel serverless limits still apply. Large asynchronous workloads are not part of this zero-cost demo.

## Docker

Docker is optional. The existing Dockerfile is a Node 24 standalone-image baseline for local verification; it is not required for Vercel and does not introduce any legacy paid cloud dependency.

## Secrets and logs

Keep `.env` local and ignored. In hosted environments use the platform's encrypted environment-variable store. Never put provider keys, service-role keys, database passwords, signed URLs, full document contents or personal data in logs or Markdown.
