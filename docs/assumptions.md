# CargoVerity Week 1 decision log

**Recorded:** 2026-11-04  
**Owner:** CargoVerity implementation owner  
**Scope:** synthetic-data development/demo only

## Source labels

- `[BRIEF FACT]` — supplied by the product brief or an external policy source.
- `[DERIVED]` — calculated or observed from the repository, fixtures or a test.
- `[ASSUMPTION]` — temporary choice required to keep development moving.
- `[SYNTHETIC]` — invented demo value; not a client or customs record.
- `[PROPOSED]` — recommended decision awaiting product-owner confirmation.

## Decisions and open questions

| Decision | Label | Current status | Owner | Next action |
|---|---|---|---|---|
| Filing-software export template | `[ASSUMPTION]` `[PROPOSED]` | Open. The guarded `demo-v1` CSV is the temporary export profile; no filing-software template was supplied. | Product owner | Supply the target template and confirm column names, ordering and code lists before any production export. |
| Invoice fields | `[DERIVED]` `[PROPOSED]` | Baseline fields: exporter, importer, document number, issue date, currency, Incoterm, invoice total and line items. Missing values remain reviewable rather than invented. | Product owner | Validate against two representative supplier templates. |
| Packing List fields | `[DERIVED]` `[PROPOSED]` | Baseline fields: exporter, importer, document number, issue date, package count, net weight, gross weight and line items. | Product owner | Confirm package-type vocabulary and supplier-specific fields. |
| Bill of Lading fields | `[DERIVED]` `[PROPOSED]` | Baseline fields: exporter/shipper, importer/consignee, document number, issue date, package count, weights, container, vessel and ports. | Product owner | Confirm carrier-specific fields and whether booking/voyage fields are required. |
| Units and numeric comparison | `[ASSUMPTION]` `[PROPOSED]` | Quantities and money remain decimal strings. Weights normalize g/lb/kg; package quantities use the source unit. Cross-checks currently compare exact normalized decimals and do not silently apply a tolerance. | Product owner / customs SME | Supply approved weight, quantity and currency tolerances by rule. |
| Accepted exceptions | `[PROPOSED]` | A failed check remains visible and requires a documented resolution; an accepted exception requires manager approval before export. | Product owner | Confirm permitted resolution types and evidence requirements. |
| Hosting and database region | `[ASSUMPTION]` | Supabase Free is the development database/Auth/Storage target; Mumbai `ap-south-1` is preferred if available. Vercel Hobby is a personal synthetic-demo target. | Project owner | Confirm region availability and hosting suitability before sharing any non-synthetic data. |
| AI provider region and terms | `[BRIEF FACT]` `[ASSUMPTION]` | Groq is the primary provider and OpenRouter is optional. Provider processing is not treated as India-only; only synthetic documents are allowed. | Project owner / legal owner | Re-check current provider terms, retention and transfer conditions before any real-data use. |
| Retention and deletion | `[ASSUMPTION]` `[PROPOSED]` | Client retention policy was not supplied. No production retention promise is made; the demo keeps records until manually removed from the development project. | Product owner / legal owner | Provide retention, deletion, export and legal-hold policy. |
| Accuracy benchmark | `[DERIVED]` | The required 200-shipment labelled benchmark is not available. Synthetic fixtures validate workflow logic only and cannot establish the 95% target. | Product owner | Supply a permitted labelled benchmark and define the denominator before reporting accuracy. |

## Current synthetic fixture decision

`sample-docs/` contains only invented demonstration documents for `SHP-DEMO-002`. They are labelled as synthetic in their content and must not be used for customs filing or real customer testing.

## Week 1 gate status

- Real synthetic Groq smoke test: **PASS** for the configured vision/JSON model.
- Model, request shape, page/image limit, observed latency and usage: recorded in [`ai-feasibility.md`](./ai-feasibility.md).
- Export-template decision: **temporary `demo-v1`; target template still pending**.
- Authentication and database-backed shipment flow: implemented; hosted Auth, Manager role and private Storage still require manual environment verification.
