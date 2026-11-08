# CargoVerity design system

## Scope and identity

This records the shared UI foundation and its use across the public page, sign-in,
shipment queue, document intake, review workspace, and accuracy reports.
CargoVerity is a synthetic-demo customs-document verification workbench. Its interface
must support fast, accurate human review: precise typography, warm paper neutrals, ink
actions, and colour reserved for state. Amber means "a person must look at this" and is the
loudest colour on screen; red marks failing checks; blue appears only as the focus ring. No decorative gradients,
3D effects, animated status pulses, or invented accuracy/clearance claims.

Existing API contracts, authentication, role checks, audit history, revisions, submission
guards, and export guards remain authoritative. The desktop review workspace stays side
by side. Feature-specific style overrides remain supported. Review-specific behavior is recorded in
`.impeccable/surfaces/src-app-review-id-page-tsx.md`.

## Tokens

`src/app/globals.css` is the source of truth. Tailwind CSS 4 exposes semantic utilities
through `@theme inline`; use these instead of adding new literal colors to components.

| Role | CSS token | Value / utility |
|---|---|---|
| Canvas | `--background` | `#F6F6F3` / `bg-background` |
| Content | `--surface` | `#FFFFFF` / `bg-surface` |
| Secondary surface | `--surface-subtle` | `#F1F1ED` / `bg-surface-subtle` |
| Evidence backdrop | `--viewer-background` | `#E7E6E1` / `bg-viewer-background` |
| Primary text | `--foreground` | `#15171C` / `text-foreground` |
| Secondary text | `--foreground-secondary` | `#4A4F58` / `text-foreground-secondary` |
| Supporting text / placeholders | `--muted-foreground` | `#696E77` / `text-muted-foreground` |
| Divider | `--border` | `#E5E4DF` / `border-border` |
| Strong divider | `--border-strong` | `#D2D1CB` / `border-border-strong` |
| Control boundary | `--control-border` | `#8A8E96` / `border-control-border` |
| Primary action (ink) | `--primary` | `#15171C` / `bg-primary` |
| Primary hover / active | `--primary-hover`, `--primary-active` | `#2C2F37`, `#000000` |
| Focus ring | `--ring` | `#3159D4` / `ring-ring` |
| Selected surface | `--selected` | `#EFEEE9` / `bg-selected` |
| Disabled | `--disabled`, `--disabled-foreground` | `#F1F1ED`, `#696E77` |
| Attention marker (non-text) | `--warning-strong` | `#D98A0B` / `bg-warning-strong` |

| Semantic tone | Foreground | Surface | Border |
|---|---|---|---|
| Neutral | `#3D4149` | `#F1F1ED` | `#D8D7D1` |
| Success | `#1E6A46` | `#EEF6F1` | `#C6E2D1` |
| Review / warning | `#8A4A00` | `#FFF4DC` | `#F1CF8B` |
| Error / danger | `#A11D1D` | `#FDF0EF` | `#F1C6C2` |
| Information | `#2B4A8B` | `#EFF3FB` | `#CAD6EF` |

Semantic utilities follow `text-warning`, `bg-warning-surface`, `border-warning-border`,
and the equivalent `neutral`, `success`, `danger`, and `info` names. Destructive buttons
use danger foreground as their solid background, white text, `#821616` hover, and
`#4F0B0B` active. Light semantic borders are dividers, not the sole indicator of a state.

### Typography

- Inter, locally bundled variable WOFF2, is the UI face.
- JetBrains Mono is for identifiers, decimal strings, currencies, weights, quantities,
  and code. Use `font-mono tabular-nums`; do not convert decimal strings into floats.
- Fonts are loaded by `next/font/local` in `src/app/layout.tsx`. Mono is not preloaded.
  Sources, checksums, subset coverage, and SIL OFL licenses live in `src/app/fonts/`.
- Fixed rem sizes support browser text scaling; headings do not fluidly shrink.

| Role | Size / line height | Weight | Usage |
|---|---|---|---|
| Page title | 24 / 32px | 600 | `Typography variant="page-title"` |
| Section title | 18 / 28px | 600 | `Typography variant="section-title"` |
| Body / data | 14 / 20px | 400 | `Typography`, `Typography variant="data"` |
| Control label | 14 / 20px | 500 | `Label` |
| Supporting metadata | 12 / 18px | 400–500 | `Typography variant="caption"`, badges |
| Mobile input text | 16 / 20px | 400 | Native controls below 640px |

Important evidence, errors, and workflow explanations must not use caption size.
Use `Label` for actual form labels; the typography label variant is display-only.

### Spacing, shape, and motion

- Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48px (`--space-1` through `--space-12`).
  Tailwind's spacing unit remains 4px, preserving existing utilities.
- Radii: small 4px, controls 6px, panels 8px, dialogs 12px.
  Use `rounded-small`, `rounded-control`, `rounded-panel`, `rounded-dialog`.
- Panels use a 1px divider and no shadow. Overlay only:
  `0 12px 40px rgb(21 23 28 / 14%)` (`shadow-overlay`).
- Control heights: 40px default, 36px compact, 44px large. Default and compact
  controls become 44px below 640px or with a coarse pointer.
  Buttons wrap long action labels and grow when their intrinsic content needs more height.
  Explicit existing height and wrapping class overrides remain supported.
- Table header: 44px; body rows: minimum 52px, expanding for wrapped content.
- Focus: 2px blue ring with 2px offset; it is the only blue in the interface. Disabled controls use explicit colors, not opacity.
- State transitions: 150ms, with a 200ms secondary token. Reduced motion removes
  transitions and spinner motion while keeping loading text and busy semantics.
- Native scrollbars, caret, accent colors, and text selection use the palette without
  changing native interaction behavior.

## Components

Shared primitives live in `src/components/ui/`. Existing exports and native form props
remain compatible; class overrides are merged with the existing `cn` helper.

| Component | Contract |
|---|---|
| `Button` | Existing default/outline/ghost/destructive variants and sm/default/lg sizes; adds link, icon, and `loading`. Loading disables the button but retains its text. Native implicit submission is unchanged; set `type` explicitly in new code. Icon-only buttons require an accessible label. |
| `Input`, `Textarea`, `Select`, `Label` | Native controls, names, values, constraints, handlers, refs, disabled/read-only and ARIA attributes. Associate labels and errors at the call site. Invalid controls use `aria-invalid`; multiline reasons use `Textarea`. |
| `Badge` | default/outline/info/success/warning/error presentation; no automatic live region. |
| `StatusBadge` | Human-readable labels and decorative icons for existing states. Unknown states fall back neutrally. No confidence threshold, authorization, or clearance calculation. |
| `Card` family | Flat panels; header, title, description, content, footer. Titles default to h2 and support h3/h4. Avoid nested cards. |
| `Typography` | Semantic default elements and fixed scale; `as` allows the appropriate heading level. |
| `Table` family | Native table semantics, caption, column scopes, selectable-row styling. `numeric` preserves values and applies right-aligned tabular mono. `containerLabel` creates a named, keyboard-focusable overflow region. |
| `Tabs` family | Controlled or default-value state, linked tabs/panels, roving focus, arrows/Home/End, disabled-tab skipping, horizontal/vertical and RTL support. Manual activation uses native Enter/Space. Panels stay mounted to retain drafts. |
| `ConfirmDialog` | Native modal dialog, labelled title/description, safe initial Cancel focus, native focus containment/restoration. Controlled open state; caller owns mutation and success/error handling. Busy blocks duplicate confirmation and dismissal. |
| `FeedbackState`, `Skeleton` | Caller-provided text/actions. Errors use alert semantics; loading/success use status semantics. Skeletons are static, constrained to the container width, and hidden from assistive technology. |

### Application composition

- `src/components/brand.tsx` owns the wordmark and an authored SVG mark: three ruled lines
  (three documents that agree) with a check.
- `src/components/app-header.tsx` supplies Shipments/Accuracy navigation, current-page state,
  a skip link, and a native account disclosure with keyboard dismissal and sign-out feedback.
  The review workspace uses the mark with shipment-specific navigation and actions.
- Queue counts and filters stay compact. Mobile secondary filters are expandable; desktop
  rows and mobile entries retain status, document availability, review state, and next action.
- `DocumentDropzone` keeps a labelled native file input with drag-and-drop selection.
  One file belongs to each slot. Selection, private transfer, validation, and saved state
  remain distinct; replacement still requires explicit confirmation.
- Field confirmation sits beside the value. Units are inline; uncertainty reasons and source
  actions remain visible. Saved review notes and calculation identifiers use disclosures.
- Secondary metadata yields to operational content. Copy names the task and necessary
  consequence without repeating the same workflow explanation in every section.
- The public SHP-24811 example is local synthetic state: USD 16,320 invoice amount,
  3,120 kg invoice source, and 3,165 kg supporting documents. Correcting the deliberately
  transposed 3,210 kg extraction leaves the separate 45 kg cross-document difference visible.

### State semantics

- Passed checks and confirmed fields can use success presentation.
- Required review and incomplete data use warning presentation; severity remains separate.
- `HUMAN_CLEARED` reads **Exception approved** and remains neutral, not a green machine pass.
- `PENDING_MANAGER_APPROVAL` reads **Exception awaiting approval**.
- Original result, severity, reason, source evidence, revision, and resolution history
  remain the feature's responsibility. A badge never clears a blocker.
- Confidence is a **model estimate**, not calibrated accuracy. Do not hardcode a review
  threshold in a shared indicator or infer that confirmed low-confidence fields still
  require action.
- Existing APIs and server-derived clearance/readiness remain authoritative.

## Verification and follow-on work

`tests/unit/design-system.test.ts` checks real rendered component markup, native props,
class compatibility, status semantics, contrast pairs, and local font integrity.
`tests/fixtures/design-system-preview.tsx` is an isolated browser fixture, not an app route,
and makes no API/authentication requests. It covers form submission, tabs, draft retention,
dialog states, numeric tables, and the 1440/1280/1024/390px viewport set.

### Shared-foundation results — 2026-11-07

- `npm run lint`: passed, no warnings.
- `npm run typecheck`: passed.
- `npm run test`: passed, 733 tests across 46 unit-test files; 76 design-system tests.
- `git diff --check`: passed. The mechanical shared-UI scan reported no findings.
- Real browser rendering: compiled the actual fixture and Tailwind CSS with existing
  tooling, loaded the bundled WOFF2 assets, and exercised cached Chromium in React
  development Strict Mode. No application server was started. Fixture and font URLs
  were fulfilled locally; there were no authentication, API, or external network requests.
- Normal-size checks passed at 1440, 1280, 1024, and 390px: typography, spacing,
  control sizes, status presentation, native form constraints/values/submission,
  class overrides, table containment, keyboard tabs, retained drafts, dialog initial
  focus/background inertness/restoration, initially-open lifecycle, busy guards,
  loading/empty/error states, and reduced motion. Coarse-pointer controls also passed.
- The two-round browser confirmation passed 63 of 64 checks. The extra 390px /
  200%-text-size check found a 3px fixed-width skeleton overflow. A final `max-w-full`
  guard was added and covered by a rendered-markup regression assertion; that last
  guard was not rechecked in a third browser round.

Session-local runner: `/tmp/opencode/cargoverity-design-system-qa.mjs`.
Screenshots and the unmodified confirmation report:
`/tmp/opencode/cargoverity-design-system/confirmation/`.
These are local QA artifacts, not application assets or committed visual goldens.
Full application rendering, production Next.js build, authentication/connectivity,
and application-level accessibility checks were not performed at this foundation stage.
The review-only integration was subsequently completed below; other screens and backend
changes remain outside scope.

### Review integration

- `src/features/review/review-workspace.tsx` composes the responsive shell, inspector tabs,
  evidence-return navigation, and guarded workflow dialogs using the shared controls.
  Fields, checks, and history have separate inspector modules.
- `use-review-controller.ts` owns requests and saved snapshots; `review-drafts.ts` reconciles
  retained edits against incoming server data. Unsaved edits cannot be confirmed, submitted,
  approved, or exported. Conflicting values require explicit acknowledgment before saving.
- Confirmations bind to the reviewed shipment revision and check run. Captured new-run actions
  are consumed before awaiting the request; stale or failed actions must be reopened.
- Server review status determines uncertainty. Confirmed/corrected/manual decisions do not
  re-enter the queue solely because of a low model estimate or absent source quote.
- Private evidence failures show an explicit unavailable state and an authorized secure-link
  retry, never a public sample. Audit timestamps render deterministically in UTC.
- Export preflight and downloaded-byte SHA-256 must agree on checksum, filename, and profile.
  Receipts come from the server. Clipboard feedback cannot overwrite export integrity warnings.

### Review-integration results — 2026-11-08

- `npm run lint` and `npm run typecheck`: passed after the clipboard fix.
- `npm run test`: passed, **859 tests across 52 unit-test files**, including three clipboard
  recovery regressions. This is the full configured unit suite, not a separate integration run.
- `npm run build`: passed after the final source change with Next.js 16.4.4 / Turbopack,
  including TypeScript and production prerendering. `git diff --check`: passed.
- Actual authenticated Chromium application QA used Executive and Manager sessions and only
  the authorized synthetic shipment `QA-REVIEW-20261107-01`. Desktop split and mobile switching
  were confirmed at 1440×900, 1280×800, 1024×768, and 390×844. Twelve final populated screenshots
  were inspected within the bounded confirmation; no further visual-polishing round was run.
- Confirmed readable controls, aligned panes, contained text/tables, sampled text contrast,
  44px mobile controls, 16px mobile inputs, keyboard table scrolling, evidence-return focus,
  read-only approved fields, and loading/filtered-empty/error recovery.
- Eight raw font failures were case-sensitive harness assertions: computed families are
  `inter` and `jetBrainsMono`, and both bundled faces were loaded. Two raw modal Tab readings
  were native out-of-document focus transfer: window blur, `document.hasFocus() === false`,
  then return to the modal. No background application control received focus. Safe initial
  focus, background inertness, Escape, and trigger restoration passed. The original report
  is preserved unmodified alongside a separate reconciliation and targeted focus trace.
- Draft/conflict recovery, source correction history, mapping removal/recomputation,
  exception evidence/sign-off, submission withdrawal, role/stale/locked guards, manager
  rejection/resubmission/approval, and guarded export recovery were exercised against real APIs.
- One-byte export transport tampering produced no browser download, retained the real server
  receipt, and disabled retry until fresh preflight. A clean re-download was 850 bytes and
  matched the preview/server SHA-256. Clipboard denial followed by a successful retry cleared
  only the clipboard error, preserving the independent integrity warning.

Final synthetic state: revision **22**, `EXPORTED`; five machine checks pass, while gross
weight remains `MISMATCH` with neutral **Exception approved** (`HUMAN_CLEARED`). Invoice
importer/date were explicitly labeled QA assumptions supported by the Packing List and Bill
of Lading, not Invoice-observed facts. `QA-REVIEW-20261107-01-MEMO` is synthetic exception
evidence only, not supplier correspondence or customs clearance.

Session artifacts: `/tmp/opencode/cargoverity-review-qa/` (browser captures/reports/downloads
in `browser/`). They are local QA evidence, not application assets or committed visual goldens.
No shipping raster assets were introduced. The surface brief records the exact receipt,
checksum, workflow evidence, and verification limitations.

Limits: live extraction was not validated successfully (Invoice validation failure; Packing
List/Bill of Lading provider rate limits). Authorized deterministic fixtures enabled the
remaining QA; no existing shipments were reseeded. Browser verification used emulated
viewports in headless Chromium, not physical devices, other engines, or screen readers.
It does not certify production deployment, AI accuracy, or customs compliance. Unsaved drafts
are workspace-memory state; retention across full reload or route departure is not promised.

### Whole-site consistency pass — 2026-11-08

Shared branding/navigation, concise workflow copy, compact queue and field controls,
native-file-input dropzones, password visibility, and report scope disclosure now follow
the same neutral/blue foundation. No new dependencies or raster assets were introduced.

The final production build and lint passed; the unit suite passed **901 tests across
56 files**. The 18 targeted browser tests passed across the initial run and two targeted
retries: the initial run found a 200%-text heading overflow (fixed) and a cold navigation
timeout (passed on retry). Final authenticated confirmation at 1440, 1280, 1024, and
390px passed source-return navigation, account/report controls, and export preflight with
zero page errors or application mutations. Detailed current-task verification is recorded in
`docs/ui-consistency-qa.md`; earlier results above remain historical.

### Ink-and-amber redesign — 2026-11-08

The blue/slate look was replaced with warm paper neutrals, ink primary actions and an amber
attention colour, so uncertain fields are the most visible thing on any screen. Tabs use an
ink underline. Link buttons are ink with a quiet underline.

- Landing page leads with the client's problem, shows Company A's own ₹70.29 lakh cost model
  as a ledger (labelled as their figures) and the brief's targets (labelled as targets).
- Queue: one-line count summary replaces the stat cards; priority is an amber dot on the next
  action; document slots are CI/PL/BL chips (dashed when missing, amber or red by state).
- Review: single-row header with shipment reference, status and a cleared-fields meter;
  segmented document switcher with amber counts; viewer controls in one toolbar with `<kbd>`
  shortcut hints; denser field rows with an amber dot, tinted row and amber input border for
  uncertain fields, a confidence bar beside the model estimate, and a primary Confirm button
  on uncertain rows. Check rows collapse to one line with a chevron.
- Shipment, reports and sign-in screens follow the same scale; repeated limits and
  disclaimers now appear once.

Verification: lint, typecheck, `npm run build` passed; unit suite **901/901** across 56 files;
mechanical design scan `[]`; authenticated Chromium captures at 1440×900 and 390×844 of every
screen were inspected once and fixed in one batch. E2E suites were not rerun in this pass.
