---
name: cargoverity-ui
description: Use whenever designing, implementing, modifying or reviewing CargoVerity frontend UI, UX, responsive layouts, document review screens, design tokens or visual interactions.
---

# CargoVerity UI Engineering Skill

## Product identity

CargoVerity is an enterprise customs-document verification
workbench for commercial invoices, packing lists and
bills of lading.

Its primary design objective is fast, accurate human review.

## Design philosophy

- Minimal, precise and professional.
- Neutral surfaces and restrained accent colors.
- Strong typography and information hierarchy.
- No decorative elements without purpose.
- Avoid generic AI-generated SaaS aesthetics.
- Prioritize workflow efficiency over visual effects.

## Critical review workspace rule

Always preserve a side-by-side document viewer
and extracted-field inspector on desktop.

Uncertain fields must be recognizable immediately.

Provide visible review reasons and source evidence.

Keep frequent review actions immediately accessible.

## Technical constraints

- Next.js 16 App Router.
- React 19.
- TypeScript.
- Tailwind CSS 4.
- Existing local shadcn-style components.
- Lucide React.

Reuse existing application components and API contracts.

Never bypass authentication, role authorization,
audit history, revision checks or approval guards.

## Visual QA

Test actual browser rendering.

Inspect:
- 1440px desktop
- 1280px laptop
- 1024px tablet
- 390px mobile

Verify alignment, spacing, readability, status indicators,
loading states, empty states and interactive behavior.

Avoid unnecessary packages, animations and 3D effects.

A 3D illustration is allowed only when it adds meaningful
product identity. Never sacrifice review workspace usability.
