# CargoVerity design system

## Scope and identity

This records the approved shared UI foundation and its document-review integration.
Other application screens are outside this migration's scope.
CargoVerity is a synthetic-demo customs-document verification workbench. Its interface
must support fast, accurate human review: precise typography, neutral surfaces, one blue
interaction accent, and explicit evidence and workflow states. No decorative gradients,
3D effects, animated status pulses, or invented accuracy/clearance claims.

Existing API contracts, authentication, role checks, audit history, revisions, submission
guards, and export guards remain authoritative. The desktop review workspace stays side
by side. Feature-specific style overrides remain supported; migrating other screens is a
separate task. Review-specific behavior is recorded in
`.impeccable/surfaces/src-app-review-id-page-tsx.md`.

## Tokens

`src/app/globals.css` is the source of truth. Tailwind CSS 4 exposes semantic utilities
through `@theme inline`; use these instead of adding new literal colors to components.

| Role | CSS token | Value / utility |
|---|---|---|
| Canvas | `--background` | `#F8FAFC` / `bg-background` |
| Content | `--surface` | `#FFFFFF` / `bg-surface` |
| Secondary surface | `--surface-subtle` | `#F1F5F9` / `bg-surface-subtle` |
| Evidence backdrop | `--viewer-background` | `#E8EDF2` / `bg-viewer-background` |
| Primary text | `--foreground` | `#0F172A` / `text-foreground` |
| Secondary text | `--foreground-secondary` | `#475569` / `text-foreground-secondary` |
| Supporting text / placeholders | `--muted-foreground` | `#64748B` / `text-muted-foreground` |
| Divider | `--border` | `#E2E8F0` / `border-border` |
| Strong divider | `--border-strong` | `#CBD5E1` / `border-border-strong` |
| Control boundary | `--control-border` | `#7A889C` / `border-control-border` |
| Primary / focus | `--primary`, `--ring` | `#2563EB` / `bg-primary`, `ring-ring` |
| Primary hover / active | `--primary-hover`, `--primary-active` | `#1D4ED8`, `#1E40AF` |
| Selected surface | `--selected` | `#EFF6FF` / `bg-selected` |
| Disabled | `--disabled`, `--disabled-foreground` | `#F1F5F9`, `#64748B` |

| Semantic tone | Foreground | Surface | Border |
|---|---|---|---|
| Neutral | `#334155` | `#F1F5F9` | `#CBD5E1` |
| Success | `#166534` | `#F0FDF4` | `#BBF7D0` |
| Review / warning | `#92400E` | `#FFFBEB` | `#FDE68A` |
| Error / danger | `#991B1B` | `#FEF2F2` | `#FECACA` |
| Information | `#1E40AF` | `#EFF6FF` | `#BFDBFE` |

Semantic utilities follow `text-warning`, `bg-warning-surface`, `border-warning-border`,
and the equivalent `neutral`, `success`, `danger`, and `info` names. Destructive buttons
use danger foreground as their solid background, white text, `#7F1D1D` hover, and
`#450A0A` active. Light semantic borders are dividers, not the sole indicator of a state.

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
  `0 12px 40px rgb(15 23 42 / 14%)` (`shadow-overlay`).
- Control heights: 40px default, 36px compact, 44px large. Default and compact
  controls become 44px below 640px or with a coarse pointer.
  Buttons wrap long action labels and grow when their intrinsic content needs more height.
  Explicit existing height and wrapping class overrides remain supported.
- Table header: 44px; body rows: minimum 52px, expanding for wrapped content.
- Focus: 2px blue ring with 2px offset. Disabled controls use explicit colors, not opacity.
- State transitions: 150ms, with a 200ms secondary token. Reduced motion removes
  transitions and spinner motion while keeping loading text and busy semantics.
- Native scrollbars, caret, accent colors, and text selection use the palette without
  changing native interaction behavior.

## Components

All components live in `src/components/ui/`. Existing exports and native form props
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
