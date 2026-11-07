# CargoVerity

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Executives review customs-document data and submit shipments. Managers inspect corrections,
cross-check resolutions, and audit history before approving or returning a shipment for review.

## Product Purpose

An AI-assisted verification workbench for commercial invoices, packing lists, and bills of
lading. Success means fast, accurate human review with traceable evidence, not an unqualified
claim that model output is accurate or that a shipment has customs clearance.

## Operating Context

This repository is a synthetic-data development and personal demo. Private document storage,
Supabase authentication, PostgreSQL, and external AI extraction require configured services.
Provider quotas may prevent extraction; manual fallback remains available. Synthetic documents
must never be filed with customs authorities or presented as real client evidence.

## Capabilities and Constraints

- Show source documents beside extracted fields on desktop; support mobile evidence inspection.
- Make uncertain fields, review reasons, and source-page navigation readily available.
- Preserve corrections, explicit confirmation, line mapping, deterministic cross-checks,
  resolution history, and manual-entry fallback.
- Authentication, role authorization, audit history, revision checks, submission, approval,
  and export guards are authoritative server responsibilities.
- An accepted exception is a human decision, not a machine pass. Model confidence is an estimate.
- CSV export requires approval of the current revision and uses the existing demo-v1 profile.

## Evidence on Hand

The implemented workflow is described in `README.md` and `docs/architecture.md`.
`scripts/generate-sample-docs.ts` and `tests/fixtures/review-documents.ts` provide labeled synthetic
documents. There are no supplied production compliance guarantees or calibrated accuracy claims.

## Product Principles

- Evidence before assumption.
- Frequent review actions should not require searching through unrelated information.
- A saved human decision remains distinguishable from original model output.
- Never hide a failure or weaken a guard to make a demo appear complete.

## Open Decisions

Production deployment, commercial usage, jurisdiction-specific filing profiles, and operational
accessibility requirements beyond the web interface's keyboard and responsive support are not
established by this task.
