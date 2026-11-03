# CargoVerity architecture

## Implemented stack

CargoVerity is a Next.js 16 modular monolith. Route Handlers perform authenticated server operations; browser components handle interaction and bounded PDF.js page rendering.

| Concern | Implementation |
|---|---|
| UI | Next.js App Router, React, Tailwind CSS 4, local shadcn/ui-style components, Lucide React |
| Auth | Supabase Auth with `@supabase/ssr` and Next.js 16 `proxy.ts` |
| Database | Supabase PostgreSQL Free through Prisma ORM 7 and `@prisma/adapter-pg` |
| Storage | Supabase private Storage using a server-only service-role client |
| AI | Provider-independent `AIProvider` interface; Groq primary, OpenRouter alternative |
| Documents | PDF.js renders PDF pages in the browser; PNG/JPEG pages are passed directly |
| Validation | Zod document schemas and server-side upload validation |
| Business rules | Pure TypeScript cross-checks using `decimal.js` |
| Deployment target | Vercel Hobby for a personal synthetic-data demo; Docker remains optional |

The installed `@supabase/supabase-js` `2.118.0` and `@supabase/ssr` `0.12.7` clients accept the new Supabase publishable/secret keys as ordinary string key arguments. The publishable key is used for browser/session clients; the secret key is used only by the trusted private-Storage client.

## Request flow

```text
Supabase login
  → authenticated dashboard
  → create shipment
  → POST original file to /api/documents
  → private Supabase Storage
  → browser renders PDF pages with PDF.js
  → POST batches of at most 3 images to /api/extractions
  → AIProvider (Groq or OpenRouter)
  → Zod document schema
  → ExtractionRun + ExtractedField + LineItem
  → human review and immutable correction audit
  → deterministic cross-check revision
  → manager approval
  → guarded demo-v1 CSV export
```

Provider selection is read from `AI_PROVIDER`. A request calls exactly one provider. Quota exhaustion does not trigger an automatic provider or paid-model fallback.

## Security boundaries

- Supabase browser URL and publishable key are browser-safe.
- `SUPABASE_SECRET_KEY`, database URLs, `GROQ_API_KEY` and `OPENROUTER_API_KEY` are server-only.
- Every route checks the Supabase user and then checks the application role/ownership through Prisma.
- Storage files remain private; signed URLs are short-lived and issued only after an access check.
- Frontend controls do not authorize approval or export; route handlers enforce those gates.
- Raw provider output is not persisted by default. Normalized values retain source quotes and page numbers.

## Data model

The Prisma schema stores users, shipments, documents, extraction runs, extracted fields, line items, field corrections, cross-check results/resolutions, approvals, audit events and export events. `currentRevision` invalidates approval after a relevant correction.

The current schema is a new development foundation; apply it to a new Supabase development project. Never reset or overwrite an existing production database.
