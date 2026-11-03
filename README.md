# CargoVerity

CargoVerity is an AI-assisted customs document workbench for freight-forwarding documentation teams. It will extract and reconcile data from commercial invoices, packing lists and bills of lading before a human-approved CSV export.

Internal product and implementation planning notes are kept locally in the ignored `plan/` directory and are not included in the GitHub repository.

## Current status

Week 1 Step 1 is implemented: the Next.js App Router baseline, strict TypeScript setup, Node 24 runtime contract, test scripts, CI checks, container baseline and initial module boundaries are present.

No client documents, real personal data or production credentials belong in this repository.

## Requirements

- Node.js `24.22.2` (see `.nvmrc` and `.node-version`)
- npm `11.19.1`

## Local setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The baseline page does not require database, Supabase or AI credentials. Those integrations are added in later implementation steps.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The browser smoke test requires a Playwright browser installation:

```bash
npx playwright install chromium
npm run test:e2e
```

## Container baseline

The `Dockerfile` uses the pinned Node 24 image and Next.js standalone output. It is a baseline container only; runtime integrations and secrets will be added in later weeks through runtime configuration and Secret Manager.
