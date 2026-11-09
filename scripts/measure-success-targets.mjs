/**
 * CargoVerity - Success targets status (Week 6 - Step 3)
 *
 * Prints what is and is not measured. It does NOT simulate review time: an earlier version used
 * timers and an assumed seconds-per-field to produce a "1.2 minute" result, which was not a
 * measurement and has been removed. The written record is docs/benchmark-and-success-targets.md.
 *
 * Target 1 (95% field accuracy)  : needs the client's 200 labelled shipments. Not measured.
 * Target 2 (< 15 min entry time)  : needs timed sessions with real operators. Not measured.
 * Target 3 (fewer amended BoEs)   : needs a 90-day before/after window. Not measured.
 */

const targets = [
  {
    name: "Field accuracy >= 95%",
    status: "NOT MEASURED",
    evidence: "Only the synthetic smoke test exists: 32/32 fields on 5 synthetic documents (docs/real-ai-smoke-test-report.md). Not evidence for the target.",
    needs: "200 client shipments with human-verified answers",
  },
  {
    name: "Entry time < 15 minutes",
    status: "NOT MEASURED",
    evidence: "Machine time per page was measured (2.3 to 45.5 s, average 29 s). Reviewer time and the manual baseline have not been measured.",
    needs: "Timed sessions: at least 10 shipments each for manual and assisted entry, by real operators",
  },
  {
    name: "Fewer amended Bills of Entry",
    status: "NOT MEASURED",
    evidence: "Cannot be measured before production use.",
    needs: "90 days of baseline data and 90 days of use",
  },
];

console.log("CargoVerity success targets (no simulated numbers)\n");
for (const t of targets) {
  console.log(`${t.name}\n  Status:   ${t.status}\n  Evidence: ${t.evidence}\n  Needs:    ${t.needs}\n`);
}
