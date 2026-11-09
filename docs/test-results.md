# CargoVerity Test Results

**Run date:** 2026-11-09  
**Commit:** [FILL: output of `git rev-parse --short HEAD`]  
**Node.js:** 24.22.2

## 1. Summary

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Passed, no errors |
| Type check | `npm run typecheck` | Passed, no errors |
| Prisma schema | `npm run db:validate` | Valid |
| Unit tests | `npm test` | 927 passed, 0 failed |
| Integration tests | `npm run test:integration` | 80 passed, 0 failed, 8 files, run twice in a row (about 291 seconds per run) |
| End-to-end tests | `npm run test:e2e` | 26 passed, 1 skipped by design (the opt-in `workflow-decisions` test needs `PLAYWRIGHT_WORKFLOW_QA=1`). Run on 2026-11-09 in two parts: 25 tests in 1.7 minutes, then the operations test in 1.0 minute. See section 4 |
| Production build | `npm run build` | Passed |

## 2. Unit tests

927 tests across the files in `tests/unit`. They use mocked providers and mocked database access. They cover normalizers, the six cross-check rules, AI response validation, retry policy, error mapping, route authorization, upload validation, export guards, the monthly AI budget logic, and the security rules listed in `docs/security-and-privacy.md`.

## 3. Integration tests

**Environment.** The tests ran against the project's Supabase development database and private Storage bucket (region `ap-southeast-1`, Singapore). The AI provider is a scripted stand-in that returns fixed responses, so no live AI call is made and no AI cost is incurred. Each file creates its own tagged shipments. Not every file removes them, so each run leaves a few test shipments (6 after the second run) that are removed with `scripts/cleanup-test-shipments.mjs --apply`.

**Command.** `RUN_INTEGRATION_TESTS=1 vitest run tests/integration --no-file-parallelism` (the `npm run test:integration` script).

**Result.** 8 test files, 80 tests, all passed. The run was repeated and passed again with the same counts.

| File | What it checks | Tests |
|---|---|---|
| `documents-upload.test.ts` | Private upload, server-side validation, versioning, concurrent completion, Storage MIME and size limits, signed URLs, sample loader | 8 |
| `extraction-workflow.test.ts` | Batching, persistence of source quotes and pages, quota failure and retry, rate-limit retry, race on run creation, locked shipments, abandoned runs, manual fallback | 10 |
| `week4-crosscheck-review.test.ts` | Cross-check runs, review actions and resolution rules | included in the 80 |
| `week4-line-mappings.test.ts` | Manual line mappings, database constraints, immutable history | 6 |
| `week5-submission.test.ts` | Submission gates, stale revisions, scope, a submission racing a correction | 7 |
| `week5-decision-export.test.ts` | Manager decision, guarded export, reports, list | included in the 80 |
| `pyramid-flows.test.ts` | 14 database and transaction flows, including audit rows, approval invalidation after an edit, export event, and cascade deletion | 14 |
| `shipments.test.ts` | Shipment creation and listing | included in the 80 |

**Earlier failure.** One integration test was reported as failing in an earlier run by the project owner. [FILL: name of the failing test and the error message, and what fixed it. If it did not repeat, write "It did not repeat in two consecutive full runs on 2026-11-09 and is treated as an intermittent failure."]

## 4. End-to-end tests

**Environment.** Playwright with Chromium against a local dev server (`http://127.0.0.1:3000`) connected to the project's Supabase development database and Storage, using the synthetic Executive and Manager accounts. 27 tests in 9 files.

**First run (2026-11-09).** 4 failed and 2 were skipped as a result, and the run stopped at the operations test. The causes were out of date tests and one real layout bug:

| Test | Cause | Fix |
|---|---|---|
| Sample loader (`documents.spec.ts`) and viewer (`review-viewer.spec.ts`) | The locator "Load sample documents" matched both the section heading and the button | Click the `summary` element instead |
| Home page loads | The test expected the old headline "Less retyping. Closer review." | Updated to the current headline |
| Enlarged labels on a 390 px screen (`home.spec.ts`) | **Real bug.** With text at 200 percent, the cost table on the landing page was wider than the screen (519 px on a 390 px viewport) and caused horizontal scrolling | Allowed the table text to wrap on small screens (`src/app/page.tsx`). The page width is now 390 px |
| Viewer tests 15 and 16 | Skipped because the earlier test in the same file failed | Pass after the fix |
| Operations (`operations.spec.ts`) | The test looked for form labels "Supplier name", "Importer name" and "Exporter name", but the labels are now "Supplier", "Importer" and "Exporter". It then waited 6 minutes and timed out. It also expected the pager text "1-1 of 1 shipments" but the page shows "1-1 of 1" | Updated both |

**After the fixes.** 25 tests passed in 1.7 minutes with the operations test left out, and the operations test passed in 1.0 minute on its own. One test is skipped on purpose: `workflow-decisions.spec.ts` is opt-in (`PLAYWRIGHT_WORKFLOW_QA=1`) because it runs a long flow with live AI and creates labelled records. It was not run for this submission. Totals: 26 passed, 0 failed, 1 skipped.

The end-to-end tests also create shipments (24 were left after this session). They are removed with `scripts/cleanup-test-shipments.mjs --apply`.

## 5. Real AI test (not part of the automated suites)

A separate script, `npm run test:smoke`, calls the real Groq model on synthetic documents. Five runs on 2026-11-06 matched 32 of 32 expected fields. Details and caveats are in `docs/real-ai-smoke-test-report.md`. This shows the pipeline works. It is not an accuracy estimate.

## 6. Deployed application check

Done by the project owner on https://cargo-verity-32o7.vercel.app. [FILL: date and the result of each row of the smoke test in `docs/deployment.md` section 10.]

## 7. What the tests do not cover

- Accuracy on real client documents (no labelled client set exists).
- Reviewer time against a manual baseline.
- Handwriting, other languages, other document types, and very degraded scans.
- Load and concurrency beyond the race cases in the integration tests.
- Backup and restore.
