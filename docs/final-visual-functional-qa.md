# Final visual and functional QA — 2026-11-08

## Outcome

Fresh authenticated Playwright MCP QA covered all six page templates and missing-page/record recovery. Confirmed UI issues were fixed without changing server contracts or workflow guards. Final lint, typecheck, unit tests, production build, and whitespace checks passed. This was a resumed, multi-batch QA session, **not an uninterrupted green end-to-end run**.

The incumbent neutral/blue design system, existing routes, tabs, dialogs, and desktop document/inspector split remain intact. No commit or push was made.

## Environment and evidence

- Actual production application: `http://127.0.0.1:3000`, Next.js **16.4.4**, React 19.
- Playwright **MCP**, headless isolated cached Chromium; executable configured in `opencode.json`. No standalone browser fallback was used for this fresh QA.
- Emulated viewports: **1440×900, 1280×800, 1024×768, 390×844**.
- Artifact root: `/tmp/opencode/cargoverity-final-qa/`.
- **82 initial + 39 confirmation PNGs**, including a dedicated mobile keyboard-focus capture. All 39 final confirmation image widths match their intended viewports. All initial and final contact sheets and selected full-size originals were inspected.
- `screenshot-manifest.json` records actual dimensions, expected widths, and SHA-256 for every screenshot. `inspection/initial-1.jpg` through `initial-7.jpg` and `inspection/confirmation-1.jpg` through `confirmation-4.jpg` provide inspection sheets.
- `events.jsonl` preserves recorded browser results, interruptions/continuations where recorded, accessibility results, protected checkpoints, and final shipment/export state. MCP call errors are additionally preserved in the session transcript; the JSONL is not a complete execution trace.
- Scripts, `final-qa-confirmation.txt`, `final-qa-targeted-confirmation.txt`, the synthetic evidence memo, and `verified-export.csv` are retained in the artifact root. They contain no embedded account credentials. Credentials were read into runtime memory from a temporary loopback bridge; populated real-account login fields were not captured.
- Screenshots/scripts are local evidence, not shipping assets or committed visual goldens, and may not survive temporary-directory cleanup.

## Fresh coverage

| Surface | Browser verification |
| --- | --- |
| `/` | All four sizes; CTA navigation, no nested interactive elements after fix, keyboard-visible 44px sign-in target, shared colors and truthful source-evidence wording. |
| `/login` | All four sizes; required-email validation, sign-up/sign-in switching, password autocomplete, unique streamed input IDs, busy email/password/mode controls disabled, real invalid-credential message, successful Executive and Manager login. Sign-up presentation only: no account was created. |
| `/dashboard` | Executive/Manager views; all four sizes; reference/status filtering, reset, pagination, mobile secondary filters/totals, empty results, inverted-date guard, transport failure and retry, creation focus/required-reference validation, actual new shipment creation, sign-out. Final queue-view buttons passed sequential Tab focus, visibility, 44px height, and unclipped focus rings on mobile; Missing documents/Awaiting approval selection remained functional. |
| `/shipments/[id]` | All four sizes; identity/parties and empty/populated intake, real private uploads, unsupported/empty/oversized client rejection with **zero upload-authorizations**, replacement-consent refusal/cancel, final exported intake locks. No successful document replacement is claimed in this fresh run. |
| `/review/[id]` | All four sizes; desktop split, mobile Document/Review and Fields/Checks/History switching, next-uncertain interaction, page-2 source navigation, zoom/rotation/reset, retained field draft on refresh and discard, manual-entry open/close, missing required-field corrections, explicit field confirmations, line mapping, recomputation, required resolution evidence, retained resolution draft, blocked submission/export, real submission and manager decisions, immutable results, audit search/reset, secure-document failure/retry, document-ID compatibility, exported read-only controls. Manual-entry saving/conflict recovery was not newly exercised. |
| `/reports` | All four sizes; displayed metric agrees with authenticated report API, field/supplier search, sort control, method/target disclaimer, failed refresh retaining previous snapshot, successful retry. Report agreement is not calibrated AI accuracy. |
| Missing routes/records | Generic missing route and authenticated missing shipment/review IDs; branded non-disclosing recovery with queue/home links. Anonymous protected-page requests redirect to login. |

### Dialogs and guards

- Blocked export and pending Manager decision were captured at all four sizes, as were exception-draft and ready-export states. The actual Manager decision selector remained in the application; no UI substitution was used.
- Manager comment validation and synthetic evidence display passed. Escape closed the decision dialog and restored its trigger focus. Audit-history inspection/search/reset passed.
- Mobile pending-decision dialog bounds were **358×810px**, left/right **16/374px**, within the 390px viewport, with a scrollable body and visible footer.
- Missing required fields/checks prevented submission; blocked export disabled CSV download.
- Executive manager decision returned **403**. Stale Manager decision returned **409 / STALE_REVISION**.
- Anonymous queue, reports, private-document endpoint, and export-preview requests returned **401**. Both roles signed out to `/`; the final Executive queue request after sign-out returned **401**.
- Tampering one export response byte caused **no browser download**; fresh preflight enabled a clean re-download. The actual saved CSV matches the server checksum below. The initial Manager script timed out only after saving this file because it expected sign-out to `/login`, rather than the intended `/`.
- No authentication, authorization, revision, evidence, submission, approval, export, or immutable-result guard was bypassed by an application change.

## Fixes and regression coverage

- `src/app/page.tsx`: replaced nested link/button CTAs with semantic links; added focus/target sizing, shared tokens and decorative-icon semantics; changed the unsupported claim that every value always has source evidence to “where available.”
- `src/app/login/page.tsx` and `src/features/auth/login-form.tsx`: shared shell/alert tokens, `useId` label associations for coexisting streamed forms, busy-control disabling, touch-sized and keyboard-visible navigation.
- `src/app/not-found.tsx`: added branded queue/home recovery without revealing whether an inaccessible record exists.
- `src/features/review/review-workspace.tsx` and `document-viewer.tsx`: added valid named group/region roles to the existing labeled containers; no review logic changed.
- `src/features/dashboard/dashboard-shell.tsx`: replaced horizontally clipped queue-view overflow with wrapping and focus-ring padding. The initial “Missing documents” focus probe **failed**; after the targeted fix all four sequential keyboard probes passed. Wrapping increases mobile toolbar height, so the first shipment's action can require scrolling; this is not an above-the-fold guarantee.
- `tests/unit/public-ui.test.ts`: four public UI regressions. Existing review rendering tests now assert valid named roles. `tests/unit/operations-ui.test.ts` adds the mobile wrapping/focus-padding regression.

## Accessibility results

Axe scans used WCAG 2 A/AA, 2.1 AA, and 2.2 AA tags. Initial scans found no reported violations but did produce incomplete checks for duplicate streamed login IDs, invalid named review containers, and four mobile queue contrast nodes clipped by horizontal overflow. Incomplete checks were investigated, not counted as passes.

After fixes, the latest scan of each tested home/login/queue/shipment/review/reports desktop/mobile state returned **zero reported violations and zero incomplete checks**. The mobile 404 scan also returned zero for both. Review semantics were rechecked after the role edits; queue desktop/mobile scans were rechecked after wrapping. The successful broad confirmation and targeted final confirmation each reported **zero runtime page errors**. Earlier intentional aborted requests and interrupted scripts generated console errors, so this is not a claim of a globally error-free session.

Reduced-motion emulation produced `transitionDuration: "0s"` for the sampled queue refresh control. Automated scans and keyboard probes are not screen-reader or accessibility certification, and do not cover every dialog/state.

## Synthetic record and integrity

Only the new labeled record was mutated for this fresh QA:

- Reference: **`QA-REVIEW-FINAL-1794134744762`**.
- Shipment ID: **`e1b13126-6956-4069-90f2-757821711222`**.
- Three newly generated two-page PDFs uploaded through real private storage; each document completion returned **201**. Authorized deterministic extraction fixtures were then seeded once for this new record, not existing shipments.
- Real saved corrections/confirmations, mapping, evidence-backed exception, submission, Manager return/resubmission, approval, and guarded export were exercised against the application.
- Authoritative final read: **EXPORTED, revision 11**, three current documents, **five machine PASS results**. Gross weight remains **MISMATCH**, with **HUMAN_CLEARED** separately derived from the accepted exception/sign-off.
- Importer/date corrections explicitly describe QA assumptions supported by Packing List/Bill of Lading, not Invoice-observed facts. `QA-REVIEW-FINAL-1794134744762-MEMO` is synthetic workflow evidence, not supplier correspondence or customs clearance.
- Actual downloaded CSV: **896 bytes**, SHA-256 **`63f4a7591f44c9eef927d6bf328718d23a67aea2d32010b19f88e92b5c6feb62`**. Fresh final server preflight returned the same checksum.

Read-only protected checkpoints remained unchanged:

| Shipment | Final checkpoint |
| --- | --- |
| `QA-REVIEW-DECISIONS-1794130378087` / `ba011c70-806d-4bbd-b887-c8ed3ffd521c` | EXPORTED, revision **13** |
| `QA-OPERATIONS-1794127284984` / `a35fb03a-46c3-426a-8440-13cdfc19cc51` | NEEDS_REVIEW, revision **5** |

## Script and screenshot reconciliation

- Initial scripts required locator corrections (responsive hidden controls, heading/button names, labeled page input, modal-hidden role queries), hydration/state waits, and explicit draft discard before recomputation. A beforeunload pause led to overlapping continuation on the same new shipment. QA resumed without reseeding; intermediate snapshots are not a reliable sequential revision ledger. Final state above comes from the final read-only API check.
- The first busy-login interception continuation failed with “Route is already handled”; its cleanup/wait order was corrected, then the broad confirmation completed successfully.
- The first public UI unit-test run had two assertion failures from HTML attribute order/casing. Corrected assertions and all subsequent final tests passed.
- Initial `review-fields-1024.png`, `review-fields-1280.png`, and `review-fields-390.png` actually have width **1440px** and are excluded as proof of those named viewports. Correct-size replacements exist in `confirmation/`.
- Two early mobile confirmation images measured **418px** during responsive capture and were replaced with verified **390px** images. Final targeted captures additionally waited for PDF `data-state="ready"`, replacing earlier resize/loading frames in the desktop review captures. The manifest reflects final files, not overwritten intermediates.
- The confirmation fix pass included targeted review-role and queue-focus checks; the full mutation workflow was not rerun after these presentation-only fixes.

## Final commands and cleanup

| Command | Final result |
| --- | --- |
| `npm run lint` | Passed, no warnings |
| `npm run typecheck` | Passed after final source edits |
| `npm test` | **897 tests passed / 56 files** (configured unit suite; not a separate integration/E2E run) |
| `npm run build` | Passed; Next.js 16.4.4 production compilation, TypeScript and prerendering |
| `git diff --check` | Passed |
| Impeccable mechanical detector on changed UI targets | `[]` findings |

Task-owned production server and runtime credential bridge were stopped; temporary in-repository scripts were copied to the external artifact root and removed. No existing shipment was deleted or reset.

## Remaining limits

No successful live AI extraction/provider recovery, account creation/email confirmation/auth callback, every API branch, every keyboard shortcut/dialog condition, physical-device testing, Safari/Firefox, screen-reader certification, client benchmark, customs compliance, or production deployment certification is established. Earlier operations/workflow handoffs document additional historical coverage but are not fresh results for this pass.

`next start` warned that the configured standalone output should use `node .next/standalone/server.js`; the initial server also logged a `pg` concurrent-query deprecation warning. The app ran for this QA and the build passed, but those warnings remain deployment/compatibility follow-ups, not proven deployment failures or silently resolved issues. Existing design-document scope/schema drift was not rewritten as a side effect of this QA.
