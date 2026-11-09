import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CheckEvidence } from "@/features/review/check-evidence";
import { ChecksInspector } from "@/features/review/checks-inspector";
import { FieldEditor, FieldsInspector } from "@/features/review/fields-inspector";
import { LineMappingPanel } from "@/features/review/line-mapping-panel";
import { ReviewWorkspace } from "@/features/review/review-workspace";
import { createReviewState, reviewStateReducer } from "@/features/review/review-drafts";
import { makeReviewData } from "../fixtures/review-workspace-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const noop = () => undefined;
function buttonAttributes(html: string, label: string) {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const match = buttons.find(([, , content]) => content.replace(/<[^>]+>/g, "") === label);
  if (!match) throw new Error(`Rendered button not found: ${label}`);
  return match[1];
}

function fieldProps(): ComponentProps<typeof FieldEditor> {
  const data = makeReviewData();
  return { doc: data.documents[0], field: data.documents[0].fields[0], readOnly: false, disabled: false, focused: false, onDraft: noop, onSave: noop, onDiscard: noop, onAcknowledge: noop, onEvidence: noop };
}

function inspectorProps(): ComponentProps<typeof FieldsInspector> {
  const data = makeReviewData();
  return { doc: data.documents[0], drafts: {}, category: "all", reviewFilter: "all", focusedId: null, disabled: false, readOnly: false, manualOpen: false, manualDraft: { fieldKey: "", value: "", unit: "", reason: "", page: 2 }, manualError: null, onCategory: noop, onReviewFilter: noop, onNext: noop, onManualOpen: noop, onManualDraft: noop, onManualSave: noop, onManualAcknowledge: noop, onDraft: noop, onSave: noop, onConfirmAll: noop, confirmAllDisabled: false, onDiscard: noop, onAcknowledge: noop, onEvidence: noop, shipmentLink: createElement("a", { href: "/shipments/qa-shipment" }, "Open shipment") };
}

describe("rendered review fields and retained drafts", () => {
  it("renders uncertainty, reasons, estimates and source quotes together", () => {
    const html = renderToStaticMarkup(createElement(FieldEditor, fieldProps()));
    expect(html).toContain('data-uncertain="true"');
    expect(html).toContain('aria-label="Gross Weight (needs review)"');
    expect(html).toContain("Review reason:");
    expect(html).toContain("72% (model estimate)");
    expect(html).toContain("Gross weight: 3120 kg");
    expect(html).toContain("Source · page 2");
    expect(buttonAttributes(html, "Confirm")).not.toContain('disabled=""');
  });

  it("prevents confirmation for a reason-only draft, even if the value is unchanged", () => {
    const props = fieldProps();
    const data = makeReviewData();
    const state = reviewStateReducer(createReviewState(data), { type: "draft", doc: props.doc, field: props.field, patch: { reason: "Still comparing source" } });
    const html = renderToStaticMarkup(createElement(FieldEditor, { ...props, draft: state.drafts[props.field.id] }));
    expect(html).toContain("Unsaved draft");
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?Confirm<\/button>/);
    expect(buttonAttributes(html, "Save correction")).toContain('disabled=""');
  });

  it("shows both saved and retained values during a conflict and blocks saving", () => {
    const props = fieldProps();
    const data = makeReviewData();
    const state = reviewStateReducer(createReviewState(data), { type: "draft", doc: props.doc, field: props.field, patch: { value: "3120.0", reason: "Synthetic source page 2" } });
    const html = renderToStaticMarkup(createElement(FieldEditor, { ...props, field: { ...props.field, currentValue: "3165" }, draft: { ...state.drafts[props.field.id], conflict: "changed" } }));
    expect(html).toContain('value="3120.0"');
    expect(html).toContain("Latest saved value:");
    expect(html).toContain("3165");
    expect(html).toContain("Synthetic source page 2");
    expect(html).toContain('role="alert"');
    expect(buttonAttributes(html, "Save correction")).toContain('disabled=""');
    expect(buttonAttributes(html, "Keep my draft")).not.toContain('disabled=""');
  });

  it("keeps evidence available in read-only states without exposing mutation buttons", () => {
    const html = renderToStaticMarkup(createElement(FieldEditor, { ...fieldProps(), readOnly: true }));
    expect(html).toContain('readOnly=""');
    expect(html).toContain("Source · page 2");
    expect(html).not.toContain(">Confirm</button>");
    expect(html).not.toContain("Save correction");
  });

  it("provides a real line-item return target and accessible contained table overflow", () => {
    const html = renderToStaticMarkup(createElement(FieldsInspector, inspectorProps()));
    expect(html).toContain('id="line-items-heading"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Line item table"');
    expect(html).toContain('role="region"');
    expect(html).toContain("8160.00");
  });

  it("retains orphan values and reasons but offers no overwrite action", () => {
    const props = inspectorProps();
    const data = makeReviewData();
    const field = props.doc!.fields[0];
    const state = reviewStateReducer(createReviewState(data), { type: "draft", doc: props.doc!, field, patch: { value: "3120.0", reason: "Synthetic source page 2" } });
    const html = renderToStaticMarkup(createElement(FieldsInspector, { ...props, doc: { ...props.doc!, fields: [] }, drafts: { [field.id]: { ...state.drafts[field.id], conflict: "removed" } } }));
    expect(html).toContain("Drafts from replaced data");
    expect(html).toContain("3120.0");
    expect(html).toContain("Synthetic source page 2");
    expect(html).toContain("Discard retained draft");
    expect(html).not.toContain("Save correction");
  });

  it("keeps manual conflicts explicit and blocks manual submission until acknowledged", () => {
    const props = inspectorProps();
    props.doc!.pages[1].manualEntryRequired = true;
    const html = renderToStaticMarkup(createElement(FieldsInspector, { ...props, manualOpen: true, manualConflict: "changed", manualDraft: { fieldKey: "grossWeight", value: "3120.0", unit: "kg", reason: "Synthetic retained manual value", page: 2 } }));
    expect(html).toContain("The saved field or extraction changed.");
    expect(html).toContain("Synthetic retained manual value");
    expect(buttonAttributes(html, "Save manual field")).toContain('disabled=""');
    expect(buttonAttributes(html, "Keep my manual draft")).not.toContain('disabled=""');
  });
});

describe("rendered check evidence and mappings", () => {
  it("renders exact compared values, a tolerance and source navigation", () => {
    const data = makeReviewData();
    const html = renderToStaticMarkup(createElement(CheckEvidence, { check: data.crossChecks[0], documents: data.documents, onEvidence: noop, returnId: "weight-check" }));
    expect(html).toContain('aria-label="Compared values"');
    expect(html).toContain("3120.000 kg");
    expect(html).toContain("3165.000 kg");
    expect(html).toContain("45.000");
    expect(html).toContain("±15.825");
    expect(html).toContain("Source evidence");
    expect(html).toContain("Full computed evidence");
  });

  it("does not paint an accepted exception as a machine pass", () => {
    const data = makeReviewData();
    const check = { ...data.crossChecks[0], activeResolution: { id: "exception", type: "ACCEPTED_EXCEPTION" as const, reason: "Synthetic QA discrepancy", evidence: "QA-EVIDENCE-1", managerApprovedAt: "2026-11-07T18:00:00Z" } };
    const html = renderToStaticMarkup(createElement(ChecksInspector, {
      checks: [check], documents: data.documents, mappings: [], run: data.latestCheckRun,
      revision: 6, stale: false, disabled: false, canResolve: false, canRecheck: false,
      mappingSelections: {}, mappingReason: "", resolution: null, resolutionError: null,
      onRecheck: noop, onStartResolution: noop, onResolutionChange: noop, onResolutionClose: noop,
      onResolve: noop, onEvidence: noop, onHistory: noop, onMappingSelect: noop, onMappingReason: noop,
      onMap: noop, onRemoveMapping: noop,
    }));
    expect(html).toContain("Exception approved");
    expect(html).toContain('data-status="HUMAN_CLEARED"');
    expect(html).toContain("Original machine result: <strong>Mismatch</strong>");
    expect(html).not.toContain('data-status="PASS"');
  });

  it("retains a disappeared mapping selection visibly without permitting save", () => {
    const data = makeReviewData();
    const html = renderToStaticMarkup(createElement(LineMappingPanel, { check: data.crossChecks[1], documents: data.documents, mappings: [], selections: { "invoice-line-1": "vanished-line" }, reason: "Synthetic QA mapping reason", disabled: false, onSelect: noop, onReasonChange: noop, onMap: noop, onRemove: noop }));
    expect(html).toContain("Previous selection (no longer available)");
    expect(html).toContain("no longer in the current extraction");
    expect(buttonAttributes(html, "Map lines")).toContain('disabled=""');
  });
});

describe("server-rendered workspace shell", () => {
  it("renders both desktop panes and the Fields, Checks and History inspector without a hydration workaround", () => {
    const html = renderToStaticMarkup(createElement(ReviewWorkspace, { initialData: makeReviewData() }));
    expect(html).toMatch(/<div role="group"[^>]*aria-label="Document controls"/);
    expect(html).toMatch(/<div role="region"[^>]*aria-label="Scrollable document page"/);
    expect(html).toContain('data-layout="desktop"');
    expect(html).toContain('data-testid="document-pane"');
    expect(html).toContain('data-testid="review-inspector"');
    expect(html).toContain('aria-label="Review inspector"');
    expect(html).toContain("Fields (3)");
    expect(html).toContain("Checks (2)");
    expect(html).toContain("History");
    expect(html).toContain("Page Marked For Manual Entry");
    expect(html).toContain("2026-11-07 17:52:36 UTC");
    expect(html).not.toContain("suppressHydrationWarning");
  });

  it("keeps processing documents read-only, even when the shipment is otherwise editable", () => {
    const data = makeReviewData();
    data.documents[0].extractionStatus = "PROCESSING";
    const html = renderToStaticMarkup(createElement(ReviewWorkspace, { initialData: data }));
    expect(html).toContain("Extracting this document. Editing is paused.");
    expect(html).not.toContain("Mark page for manual entry");
    expect(html).not.toContain("Add manual field");
  });
});
