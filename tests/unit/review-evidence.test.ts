import { describe, expect, it } from "vitest";

import { checkSourceTargets, comparedEvidenceRows } from "@/features/review/check-evidence";
import { auditEventDetails } from "@/features/review/history-inspector";
import { mappingSelectionIssue } from "@/features/review/line-mapping-panel";
import type { ReviewWorkspaceCrossCheck } from "@/features/review/review-types";
import { makeReviewData } from "../fixtures/review-workspace-data";

describe("recorded compared values and source navigation", () => {
  it("preserves exact raw and normalized trade values rather than recomputing them", () => {
    const data = makeReviewData();
    expect(comparedEvidenceRows(data.crossChecks[0])).toEqual([
      { label: "Invoice", raw: "3120 kg", normalized: "3120.000 kg" },
      { label: "Packing list", raw: "3165 kg", normalized: "3165.000 kg" },
    ]);
  });

  it("preserves zero counts and zero differences", () => {
    const check: ReviewWorkspaceCrossCheck = { ruleKey: "packages", status: "PASS", details: { values: [{ documentType: "INVOICE", rawCount: 0, rawType: "cartons", normalizedCount: 0 }] } };
    expect(comparedEvidenceRows(check)).toEqual([{ label: "Invoice", raw: "0 cartons", normalized: "0" }]);
    check.details = { matchedPairs: [{ invoiceLineNumber: 1, packingListLineNumber: 2, invoiceQuantity: "0", packingListQuantity: "0", invoiceUnit: "pcs", packingListUnit: "pcs", difference: 0, canonicalUnit: "pcs" }] };
    expect(comparedEvidenceRows(check)[0].normalized).toBe("Difference 0 pcs");
  });

  it("shows arithmetic values and signed charges from the immutable computation", () => {
    const check: ReviewWorkspaceCrossCheck = { ruleKey: "arithmetic", status: "PASS", details: { compared: { currency: "USD", invoiceTotal: "16320.00", expectedTotal: "16320", charges: [{ kind: "DISCOUNT", source: "HEADER", amount: "20", signedAmount: "-20" }] } } };
    expect(comparedEvidenceRows(check)).toContainEqual({ label: "Invoice Total", raw: "16320.00 USD", normalized: "—" });
    expect(comparedEvidenceRows(check)).toContainEqual({ label: "Discount (Header)", raw: "20 USD", normalized: "-20 USD" });
  });

  it("does not crash on absent or malformed compared-record arrays", () => {
    const check: ReviewWorkspaceCrossCheck = { ruleKey: "unknown", status: "INCOMPLETE", details: { values: [null, false, "text", []] } };
    expect(comparedEvidenceRows(check)).toEqual([]);
  });

  it("links only current fields and lines, while preferring the run's recorded source quote", () => {
    const data = makeReviewData();
    data.documents[0].fields[0].sourceQuote = "Current extraction quote differs";
    const targets = checkSourceTargets(data.crossChecks[0], data.documents);
    expect(targets).toContainEqual({ id: "invoice-weight", documentId: "invoice", docType: "INVOICE", page: 2, fieldId: "invoice-weight", label: "Gross Weight", quote: "Gross weight: 3120 kg" });
    const historical = { ...data.crossChecks[0], details: { sourceFieldIds: ["superseded-field"] } };
    expect(checkSourceTargets(historical, data.documents)).toEqual([]);
  });

  it("collects nested line references once and does not invent a source page", () => {
    const data = makeReviewData();
    const check: ReviewWorkspaceCrossCheck = { ruleKey: "sources", status: "INCOMPLETE", details: { ids: { fields: ["invoice-importer"], lines: ["invoice-line-1", "invoice-line-1"] } } };
    const sources = checkSourceTargets(check, data.documents);
    expect(sources).toHaveLength(2);
    expect(sources.find((source) => source.id === "invoice-importer")?.page).toBeNull();
    expect(sources.find((source) => source.id === "invoice-line-1")?.page).toBe(2);
  });

  it("keeps human audit reasons, evidence, comments and zero-valued corrections visible", () => {
    expect(auditEventDetails({ fieldKey: "grossWeight", previousValue: 0, value: "3120", reason: "Synthetic page 2", evidence: "QA-EVIDENCE-1", comment: "Manager QA decision", revision: 7 })).toEqual(["Gross Weight", "0 → 3120", "Reason: Synthetic page 2", "Evidence: QA-EVIDENCE-1", "Comment: Manager QA decision", "Revision 7"]);
    expect(auditEventDetails(null)).toEqual([]);
  });
});

describe("line-mapping selection freshness", () => {
  function input() {
    const data = makeReviewData();
    return { data, check: data.crossChecks[1], selections: { "invoice-line-1": "packing-line-1" } };
  }

  it("permits a current unmatched one-to-one selection", () => {
    const { data, check, selections } = input();
    expect(mappingSelectionIssue(check, data.documents, [], selections, "invoice-line-1")).toBeNull();
  });

  it("requires a selection and blocks vanished extraction lines", () => {
    const { data, check } = input();
    expect(mappingSelectionIssue(check, data.documents, [], {}, "invoice-line-1")).toMatch(/choose a packing-list line/i);
    expect(mappingSelectionIssue(check, data.documents, [], { "invoice-line-1": "vanished-line" }, "invoice-line-1")).toMatch(/no longer in the current extraction/i);
    data.documents[0].lineItems = [];
    expect(mappingSelectionIssue(check, data.documents, [], { "invoice-line-1": "packing-line-1" }, "invoice-line-1")).toMatch(/no longer in the current extraction/i);
  });

  it("blocks lines that no longer need mapping after a refreshed run", () => {
    const { data, check, selections } = input();
    const unmatched = check.details.unmatchedLines as Array<{ lineId: string }>;
    check.details.unmatchedLines = unmatched.filter((line) => line.lineId !== "invoice-line-1");
    expect(mappingSelectionIssue(check, data.documents, [], selections, "invoice-line-1")).toMatch(/no longer needs manual mapping/i);
  });

  it("blocks already-matched packing lines and active mappings", () => {
    const { data, check, selections } = input();
    const mapping = { id: "mapping-1", invoiceLineId: "invoice-line-2", packingListLineId: "packing-line-1", reason: "Synthetic page 2", createdAt: "2026-11-07T18:00:00Z", createdBy: null };
    expect(mappingSelectionIssue(check, data.documents, [mapping], selections, "invoice-line-1")).toMatch(/already been matched or mapped/i);
    check.details.unmatchedLines = (check.details.unmatchedLines as Array<{ lineId: string }>).filter((line) => line.lineId !== "packing-line-1");
    expect(mappingSelectionIssue(check, data.documents, [], selections, "invoice-line-1")).toMatch(/already been matched or mapped/i);
  });

  it("blocks duplicate draft selections without discarding the user's selections", () => {
    const { data, check, selections } = input();
    const duplicate = { ...selections, "invoice-line-2": "packing-line-1" };
    expect(mappingSelectionIssue(check, data.documents, [], duplicate, "invoice-line-1")).toMatch(/selected for another invoice line/i);
    expect(duplicate["invoice-line-1"]).toBe("packing-line-1");
  });
});
