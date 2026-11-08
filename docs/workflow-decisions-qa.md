# Workflow decisions: QA handoff

Completed 2026-11-08 as an ordinary, user-pinned in-place extension of CargoVerity's
approved UI, not a new identity or approved token change. Checks, manager decisions,
history, export and reports make saved evidence and human dispositions legible without
turning exceptions into machine passes or synthetic metrics into benchmark claims.

## Implementation scope

- `src/features/review/checks-inspector.tsx`: saved-run identity, actionable counts,
  filters, source evidence and evidence-required resolutions with retained drafts.
- `src/features/review/history-inspector.tsx`: section navigation, model-to-reviewed
  values, immutable runs, historical correction links and searchable audit metadata.
- `src/features/review/manager-decision-summary.tsx` and
  `src/features/review/review-workspace.tsx`: exact saved/check revision, unresolved
  discrepancies, exception reasons/references, inspection links and meaningful comments.
- `src/components/ui/confirm-dialog.tsx`: separate nonshrinking title/actions and an
  independently scrollable body; safe initial Cancel focus. Manager dialogs use the
  existing wider `max-w-2xl` container override.
- `src/features/review/export-preview-dialog.tsx`: readiness first, explicit blockers,
  profile scope, CSV preview and real server provenance; byte-integrity guards retained.
- `src/features/reports/accuracy-report-view.tsx`: authorized dataset scope, numerators,
  denominators, shipment sample sizes, exclusions, searchable breakdowns and honest
  zero-denominator/empty/error recovery. Targets remain unclaimed for synthetic data.
- `tests/e2e/workflow-decisions.spec.ts`, `tests/unit/workflow-surfaces.test.ts` and
  `tests/fixtures/workflow-decision-preview.tsx`: opt-in workflow QA, presentation
  regressions and isolated component confirmation; related existing regressions updated.

The desktop document/inspector split, Checks/History tabs and manager/export dialogs
remain. Authentication, controllers, API endpoints and authoritative server guards are
unchanged. Earlier operations/dashboard/shipment-details work remains untouched.

## Verification record

Execution results are supplied by the coordinating builder, not rerun by the documenter.
The documenter checked the named source samples and local reports below.

| Final verification | Supplied result |
|---|---|
| `npm run lint` | Pass, no warnings |
| `npm run typecheck` | Pass after the final build/test-only lint correction |
| `npm run test` | Pass, 892 tests / 55 files, after correction |
| `npm run build` | Pass, Next.js 16.4.4, after correction |
| `git diff --check` | Pass; new source/test files and this handoff also passed `git diff --no-index --check` |
| Protected-path `git diff --exit-code` | Empty output, exit zero for `DESIGN.md`, `PRODUCT.md`, `src/app/api`, `src/features/review/review-controller.ts`, `src/features/dashboard`, `src/features/documents`, `src/app/shipments` |

The unit total increased from 881 to 892, with 11 new presentation regressions. Current
coverage includes honest metrics, filtering without mutation, manager unresolved/exception
scope, retained machine mismatch, audit search, saved document-review state, export readiness
and long-dialog chrome. Static rendered-markup tests are not actual accessibility certification.
The final lint correction only passed React `createElement` children as the third argument;
rendered UI was unchanged, so no further capture round was performed.

### Actual workflow history

**This was an original execution plus safe same-shipment checkpoint resumes, not an
uninterrupted fresh green workflow run.** The original failure waited unconditionally
for “Start a new check run?” after mapping had already succeeded; that confirmation is
conditional on invalidating a current exception. Later failures concerned selectors and
status/count assumptions. Tests were corrected without weakening application guards.

- Original execution: real uploads (201), authorized deterministic extraction fixtures,
  two original unresolved blocking checks, source-evidence return, desktop split,
  no-check-filter state, blocked submission/export, corrections and confirmations.
  A deliberately labeled QA Invoice-total input error (`16300.00`) was corrected to the
  source value (`16320.00`). Its historical `SOURCE_CORRECTED` link retained the old
  machine `MISMATCH` and snapshot. Line mapping succeeded before the first timeout.
- Subsequent same-shipment stages: required exception evidence and retained draft,
  meaningful manager comment, exact revision/exception scope, audit search/no-match/reset,
  stale Manager decision (409), Executive denial (403), rejection/resubmission/approval
  and real sign-off. Weight remained machine `MISMATCH`, separately deriving `HUMAN_CLEARED`.
- Export stage: one-byte tampering of the real server CSV produced **zero downloads**,
  retained the real server receipt and required fresh preflight. The subsequent actual
  CSV was 922 bytes; its SHA-256 matched preflight:
  `7a3060152a7d86df13320c7d591450458dc1778d9d2a4162b681046d2f1cc1db`.

**Latest production-reuse E2E: 1 passed (17.5s).** It resumed stage `exported`, checking
saved state, retained mapping/historical link, machine mismatch versus human clearance,
stored receipts/approval, Executive decision denial (403), role-scoped report filtering,
failed refresh/recovery and anonymous report/export-preflight denial (401). It skipped
creation, seeding, new mutations, downloads and manager decisions; it did **not** reissue
the stale Manager 409 probe. Aggregated report summaries repeat earlier-stage checks:
they are not individually rerun proofs of those mutations or guards.

### Safe existing exported-checkpoint reproduction

Run only by an explicitly authorized operator in the project root, with a deliberately
prepared local production server at `http://127.0.0.1:3000` and `CI` unset. The existing
`playwright.config.ts` reuses that server outside CI; without it, the configuration would
start development mode, which is not this recorded production verification. Both task
servers are now stopped; this document does not automatically start or authorize services.

Before invoking, inspect the existing checkpoint: it must have stage `exported`, reference
`QA-REVIEW-DECISIONS-1794130378087` and shipment ID
`ba011c70-806d-4bbd-b887-c8ed3ffd521c`, still at exported revision 13. If the checkpoint or
saved state is missing, inconsistent or at another stage, **stop for manual inspection**.
Never remove the resume argument, roll back its stage, automatically rerun fresh creation,
or reseed an exported shipment's saved review state. Earlier resume stages can mutate data
and are not authorized by this reproduction recipe.

```sh
PLAYWRIGHT_WORKFLOW_QA=1 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/saurabh/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
WORKFLOW_QA_DIR=/tmp/opencode/cargoverity-decisions-qa/initial \
WORKFLOW_QA_RESUME=/tmp/opencode/cargoverity-decisions-qa/initial/report.json \
npx playwright test tests/e2e/workflow-decisions.spec.ts --reporter=list
```

Credentials belong only in configured environment variables: `PLAYWRIGHT_E2E_EMAIL`,
`PLAYWRIGHT_E2E_PASSWORD`, `PLAYWRIGHT_MANAGER_EMAIL`, `PLAYWRIGHT_MANAGER_PASSWORD`,
and the existing service/database environment. No credential values are recorded here.
The exported-stage recipe performs read-only shipment/database verification, authentication
and a denied Executive POST probe; it still writes local reports/captures and appends
summaries. It is not an all-GET or artifact-preserving invocation.

## Confirmation evidence and finish verdict

- `/tmp/opencode/cargoverity-decisions-qa/initial/report.json`: aggregate same-shipment
  checkpoints, final state, receipt/approval IDs and download hash. The directory contains
  24 unique initial captures; reports were recaptured on resume. Duplicate capture names
  and check-log entries reflect resumes, not additional records or fresh workflow runs.
- `/tmp/opencode/cargoverity-decisions-qa/initial/first-run-error.md`: preserved original
  timeout and successful mapping snapshot, not a clean-run report.
- `/tmp/opencode/cargoverity-decisions-qa/initial/synthetic-evidence-memo.md` and
  `verified-export.csv` in the same directory: labeled synthetic exception evidence and
  the actual verified download, respectively.
- Production read-only plus isolated-fixture confirmation:
  `node /tmp/opencode/cargoverity-decisions-confirm.mjs` passed. Its report is
  `/tmp/opencode/cargoverity-decisions-qa/confirmation/report.json`: two check groups,
  24 captures, no reported errors, at 1440×900, 1280×800, 1024×768 and 390×844.
  All 24 images were opened and validated by the builder and independent reviewer.
- Authenticated final confirmation covered loaded PDFs and desktop split, retained
  machine mismatch, searchable audit, export preflight/receipt and keyboard horizontal
  report scrolling. Initial manager captures had clipped titles/footers, and some initial
  PDF backgrounds were partially loaded; the corrected confirmation supersedes them.
- `manager-fixture-{width}.png` captures are **isolated synthetic component proof only**.
  The fixture is not mounted in the app, omits the actual decision selector and calls no
  mutation API. It proves corrected title/action visibility, safe Cancel focus, comment
  validation, Escape and trigger-focus restoration—not a fresh authenticated pending-manager
  approval after the dialog fix. That final authenticated approval recapture was not performed.

| Confirmation viewport width | Evidence client height / scroll height |
|---|---|
| 1440px | 641 / 641px (fits) |
| 1280px | 567 / 641px |
| 1024px | 535 / 641px |
| 390px | 567 / 901px |

The corrected title, Cancel and Approve actions were visible at all four viewports while
evidence had its own scroller. The once-only mechanical scan at
`/tmp/opencode/cargoverity-decisions-qa/detector.json` returned `[]`.

Independent reviewer `ses_e45581e1dffepbhfz8W2zvZXTo` finalized normalized disposition
**SHIP**, covering the whole supplied local UI-extension review, with no material UI
corrections requested. This is not deployment certification. The documentation handoff
explicitly supersedes the reviewer's initial suggestion to update `DESIGN.md`; preservation
is the binding task boundary. No reference comp/QUALITY BAR was needed for this pinned,
code-led extension.

These evidence paths and `.impeccable/surfaces/workflow-decisions.md` are local, **not
versioned**; temporary artifacts may not survive cleanup. This file is the versionable
QA record, not a visual golden. No shipping raster assets were introduced. Production
port 3000 and isolated-fixture port 4173 were stopped, with no listening sockets confirmed
by the coordinator.

## Synthetic record lifecycle and limitations

One newly authorized shipment, **QA-REVIEW-DECISIONS-1794130378087**
(`ba011c70-806d-4bbd-b887-c8ed3ffd521c`), ends **EXPORTED**, saved/approved revision **13**.
Its aggregate report records two server export receipts and one approval; the first export
receipt survives the refused tampered browser download. Five machine checks pass, while
the 45kg weight mismatch (Invoice 3120kg versus Packing List/Bill of Lading 3165kg) remains
immutable and human-cleared separately. The memo tests exception/sign-off guards only:
it is not supplier correspondence. Invoice importer/date were labeled QA assumptions from
supporting documents, not Invoice-observed facts.

No existing records were mutated. Latest read-only database verification records prior
**QA-OPERATIONS-1794127284984** (`a35fb03a-46c3-426a-8440-13cdfc19cc51`) at revision **5**,
**NEEDS_REVIEW**. Earlier **QA-REVIEW-20261107-01** remains outside this task's mutation
scope; its prior handoff records **EXPORTED**, revision **22**, but the latest test did
**not** database-verify that older shipment.

Deterministic extraction fixtures prove workflow behavior, not successful live AI extraction,
client accuracy, benchmark attainment or customs clearance. Synthetic documents/evidence must
never be filed with customs or presented as client evidence. Browser QA used headless emulated
Chromium; no physical-device, other-engine, screen-reader, deployment or performance
certification is implied. `PRODUCT.md` remains the synthetic-workbench product authority.

## Incumbent-system comparison and preserved drift

Checked `DESIGN.md` against `src/app/globals.css`, the shared ConfirmDialog, and the named
Checks/History/manager/export/report source samples. The neutral surfaces, single blue
interaction/focus accent, fixed Inter hierarchy, mono identifiers/values, flat bordered
panels, dialog-only elevation and semantic warning/danger/neutral states match the incumbent
system. Human exceptions remain neutral; workflow explanations and failures remain visible.
Scrollable evidence and wider manager content use existing component/layout vocabulary,
not a new token system or a new global density/type rule.

Pre-existing documentation drift remains: `DESIGN.md` describes the older shared-foundation/
review-only migration scope, uses noncanonical headings and token tables rather than YAML
frontmatter, and retains historical verification counts. `.impeccable/design.json` is absent.
These observations are recorded **without repair**, schema conversion or surface-specific
rules being promoted into shared identity.

This documentation pass created only `docs/workflow-decisions-qa.md`. It preserved
`DESIGN.md`, `PRODUCT.md`, the absent sidecar, all source/tests and unrelated work; it ran
no browser, build, test, database or capture tools and made no commits or pushes.
