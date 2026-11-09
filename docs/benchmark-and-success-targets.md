# CargoVerity — Success Targets & Benchmark Status (Week 6 — Step 3)

**Last revised:** 2026-11-09  
**Review Gate:** Week 6 Gate E (client-ready MVP)

**Summary: none of the three client success targets has been measured.** Synthetic checks and machine timings exist and are reported below, labelled as such. An earlier version of this document reported a "1.2 minute" entry time and "PASSED". That figure came from a script that used timers and an assumed 2.2 seconds per field. It was not a measurement, and it has been removed along with the script logic that produced it.

---

## 1. Target 1: Field extraction accuracy (95%)

| Item | State |
|---|---|
| Target | at least 95% field-level accuracy before manual correction |
| Status | **NOT MEASURED** |
| Reason | The client's 200 labelled historical shipments have not been supplied. |
| What exists | A synthetic smoke test: 32 of 32 expected fields matched on 5 synthetic documents (`docs/real-ai-smoke-test-report.md`). These documents were written by the project team, so the result shows the pipeline works. It does not estimate real-world accuracy. |
| Claim allowed | None for the 95% target. |

Comparison rules to use once the client set arrives:
1. Text fields (exporter, importer, vessel, document number): normalize whitespace, punctuation, case and corporate suffixes, then compare for equality.
2. Numeric fields: compare as canonical decimals. Weights pass within ±0.5%. Money totals must match exactly.
3. A correctly extracted `null` for an absent optional field counts as correct. A value invented for an absent field counts as an error.

Next action: obtain the 200 shipments with human-verified answers, run the batch comparison, and publish numerator and denominator.

---

## 2. Target 2: Entry time (under 15 minutes)

| Item | State |
|---|---|
| Target | a shipment goes from upload to ready for approval in under 15 minutes |
| Status | **NOT MEASURED** |
| Measured | Machine time only: the AI call took 2.3 to 45.5 seconds per one-page document, 29 seconds on average (5 runs, `docs/real-ai-smoke-test-report.md`). Cross-check execution time was not measured end to end. |
| Not measured | Reviewer time, and the manual baseline. The "35 minutes" manual figure in earlier drafts was an assumption. |

Protocol to measure it:
1. Use at least 10 representative shipments, ideally from the client's real or realistic anonymised documents.
2. Have operators who did not build the app enter each shipment manually in the current process, and time it.
3. Have the same operators process comparable shipments in CargoVerity, timing from shipment creation to `READY_FOR_APPROVAL`, including extraction waiting time.
4. Report the count, median, minimum and maximum for both methods, and say who the operators were.

---

## 3. Target 3: Amended Bills of Entry (3-month reduction)

Status: **NOT MEASURED. It cannot be measured before production use.** Amendments are filed weeks or months after arrival.

Measurement plan:
1. Collect 90 days of historical filing data before rollout and compute the baseline rate: amended Bills of Entry divided by total Bills of Entry.
2. Track all shipments processed through CargoVerity for 90 days (about 3,300 at 1,100 shipments a month) and record the amendments received afterwards.
3. Categorize amendments. Clerical and arithmetic errors (weight mismatch, package count, line totals) are what the cross-checks target. Valuation and classification disputes (HSN, exchange rate, duties) are out of scope, because CargoVerity does not classify HSN or compute duty.
4. Compare the clerical-amendment rate before and after, and state the sample sizes. No significance claim is made without them.

---

## 4. Scorecard

| Target | Required | Measured value | Status |
|---|---|---|---|
| Field accuracy | at least 95% | none (32/32 on synthetic documents is not evidence) | Not measured |
| Entry time | under 15 minutes | none (machine time only: 29 s per page average) | Not measured |
| Amendment reduction | noticeable decrease | none | Not measured, plan documented |

`npm run test:benchmark` prints this status. It makes no simulated measurements.
