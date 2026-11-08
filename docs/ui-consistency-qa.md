# Whole-site UI consistency — 2026-11-08

## Changes

- Shared CargoVerity branding, Shipments/Reports navigation, account disclosure, and skip link.
- Compact shipment counts, queue views, field controls, and repeated workflow explanations.
- Single-file drag-and-drop on the existing private document-upload flow.
- Password visibility toggle; consistent sign-in and recovery presentation.
- Inline field units and confirmation, expandable saved notes, visible uncertainty reasons
  and source access, and quieter calculation references.
- Shorter checks, approval, export, and report copy using the existing server-derived state.
- Corrected public sample: USD 16,320 invoice amount; 3,120 kg invoice and 3,165 kg supporting
  document weights. The 45 kg discrepancy persists after the illustrative extraction correction.

## Verification

- `npm run lint`: passed after final source edits.
- `npm run typecheck`: passed; the subsequent final production build also passed TypeScript.
- `npm run test`: **901 passed across 56 files** after final source edits.
- `npm run build`: passed, Next.js 16.4.4/Turbopack.
- One mechanical design scan across changed surfaces and review components returned `[]`.
- `git diff --check`: passed.

Actual Chromium application rendering was inspected at 1440×900, 1280×800, 1024×768,
and 390×844. The initial mobile review capture preceded hydration; waiting for the mobile
layout resolved that capture without a layout change. An existing 200%-text browser test
found a genuine landing-heading overflow; word wrapping was restored and the test passed.

The targeted Playwright set covered `home`, `authenticated`, `documents`, `operations`,
`review-viewer`, and `roles`: **16/18 initially passed**, then **2/2 targeted retries passed**.
The other initial failure was a 30-second cold navigation timeout before the login form.
No assertions were relaxed to obtain a pass.

Browser-tested interactions include:

- Local sample document switching, correction/reset, keyboard navigation, and retained discrepancy.
- Login states, creation, duplicate reference rejection, queue search, and sign-out followed by 401.
- Single-file drop selection, multiple-file rejection, and ignored drops while upload is disabled.
- Unsupported/empty/oversized client rejection, server magic-byte rejection, real private uploads,
  versioned replacement, replacement confirmation, duplicate rejection, and signed PDF preview.
- Distinct authorization/byte-transfer/validation states; stale revision, role, and anonymous guards.
- Queue status/date/view filters, reset, empty states, transport failure, and recovery.
- Real PDF canvas rendering, zoom, rotation, secure-link retry, and mobile Document/Review switching.

The final read-only confirmation passed account keyboard opening/dismissal/focus restoration,
shared navigation, report metric agreement, supplier search/reset/sort, and report refresh
failure/recovery. At all four widths it verified read-only fields, saved-note disclosure,
source navigation with return focus, the retained original mismatch under an approved
exception, and refreshed export preflight. All 19 captured layouts were contained within
the viewport; the run recorded zero page errors and zero application mutation requests.
The public mobile navigation also passed Escape/focus restoration.

## Synthetic data and artifacts

Browser mutations used newly created synthetic test shipments. The operations record is
`QA-OPERATIONS-1794154037861`, ID `8ea83339-dc22-48eb-9029-adef074806b2`, revision 5,
with Invoice v2 and the other documents v1. Live extraction was not requested.
Existing `QA-REVIEW-20261107-01` was used read-only for visual inspection.

Local evidence (not application assets or committed visual baselines):

- `.playwright-mcp/design-initial/`
- `.playwright-mcp/design-confirmation/`
- `/tmp/opencode/cargoverity-polish-e2e/`
- `/tmp/opencode/cargoverity-polish-e2e-retry/`

The current task did not rerun live AI extraction, the full manager-decision mutation flow,
or a CSV download. Historical workflow QA in `DESIGN.md` is separate from these results.
