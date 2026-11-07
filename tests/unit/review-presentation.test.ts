import { afterEach, describe, expect, it, vi } from "vitest";

import { blockingAcceptedExceptions, canEnterManualField, displayDate, fieldReviewReason, formatFieldLabel, modelEstimate, validateFieldCorrection, validateManagerDecision } from "@/features/review/review-presentation";
import type { CrossCheckResolutionData } from "@/features/review/review-types";
import { makeReviewData, makeReviewField } from "../fixtures/review-workspace-data";

afterEach(() => vi.restoreAllMocks());

describe("deterministic audit presentation", () => {
  it("renders the same timestamp in UTC for Date, ISO and offset inputs", () => {
    expect(displayDate("2026-11-07T17:52:36.000Z")).toBe("2026-11-07 17:52:36 UTC");
    expect(displayDate(new Date("2026-11-07T17:52:36.000Z"))).toBe("2026-11-07 17:52:36 UTC");
    expect(displayDate("2026-11-07T23:22:36+05:30")).toBe("2026-11-07 17:52:36 UTC");
    expect(displayDate("2026-11-08T00:00:00Z")).toBe("2026-11-08 00:00:00 UTC");
  });

  it("never calls locale-dependent formatting during SSR or hydration", () => {
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(() => { throw new Error("Ambient locale must not affect audit text"); });
    expect(displayDate("2026-11-07T17:52:36Z")).toBe("2026-11-07 17:52:36 UTC");
  });

  it("renders invalid dates without inventing a timestamp", () => {
    expect(displayDate("not-a-date")).toBe("Date unavailable");
    expect(displayDate(new Date(NaN))).toBe("Date unavailable");
  });

  it.each([
    ["PAGE_MARKED_FOR_MANUAL_ENTRY", "Page Marked For Manual Entry"],
    ["EXTRACTION_RUN_STARTED", "Extraction Run Started"], ["EXECUTIVE", "Executive"],
    ["grossWeight", "Gross Weight"], ["HSNCode", "HSN Code"], ["source_quote", "Source quote"],
  ])("formats %s without splitting acronyms into individual letters", (value, label) => {
    expect(formatFieldLabel(value)).toBe(label);
  });
});

describe("review reasons, model estimates and manual entry", () => {
  it("shows model estimates as estimates, including zero, and rejects unusable values", () => {
    expect(modelEstimate(0)).toBe("0% (model estimate)");
    expect(modelEstimate("0.72")).toBe("72% (model estimate)");
    for (const value of [null, "", "unknown", -0.1, 1.1, Infinity]) expect(modelEstimate(value)).toBe("Model estimate unavailable");
  });

  it("explains policy reasons and preserves a human's saved rationale", () => {
    expect(fieldReviewReason(makeReviewField())).toMatch(/model was unsure/i);
    expect(fieldReviewReason(makeReviewField({ reviewReason: "Verified source page 2", reviewStatus: "CORRECTED" }))).toBe("Verified source page 2");
    expect(fieldReviewReason(makeReviewField({ reviewReason: null }))).toMatch(/policy requires/i);
    expect(fieldReviewReason(makeReviewField({ reviewStatus: "PENDING", reviewReason: null }))).toMatch(/confirm it or save a correction/i);
  });

  it("unlocks only a marked page or a missing model field after an AI extraction", () => {
    const doc = makeReviewData().documents[0];
    expect(canEnterManualField(doc, "grossWeight", 2)).toBe(false);
    doc.pages[1].manualEntryRequired = true;
    expect(canEnterManualField(doc, "grossWeight", 2)).toBe(true);
    expect(canEnterManualField(doc, "grossWeight", 1)).toBe(false);
    expect(canEnterManualField(doc, "importer", 1)).toBe(true);
    expect(canEnterManualField(doc, "anotherMissingField", 1)).toBe(true);
  });

  it("supports failed-extraction fallback, but never unlocks a processing document", () => {
    const doc = makeReviewData().documents[0];
    doc.latestRunId = null;
    expect(canEnterManualField(doc, "grossWeight", 1)).toBe(true);
    doc.latestRunId = "manual-run";
    doc.extractionProvider = "manual";
    expect(canEnterManualField(doc, "grossWeight", 1)).toBe(true);
    doc.extractionStatus = "PROCESSING";
    expect(canEnterManualField(doc, "grossWeight", 1)).toBe(false);
  });

  it("does not confirm an unsaved edit or an empty saved value", () => {
    expect(validateFieldCorrection("CONFIRMED", "3165", "3120", "Reason").valid).toBe(false);
    expect(validateFieldCorrection("CONFIRMED", "", null, "Reason").valid).toBe(false);
    expect(validateFieldCorrection("CORRECTED", "3120", "3120", "Reason").valid).toBe(false);
    expect(validateFieldCorrection("CORRECTED", "3165", "3120", " ok ").valid).toBe(false);
  });
});

describe("manager decisions mirror the guarded server policy", () => {
  const ready = { hasDrafts: false, refreshRequired: false, checksStale: false };
  const exception: CrossCheckResolutionData = { id: "exception", type: "ACCEPTED_EXCEPTION", reason: "Synthetic QA discrepancy", evidence: "QA-EVIDENCE-1", createdAt: "2026-11-07T18:00:00Z" };

  it("requires comments for rejection, but not current checks", () => {
    expect(validateManagerDecision("REJECT", "Synthetic QA return", [], { ...ready, checksStale: true })).toBeNull();
    expect(validateManagerDecision("REJECT", "no", [], ready)).toMatch(/meaningful comment/i);
    expect(validateManagerDecision("APPROVE", "", [], { ...ready, checksStale: true })).toMatch(/current checks/i);
  });

  it.each([null, "2026-11-07T18:05:00Z"])("requires approval comments for accepted blocking exceptions, signed off at %s", (managerApprovedAt) => {
    const check = { ...makeReviewData().crossChecks[0], activeResolution: { ...exception, managerApprovedAt } };
    expect(blockingAcceptedExceptions([check])).toHaveLength(1);
    expect(validateManagerDecision("APPROVE", "", [check], ready)).toMatch(/meaningful comment/i);
    expect(validateManagerDecision("APPROVE", "Synthetic QA sign-off", [check], ready)).toBeNull();
  });

  it("does not require an exception comment for machine passes, warning rules or invalid exceptions", () => {
    const check = { ...makeReviewData().crossChecks[0], activeResolution: exception };
    const checks = [{ ...check, status: "PASS" as const }, { ...check, severity: "WARNING" as const }, { ...check, activeResolution: { ...exception, evidence: "" } }];
    expect(blockingAcceptedExceptions(checks)).toEqual([]);
    expect(validateManagerDecision("APPROVE", "", checks, ready)).toBeNull();
  });

  it.each(["APPROVE", "REJECT"] as const)("blocks %s while drafts or a required refresh remain", (decision) => {
    expect(validateManagerDecision(decision, "Synthetic QA decision", [], { ...ready, hasDrafts: true })).toMatch(/drafts/i);
    expect(validateManagerDecision(decision, "Synthetic QA decision", [], { ...ready, refreshRequired: true })).toMatch(/refresh/i);
  });
});
