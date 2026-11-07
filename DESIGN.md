# CargoVerity design system

## Scope and identity

This is the approved shared UI foundation, not a redesign of the application screens.
CargoVerity is a synthetic-demo customs-document verification workbench. Its interface
must support fast, accurate human review: precise typography, neutral surfaces, one blue
interaction accent, and explicit evidence and workflow states. No decorative gradients,
3D effects, animated status pulses, or invented accuracy/clearance claims.

Existing feature layouts, API contracts, authentication, role checks, audit history,
revisions, submission guards, and export guards remain unchanged. The desktop review
workspace must stay side by side in future screen work. Current feature-specific style
overrides remain supported; migrating them is a separate screen-level task.

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

### Results — 2026-11-07

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
and application-level accessibility checks were not performed by this verification.

Screen-level migration, review-controller decomposition, document-viewer changes,
workflow fixtures/database preparation, and backend changes are deliberately deferred.
