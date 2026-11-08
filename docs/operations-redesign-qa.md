# Operations redesign: QA handoff

Completed 2026-11-08 as an ordinary extension of CargoVerity's approved shared UI, not a
new visual world or token change. Full-width priority-first queue, expandable creation,
and documents-led details are implemented using actual stored data and existing guarded APIs.
The review workspace, authentication, role queries, and upload-validation contracts are unchanged.

## Implementation scope

- `src/features/dashboard/dashboard-shell.tsx`: scoped counts, filters, queue views,
  server sorting, 20-item client pagination, responsive table/list, and retained creation form.
- `src/features/dashboard/queue-presentation.ts`: readable priorities/actions from server state.
- `src/app/shipments/[id]/page.tsx`: role-scoped identity/parties and latest-completed-run summaries.
- `src/features/documents/shipment-document-slots.tsx`: three versioned slots, private upload,
  real byte progress, separate validation, replacement consent, preview, extraction/retry/manual recovery.
- `src/lib/db.ts`: supporting production pool-lifecycle fix; reuse the client globally rather
  than creating a pool per call. No API or authorization-query change.
- Added `tests/e2e/operations.spec.ts`, `tests/unit/operations-ui.test.ts`, and
  `tests/unit/db-client.test.ts`; existing E2E selectors were updated.

## Verification record

Results below are supplied by the coordinating builder; the documenter did not rerun them.

| Final command | Reported result |
|---|---|
| `npm run lint` | Pass, no warnings |
| `npm run typecheck` | Pass |
| `npm run build` | Pass, Next.js 16.4.4 |
| `npm run test` | Pass, 881 tests / 54 files |
| `git diff --check` | Pass after the final source correction |

**Initial full operations E2E:** passed against real APIs with live extraction enabled,
before the final responsive/reviewer refinements. It was not rerun after those changes.
The recorded invocation was:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/saurabh/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome PLAYWRIGHT_RUN_EXTRACTION=1 OPERATIONS_QA_DIR=/tmp/opencode/cargoverity-queue-qa/initial npx playwright test tests/e2e/operations.spec.ts --reporter=list
```

Credentials came from configured environment variables; none are recorded here. This test
creates synthetic records and can consume provider quota; the invocation is evidence, not
authorization for another run.

Initial coverage included unsupported/empty/oversized client rejection; real magic-byte
rejection (415); uploads (201); explicit replacement; duplicate/stale guards (409);
Executive manager-decision denial (403); anonymous queue/evidence denial (401); filter/date
validation; transport recovery; and live extraction failure with safe retry cancellation.

**Final production Chromium confirmation:** 11 check groups passed at 1440×900, 1280×800,
1024×768, and 390×844, with no page errors. Covered real supplier/sort responses, pagination,
creation focus/draft restoration without another creation, keyboard table overflow, authorized
PDF bytes (200), exported locks, Executive/Manager scope, mobile empty/error/loading/retry,
and sign-out (401). Genuine byte progress was `[0, 100]`, followed by indeterminate server
validation. A duplicate transfer was rejected without changing revision 5 or its three documents.

## Evidence and finish verdict

- `.impeccable/review/operations/report.json`: production confirmation, preserved with its
  intermediate mobile action-below-fold finding; do not relabel this report as issue-free.
- `.impeccable/review/operations/verdict-mobile.json`: superseding targeted mobile result;
  390px page width, row top 657px, priority bottom 789px, next-action bottom 841px within
  844px, 44px action, and 16px/44px input.
- Desktop filter tops align at 457px across four columns. The `77` view count stays on one
  18px line. First mobile document title/state/action bottoms are 646/686/763px.
  Desktop slot actions may require scrolling; not all controls are claimed above the fold.
- Independent finish reviewer `ses_e45a0ccdfffeBntDv2B7qsOJLg`: initial **fix** on four
  findings; first verdict resolved filter alignment, saved-review truth, and numeric wrapping;
  final targeted mobile correction yielded **SHIP**, all four findings resolved. This verdict
  covers the listed fixes, not a new whole-surface review. One mechanical detector pass returned `[]`.
- `.impeccable/review/operations/`: 16 state captures, including targeted mobile updates.
  They are QA evidence, not application assets or committed visual-regression goldens.
  `.impeccable/` is Git-ignored, so captures, reports, and the surface brief remain local;
  this handoff is the versionable verification record. No shipping raster assets were introduced.
- Session-local runners: `/tmp/opencode/cargoverity-queue-confirm.mjs` and
  `/tmp/opencode/cargoverity-queue-mobile-verdict.mjs`; artifacts under
  `/tmp/opencode/cargoverity-queue-qa/initial/` and `reviewer-fixes/`. These may not survive
  cleanup. The surface brief retains the fuller record:
  `.impeccable/surfaces/src-app-dashboard-page-tsx.md`.

Both development and production servers started for this task have been stopped.

## Synthetic data and limitations

New authorized record **QA-OPERATIONS-1794127284984**
(`a35fb03a-46c3-426a-8440-13cdfc19cc51`) ends at revision **5**: Invoice **v2** failed live
extraction with `INVALID_RESPONSE`; Packing List/Bill of Lading are uploaded, unextracted.
No successful AI extraction data was seeded for this task. Failure, retry cancellation,
and manual-recovery access were exercised; **successful live AI extraction was not validated**.

Existing **QA-REVIEW-20261107-01** remained **EXPORTED**, revision **22**, read-only.
Its Invoice displays **Extracted** with zero saved review flags. No existing record was mutated.
Synthetic documents are not client evidence or customs-filing material.

Verification used cached, headless Chromium with emulated viewports because Playwright MCP
Chrome was unavailable. No physical-device, other-engine, screen-reader, or certified
production-deployment validation is implied. It establishes neither AI accuracy nor customs compliance.
No reference comp/QUALITY BAR was required for the user-pinned code-led Operate composition.

The incumbent palette/type/control rules still match the source. `DESIGN.md` retains its
older foundation/review-only scope and noncanonical headings/token-table schema; YAML token
frontmatter and `.impeccable/design.json` are absent. This pre-existing documentation drift
is noted without rewriting the shared system or canonizing surface-specific density/type choices.
`DESIGN.md`, `PRODUCT.md`, the existing review brief, code, and unrelated files were preserved
by this documentation pass. It ran no browser/build/test/capture work and made no commits or pushes.
