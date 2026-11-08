import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccuracyReportView, filterReportGroups, measuredPercentage } from "@/features/reports/accuracy-report-view";
import { ChecksInspector, ResolutionEditor } from "@/features/review/checks-inspector";
import { filterAuditEvents, HistoryInspector } from "@/features/review/history-inspector";
import { ManagerDecisionSummary } from "@/features/review/manager-decision-summary";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { calculateAccuracyReport } from "@/lib/reports/accuracy";
import { makeReviewData } from "../fixtures/review-workspace-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const noop = () => undefined;
const report = () => calculateAccuracyReport([
  { id: "qa-1", fieldKey: "grossWeight", supplierName: "Synthetic Supplier", modelValue: "3120", currentValue: "3120", reviewStatus: "CONFIRMED", shipmentId: "qa" },
  { id: "qa-2", fieldKey: "invoiceTotal", supplierName: "Synthetic Supplier", modelValue: "100", currentValue: "120", reviewStatus: "CORRECTED", shipmentId: "qa" },
  { id: "qa-3", fieldKey: "importer", supplierName: "Synthetic Supplier", modelValue: null, currentValue: "Synthetic Importer", reviewStatus: "MANUAL_ENTRY", shipmentId: "qa" },
  { id: "qa-4", fieldKey: "issueDate", supplierName: "Synthetic Supplier", modelValue: "2026-11-07", currentValue: "2026-11-07", reviewStatus: "PENDING", shipmentId: "qa" },
  { id: "qa-5", fieldKey: "incoterm", supplierName: "Synthetic Supplier", modelValue: null, currentValue: null, reviewStatus: "NOT_PRESENT", shipmentId: "qa" },
]);

describe("honest report presentation", () => {
  it("does not show a measured zero percent when no fields were evaluated", () => {
    const empty = calculateAccuracyReport([]);
    expect(measuredPercentage(empty.summary.accuracy)).toBe("Not evaluated");
    const html = renderToStaticMarkup(createElement(AccuracyReportView, { initialReport: empty }));
    expect(html).toContain("Not evaluated");
    expect(html).not.toContain("0.0%");
    expect(html).toContain("No accuracy is claimed");
  });
  it("keeps numerator denominator sample size and exclusions visible", () => {
    const data = report();
    const html = renderToStaticMarkup(createElement(AccuracyReportView, { initialReport: data }));
    expect(data.summary.accuracy).toMatchObject({ numerator: 1, denominator: 2, sampleSize: 1 });
    expect(html).toContain("50.0%");
    expect(html).toContain("1 / 2");
    expect(html).toContain("Sample:");
    expect(html).toContain("Manual entries");
    expect(html).toContain("Unreviewed");
    expect(html).toContain("Absent / not applicable");
    expect(html).toContain("Sample shipments");
    expect(html).toContain("Target not claimed");
    expect(html).not.toContain("directly eliminates");
    expect(html).not.toContain("Week 5");
    expect(html).toContain('aria-label="Report breakdown"');
    expect(html).toContain('aria-label="Scrollable fields report"');
  });
  it("never renders invented metrics without a server report", () => {
    const html = renderToStaticMarkup(createElement(AccuracyReportView));
    expect(html).toContain("No metrics are shown until the server returns them");
    expect(html).not.toContain("50.0%");
    expect(html).not.toContain("Synthetic Demo Dataset");
  });
  it("filters and sorts copies without altering measured values", () => {
    const groups = report().byFieldKey;
    const original = structuredClone(groups);
    expect(filterReportGroups(groups, "invoice", "corrections")[0].groupKey).toBe("invoiceTotal");
    expect(filterReportGroups(groups, "unmatched", "name")).toHaveLength(0);
    expect(filterReportGroups(groups, "", "corrections")[0].corrected).toBe(1);
    expect(groups).toEqual(original);
  });
});

describe("decision and audit surfaces", () => {
  it("keeps long decision evidence in its own scroller with separate title and actions", () => {
    const html = renderToStaticMarkup(createElement(ConfirmDialog, { open: true, onClose: noop, onConfirm: noop, title: "Manager decision", description: "Exact saved revision" }, "Long evidence"));
    expect(html).toContain('data-slot="confirm-dialog-content"');
    expect(html).toMatch(/<header[^>]*shrink-0/);
    expect(html).toMatch(/<footer[^>]*shrink-0/);
    expect(html).toContain("overscroll-contain");
  });
  it("exposes unresolved discrepancies and exact saved revision in the manager scope", () => {
    const html = renderToStaticMarkup(createElement(ManagerDecisionSummary, { data: makeReviewData(), checksStale: true, onInspect: noop }));
    expect(html).toContain("2 unresolved checks");
    expect(html).toContain("Saved revision");
    expect(html).toContain("Approval cannot proceed");
    expect(html).toContain("Inspect audit history");
    expect(html).not.toContain("All checks cleared");
  });
  it("shows exception reasons and references without painting a mismatch as a pass", () => {
    const data = makeReviewData();
    data.crossChecks = [{ ...data.crossChecks[0], activeResolution: { id: "qa-exception", type: "ACCEPTED_EXCEPTION", reason: "Synthetic exception memo only", evidence: "QA-MEMO-1" } }];
    const html = renderToStaticMarkup(createElement(ManagerDecisionSummary, { data, checksStale: false, onInspect: noop }));
    expect(html).toContain("Exceptions in this decision (1)");
    expect(html).toContain("Synthetic exception memo only");
    expect(html).toContain("QA-MEMO-1");
    expect(html).toContain("Original machine result:");
    expect(html).toContain("Mismatch");
    expect(html).toContain("Awaiting manager sign-off");
    expect(html).not.toContain('data-status="PASS"');
  });
  it("blocks exception submission without evidence and explicit inspection confirmation", () => {
    const html = renderToStaticMarkup(createElement(ResolutionEditor, { type: "ACCEPTED_EXCEPTION", draft: { reason: "Synthetic reason", evidence: "", valuesConfirmed: false }, disabled: false, error: null, onChange: noop, onCancel: noop, onSave: noop }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('required=""');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain("traceable reference");
  });
  it("provides check-filter controls and honest unresolved summary", () => {
    const data = makeReviewData();
    const html = renderToStaticMarkup(createElement(ChecksInspector, { checks: data.crossChecks, documents: data.documents, mappings: [], run: data.latestCheckRun, revision: 6, stale: false, disabled: true, canResolve: false, canRecheck: false, mappingSelections: {}, mappingReason: "", resolution: null, resolutionError: null, onRecheck: noop, onHistory: noop, onEvidence: noop, onStartResolution: noop, onResolutionChange: noop, onResolutionClose: noop, onResolve: noop, onMappingSelect: noop, onMappingReason: noop, onMap: noop, onRemoveMapping: noop }));
    expect(html).toContain("2 unresolved");
    expect(html).toContain("Show checks");
    expect(html).toContain('data-status="MISMATCH"');
    expect(html).not.toContain('data-status="PASS"');
    expect(html).toContain("check-run-6");
  });
  it("searches actual audit metadata and actor without mutating history", () => {
    const data = makeReviewData();
    const original = structuredClone(data.auditHistory);
    expect(filterAuditEvents(data.auditHistory, "reviewer@fixture.test")).toHaveLength(1);
    expect(filterAuditEvents(data.auditHistory, "revision")).toHaveLength(1);
    expect(filterAuditEvents(data.auditHistory, "absent")).toHaveLength(0);
    expect(data.auditHistory).toEqual(original);
  });
  it("keeps audit identifiers, UTC timestamps and metadata available", () => {
    const html = renderToStaticMarkup(createElement(HistoryInspector, { data: makeReviewData(), active: false, disabled: false, canResolve: false, resolution: null, resolutionError: null, onRefresh: noop, onEvidence: noop, onStartResolution: noop, onResolutionChange: noop, onResolutionClose: noop, onResolve: noop }));
    expect(html).toContain('aria-label="History sections"');
    expect(html).toContain("Search events, actors or evidence");
    expect(html).toContain("audit-6");
    expect(html).toContain("2026-11-07 17:52:36 UTC");
    expect(html).toContain("Event details");
  });
});
