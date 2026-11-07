import { describe, expect, it } from "vitest";

import {
  activeResolution,
  evaluateClearance,
  selectLatestByRule,
  sortResolutions,
  summarizeClearance,
} from "@/lib/crosschecks/resolution-state";

const t0 = new Date("2026-11-06T10:00:00Z");
const exception = (id: string, extra: { evidence?: string | null; reason?: string; managerApprovedAt?: Date | null; createdAt?: Date } = {}) => ({
  id,
  type: "ACCEPTED_EXCEPTION",
  reason: extra.reason ?? "Supplier confirmed the variance",
  evidence: extra.evidence === undefined ? "TKT-8492" : extra.evidence,
  managerApprovedAt: extra.managerApprovedAt ?? null,
  createdAt: extra.createdAt ?? t0,
});
const link = (id: string, type = "SOURCE_CORRECTED", createdAt = t0) => ({ id, type, reason: "Fixed in source", evidence: null, managerApprovedAt: null, createdAt });
const failing = (resolutions: unknown[], severity = "BLOCKING", status = "MISMATCH") => ({ ruleKey: "gross_weight_comparison", status, severity, resolutions: resolutions as never[] });

describe("Shared clearance helper (Week 4 Step 8)", () => {
  it("truth table for a failing BLOCKING check", () => {
    const cases = [
      { name: "no resolution", resolutions: [], submission: false, approval: false, derived: "MISMATCH" },
      { name: "audit link only", resolutions: [link("l")], submission: false, approval: false, derived: "MISMATCH" },
      { name: "doc replacement link only", resolutions: [link("l", "DOCUMENT_REPLACEMENT")], submission: false, approval: false, derived: "MISMATCH" },
      { name: "exception without evidence", resolutions: [exception("e", { evidence: null })], submission: false, approval: false, derived: "MISMATCH" },
      { name: "exception with short reason", resolutions: [exception("e", { reason: "ok" })], submission: false, approval: false, derived: "MISMATCH" },
      { name: "valid exception, unapproved", resolutions: [exception("e")], submission: true, approval: false, derived: "PENDING_MANAGER_APPROVAL" },
      { name: "valid exception, approved", resolutions: [exception("e", { managerApprovedAt: t0 })], submission: true, approval: true, derived: "HUMAN_CLEARED" },
    ];
    for (const entry of cases) {
      const clearance = evaluateClearance(failing(entry.resolutions));
      expect({ name: entry.name, s: clearance.clearedForSubmission, a: clearance.clearedForApproval, d: clearance.derivedStatus }).toEqual({
        name: entry.name,
        s: entry.submission,
        a: entry.approval,
        d: entry.derived,
      });
    }
  });

  it("reports the specific problem for an invalid exception", () => {
    expect(evaluateClearance(failing([exception("e", { evidence: "" })])).problem).toBe("EXCEPTION_MISSING_EVIDENCE");
    expect(evaluateClearance(failing([exception("e", { reason: "no" })])).problem).toBe("EXCEPTION_MISSING_REASON");
    expect(evaluateClearance(failing([])).problem).toBe("UNRESOLVED");
  });

  it("WARNING failures, passing checks and historical results never block", () => {
    expect(evaluateClearance(failing([], "WARNING")).blocksSubmission).toBe(false);
    expect(evaluateClearance({ status: "PASS", severity: "BLOCKING", resolutions: [] }).blocksApproval).toBe(false);
    expect(evaluateClearance({ status: "NOT_APPLICABLE", severity: "BLOCKING", resolutions: [] }).blocksApproval).toBe(false);
    expect(evaluateClearance(failing([]), { isLatestRun: false }).blocksSubmission).toBe(false);
    expect(evaluateClearance(failing([]), { atCurrentRevision: false }).blocksSubmission).toBe(false);
  });

  it("a later audit link does not revoke a valid exception, and input order never matters", () => {
    const forward = evaluateClearance(failing([exception("a"), link("b")]));
    const reversed = evaluateClearance(failing([link("b"), exception("a")]));
    expect(forward.clearedForSubmission).toBe(true);
    expect(forward).toEqual(reversed);
  });

  it("sorts resolutions by createdAt then id without mutating the input", () => {
    const input = [link("b", "SOURCE_CORRECTED", t0), link("a", "SOURCE_CORRECTED", t0), link("c", "SOURCE_CORRECTED", new Date(t0.getTime() - 1))];
    const copy = [...input];
    expect(sortResolutions(input).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(input).toEqual(copy);
    expect(activeResolution(input)?.id).toBe("b");
  });

  it("summarizes blockers, pending sign-off and unresolved statuses", () => {
    const summary = summarizeClearance([
      failing([]),
      failing([exception("e")], "BLOCKING", "INCOMPLETE"),
      failing([exception("x", { managerApprovedAt: t0 })]),
      failing([], "WARNING"),
    ]);
    expect(summary.submissionBlockers).toHaveLength(1);
    expect(summary.approvalBlockers).toHaveLength(2);
    expect(summary.pendingManagerApproval).toHaveLength(1);
    expect(summary.unresolvedStatuses).toEqual(["MISMATCH"]);
  });

  it("selects the latest result per rule with a deterministic id tiebreak", () => {
    const rows = [
      { id: "b", ruleKey: "r", createdAt: t0 },
      { id: "a", ruleKey: "r", createdAt: t0 },
      { id: "z", ruleKey: "s", createdAt: new Date(t0.getTime() - 5) },
    ];
    expect(selectLatestByRule(rows).map((r) => r.id).sort()).toEqual(["b", "z"]);
    expect(selectLatestByRule([...rows].reverse()).map((r) => r.id).sort()).toEqual(["b", "z"]);
  });
});
