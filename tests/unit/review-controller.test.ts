import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as drafts from "@/features/review/review-drafts";
import { useReviewController } from "@/features/review/use-review-controller";
import type { ReviewWorkspaceInitialData } from "@/features/review/review-types";
import { makeReviewData } from "../fixtures/review-workspace-data";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  // SSR does not support startTransition; these are request-contract tests, not render tests.
  return { ...react, useTransition: () => [false, (action: () => void) => action()] as const };
});

const fetchMock = vi.fn<typeof fetch>();
const createState = drafts.createReviewState;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** React's state hooks capture callbacks; browser QA covers real transitions and re-renders. */
function controller(data: ReviewWorkspaceInitialData, statePatch: Partial<drafts.ReviewState> = {}) {
  vi.spyOn(drafts, "createReviewState").mockImplementation((input) => ({ ...createState(input), ...statePatch }));
  let captured!: ReturnType<typeof useReviewController>;
  function Capture() { captured = useReviewController(data); return null; }
  renderToStaticMarkup(createElement(Capture));
  return captured;
}

describe("guarded review controller request contracts", () => {
  it("confirms only the saved value at the current revision", async () => {
    const data = makeReviewData();
    const field = data.documents[0].fields[0];
    fetchMock.mockResolvedValueOnce(Response.json({ field: { ...field, reviewStatus: "CONFIRMED" }, revision: 7, crossChecks: [], crossCheckRunId: "server-run-7" }));
    expect(await controller(data).saveField(data.documents[0], field, "CONFIRMED")).toBe(true);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/fields/invoice-weight/review");
    expect(request?.method).toBe("POST");
    expect(request?.cache).toBe("no-store");
    expect(JSON.parse(request!.body as string)).toEqual({ status: "CONFIRMED", value: "3120", expectedRevision: 6 });
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("never sends a confirmation for a retained reason-only draft", async () => {
    const data = makeReviewData();
    const doc = data.documents[0];
    const field = doc.fields[0];
    const state = drafts.reviewStateReducer(drafts.createReviewState(data), { type: "draft", doc, field, patch: { reason: "Still comparing source" } });
    expect(await controller(data, { drafts: state.drafts }).saveField(doc, field, "CONFIRMED")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the retained correction and its trimmed rationale with expectedRevision", async () => {
    const data = makeReviewData();
    const doc = data.documents[0];
    const field = doc.fields[0];
    const state = drafts.reviewStateReducer(drafts.createReviewState(data), { type: "draft", doc, field, patch: { value: "3120.0", reason: "  Synthetic source page 2  " } });
    fetchMock.mockResolvedValueOnce(Response.json({ field: { ...field, currentValue: "3120.0" }, revision: 7, crossChecksStale: true }));
    expect(await controller(data, { drafts: state.drafts }).saveField(doc, field, "CORRECTED")).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ status: "CORRECTED", value: "3120.0", reason: "Synthetic source page 2", expectedRevision: 6 });
  });

  it.each(["APPROVED", "EXPORTED", "EXTRACTING", "FUTURE_STATUS"])("does not send field or manual mutations for locked status %s", async (status) => {
    const data = makeReviewData();
    data.shipment.status = status;
    const review = controller(data);
    expect(await review.saveField(data.documents[0], data.documents[0].fields[0], "CONFIRMED")).toBe(false);
    expect(await review.markPage(data.documents[0], 2, "Synthetic QA")).toBe(false);
    expect(await review.saveManualField(data.documents[0], { fieldKey: "grossWeight", value: "3120", unit: "kg", reason: "Synthetic QA", page: 2 })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a processing document before fetching", async () => {
    const data = makeReviewData();
    const doc = data.documents[0];
    doc.extractionStatus = "PROCESSING";
    expect(await controller(data).saveField(doc, doc.fields[0], "CONFIRMED")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a conflicted field draft before fetching", async () => {
    const data = makeReviewData();
    const doc = data.documents[0];
    const field = doc.fields[0];
    const state = drafts.reviewStateReducer(createState(data), { type: "draft", doc, field, patch: { value: "3120.0", reason: "Synthetic QA" } });
    const conflictedDrafts = { [field.id]: { ...state.drafts[field.id], conflict: "changed" as const } };
    expect(await controller(data, { drafts: conflictedDrafts }).saveField(doc, field, "CORRECTED")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the guarded manual-entry endpoint body", async () => {
    const data = makeReviewData();
    const doc = data.documents[0];
    fetchMock.mockResolvedValueOnce(Response.json({ field: { ...doc.fields[0], extractionRunId: "server-extraction" }, revision: 7, crossChecks: [] }));
    expect(await controller(data).saveManualField(doc, { fieldKey: "grossWeight", value: " 3120 ", unit: " kg ", reason: " Synthetic QA ", page: 2 })).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/invoice/fields/manual");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ fieldKey: "grossWeight", value: "3120", unit: "kg", pageNumber: 2, reason: "Synthetic QA", expectedRevision: 6 });
  });

  it("uses the guarded page-marking endpoint body", async () => {
    const data = makeReviewData();
    const doc = data.documents[0];
    fetchMock.mockResolvedValueOnce(Response.json({ page: { ...doc.pages[1], manualEntryRequired: true }, revision: 7 }));
    expect(await controller(data).markPage(doc, 2, " Synthetic QA ")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/invoice/pages/manual");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ pageNumber: 2, manualEntryRequired: true, reviewNote: "Synthetic QA", expectedRevision: 6 });
  });

  it("uses the guarded mapping endpoint body", async () => {
    const data = makeReviewData();
    fetchMock.mockResolvedValueOnce(Response.json({ mapping: { id: "server-mapping", invoiceLineItemId: "invoice-line-1", packingListLineItemId: "packing-line-1", reason: "Synthetic QA", createdAt: "2026-11-07T18:00:00Z" }, revision: 7 }));
    expect(await controller(data).mapLines("invoice-line-1", "packing-line-1", " Synthetic QA ")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/shipments/qa-shipment/line-mappings");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ invoiceLineId: "invoice-line-1", packingListLineId: "packing-line-1", reason: "Synthetic QA", expectedRevision: 6 });
  });

  it("uses the guarded mapping-removal endpoint body", async () => {
    const data = makeReviewData();
    fetchMock.mockResolvedValueOnce(Response.json({ revision: 7 }));
    expect(await controller(data).removeMapping("server-mapping")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/shipments/qa-shipment/line-mappings/server-mapping");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ expectedRevision: 6 });
  });

  it("uses the guarded submission endpoint body", async () => {
    const data = makeReviewData();
    fetchMock.mockResolvedValueOnce(Response.json({ revision: 6 }));
    expect(await controller(data).submit()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/shipments/qa-shipment/submit");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ expectedRevision: 6 });
  });

  it("records resolutions with source confirmation, evidence and the saved revision", async () => {
    const data = makeReviewData();
    fetchMock.mockResolvedValueOnce(Response.json({ resolution: { id: "server-resolution", type: "ACCEPTED_EXCEPTION", reason: "Synthetic QA", evidence: "QA-EVIDENCE-1" }, revision: 6 }));
    expect(await controller(data).resolveCheck(data.crossChecks[0], "ACCEPTED_EXCEPTION", { reason: " Synthetic QA ", evidence: " QA-EVIDENCE-1 ", valuesConfirmed: true })).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/crosschecks/weight-check/resolve");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ type: "ACCEPTED_EXCEPTION", reason: "Synthetic QA", evidence: "QA-EVIDENCE-1", valuesConfirmed: true, expectedRevision: 6 });
  });

  it("requires manager role and the submitted status before deciding", async () => {
    const data = makeReviewData();
    expect(await controller(data).decide("APPROVE", "Synthetic QA")).toBe(false);
    vi.restoreAllMocks();
    data.currentUserRole = "MANAGER";
    data.shipment.status = "READY_FOR_APPROVAL";
    fetchMock.mockResolvedValueOnce(Response.json({ shipment: { status: "APPROVED", currentRevision: 6 }, signedOffExceptionIds: [], approval: { approvedAt: "2026-11-07T18:05:00Z" } }));
    expect(await controller(data).decide("APPROVE", " Synthetic QA ")).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ decision: "APPROVE", comment: "Synthetic QA", expectedRevision: 6 });
  });

  it("blocks all mutations while an authoritative refresh is required", async () => {
    const data = makeReviewData();
    expect(await controller(data, { refreshRequired: true }).recheck()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["STALE_REVISION", "CHECK_NOT_LATEST", "FIELD_SUPERSEDED", "MAPPING_CONFLICT"])("treats conflict %s as a failure without guessing a retry revision", async (code) => {
    const data = makeReviewData();
    fetchMock.mockResolvedValueOnce(Response.json({ code, error: "The shipment changed" }, { status: 409 }));
    expect(await controller(data).recheck()).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("does not refresh optimistically after a lost mutation response", async () => {
    const data = makeReviewData();
    fetchMock.mockRejectedValueOnce(new Error("Network interrupted"));
    const review = controller(data);
    expect(await review.recheck()).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("does not refresh or report success after a malformed saved-field response", async () => {
    const data = makeReviewData();
    fetchMock.mockResolvedValueOnce(Response.json({ revision: 7 }));
    expect(await controller(data).saveField(data.documents[0], data.documents[0].fields[0], "CONFIRMED")).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("uses an immediate in-flight lock to prevent duplicate requests", async () => {
    const data = makeReviewData();
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    const review = controller(data);
    const first = review.recheck();
    expect(await review.recheck()).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    respond(Response.json({ revision: 6, runId: "server-run", results: data.crossChecks }));
    expect(await first).toBe(true);
  });
});
