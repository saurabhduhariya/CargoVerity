import { describe, expect, it } from "vitest";

import { createReviewState, isReviewActionCurrent, manualDraftConflict, manualFieldBase, reconcileFieldDrafts, reviewStateReducer } from "@/features/review/review-drafts";
import type { FieldDraft, ManualFieldEntry, ReviewWorkspaceField } from "@/features/review/review-types";
import { makeReviewData } from "../fixtures/review-workspace-data";

function withDraft() {
  const data = makeReviewData();
  const doc = data.documents[0];
  const field = doc.fields[0];
  const state = reviewStateReducer(createReviewState(data), { type: "draft", doc, field, patch: { value: "3120.0", reason: "Synthetic source page 2" } });
  return { data, doc, field, state, draft: state.drafts[field.id] };
}

describe("saved snapshots and retained field drafts", () => {
  it("captures the saved baseline without changing the saved value", () => {
    const { field, state, draft } = withDraft();
    expect(state.snapshot.documents[0].fields[0].currentValue).toBe("3120");
    expect(draft).toMatchObject({ value: "3120.0", reason: "Synthetic source page 2", baseValue: "3120", baseStatus: field.reviewStatus, baseUnit: "kg", basePage: 2, baseRevision: 6 });
  });

  it.each([
    { currentValue: "3165" }, { reviewStatus: "CONFIRMED" }, { unit: "KGS" },
    { reviewReason: "Another reviewer verified this" }, { pageNumber: 1 },
  ] satisfies Partial<ReviewWorkspaceField>[])("retains values and reasons when saved metadata changes: %j", (patch) => {
    const { data, field, state } = withDraft();
    const next = structuredClone(data);
    Object.assign(next.documents[0].fields[0], patch);
    next.shipment.currentRevision++;
    const refreshed = reviewStateReducer(state, { type: "incoming", data: next });
    expect(refreshed.snapshot).toBe(next);
    expect(refreshed.drafts[field.id]).toMatchObject({ value: "3120.0", reason: "Synthetic source page 2", conflict: "changed", baseRevision: 6 });
  });

  it("does not flag an unrelated revision or secure URL refresh as a field conflict", () => {
    const { data, field, state } = withDraft();
    const next = structuredClone(data);
    next.shipment.currentRevision++;
    next.documents[0].signedUrl = "https://private.example/fresh";
    expect(reviewStateReducer(state, { type: "incoming", data: next }).drafts[field.id].conflict).toBeUndefined();
  });

  it("retains removed fields as non-saveable orphan drafts", () => {
    const { data, field, state } = withDraft();
    const next = structuredClone(data);
    next.documents[0].fields = next.documents[0].fields.filter((item) => item.id !== field.id);
    const refreshed = reviewStateReducer(state, { type: "incoming", data: next });
    expect(refreshed.drafts[field.id]).toMatchObject({ value: "3120.0", reason: "Synthetic source page 2", conflict: "removed" });
    expect(reviewStateReducer(refreshed, { type: "acknowledge", fieldId: field.id })).toBe(refreshed);
  });

  it("requires acknowledgment against current saved metadata and preserves the user's draft", () => {
    const { data, field, state } = withDraft();
    const next = structuredClone(data);
    next.shipment.currentRevision = 7;
    Object.assign(next.documents[0].fields[0], { currentValue: "3165", reviewStatus: "MANUAL_ENTRY", reviewReason: "Other reviewer", unit: "KGS", pageNumber: 1 });
    const refreshed = reviewStateReducer(state, { type: "incoming", data: next });
    const acknowledged = reviewStateReducer(refreshed, { type: "acknowledge", fieldId: field.id });
    expect(acknowledged.drafts[field.id]).toMatchObject({ value: "3120.0", reason: "Synthetic source page 2", baseValue: "3165", baseStatus: "MANUAL_ENTRY", baseReason: "Other reviewer", baseUnit: "KGS", basePage: 1, baseRevision: 7 });
    expect(acknowledged.drafts[field.id].conflict).toBeUndefined();
    const locked = reviewStateReducer(refreshed, { type: "refresh-required" });
    expect(reviewStateReducer(locked, { type: "acknowledge", fieldId: field.id })).toBe(locked);
  });

  it("ignores stale snapshots and late responses from a different shipment", () => {
    const { data, state } = withDraft();
    const older = structuredClone(data);
    older.shipment.currentRevision = 5;
    expect(reviewStateReducer(state, { type: "snapshot", data: older })).toBe(state);
    expect(reviewStateReducer(state, { type: "incoming", data: older }).snapshot).toBe(state.snapshot);
    const foreign = structuredClone(data);
    foreign.shipment.id = "another-shipment";
    expect(reviewStateReducer(state, { type: "snapshot", data: foreign })).toBe(state);
    expect(reviewStateReducer(state, { type: "incoming", data: foreign }).drafts).toEqual({});
  });

  it("clears only the saved draft and reconciles all other retained drafts", () => {
    const { data, doc, field, state } = withDraft();
    const other = doc.fields[1];
    const both = reviewStateReducer(state, { type: "draft", doc, field: other, patch: { reason: "Still comparing exporter" } });
    const next = structuredClone(data);
    next.shipment.currentRevision++;
    next.documents[0].fields[0].currentValue = "3120.0";
    const saved = reviewStateReducer(both, { type: "snapshot", data: next, savedFieldId: field.id });
    expect(saved.drafts[field.id]).toBeUndefined();
    expect(saved.drafts[other.id].reason).toBe("Still comparing exporter");
  });

  it("does not clear conflicts merely because the draft is edited back to the latest value", () => {
    const { data, field, state } = withDraft();
    const next = structuredClone(data);
    next.documents[0].fields[0].currentValue = "3165";
    const refreshed = reviewStateReducer(state, { type: "incoming", data: next });
    const edited = reviewStateReducer(refreshed, { type: "draft", doc: next.documents[0], field: next.documents[0].fields[0], patch: { value: "3165", reason: "" } });
    expect(edited.drafts[field.id].conflict).toBe("changed");
  });

  it("drops a deliberately discarded draft and preserves drafts on secure URL refresh", () => {
    const { doc, field, state } = withDraft();
    const refreshed = reviewStateReducer(state, { type: "document-url", documentId: doc.id, url: "/private/fresh" });
    expect(refreshed.drafts).toBe(state.drafts);
    expect(refreshed.snapshot.documents[0].signedUrl).toBe("/private/fresh");
    expect(reviewStateReducer(refreshed, { type: "discard", fieldId: field.id }).drafts).toEqual({});
  });

  it("does not mutate the draft map when reconciling", () => {
    const { data, field, draft } = withDraft();
    const drafts: Record<string, FieldDraft> = { [field.id]: draft };
    const reconciled = reconcileFieldDrafts(drafts, []);
    expect(draft.conflict).toBeUndefined();
    expect(reconciled[field.id].conflict).toBe("removed");
    expect(data.documents[0].fields[0].currentValue).toBe("3120");
  });
});

describe("manual entry baselines and protected confirmations", () => {
  function manual() {
    const data = makeReviewData();
    const doc = data.documents[0];
    const entry: ManualFieldEntry = { open: false, draft: { fieldKey: "grossWeight", value: "3120.0", unit: "kg", reason: "Synthetic page 2", page: 2 }, base: manualFieldBase(doc, "grossWeight") };
    return { data, doc, entry };
  }

  it.each([
    { currentValue: "3165" }, { reviewStatus: "CONFIRMED" }, { unit: null },
    { reviewReason: "Saved correction" }, { pageNumber: 1 }, { id: "new-field" },
  ] satisfies Partial<ReviewWorkspaceField>[])("detects a changed manual baseline even while its form is closed: %j", (patch) => {
    const { doc, entry } = manual();
    Object.assign(doc.fields[0], patch);
    expect(manualDraftConflict(entry, doc)).toBe("changed");
    expect(entry.draft.reason).toBe("Synthetic page 2");
  });

  it("detects extraction replacement, removed documents and newly entered missing fields", () => {
    const { doc, entry } = manual();
    doc.latestRunId = "new-extraction";
    expect(manualDraftConflict(entry, doc)).toBe("changed");
    expect(manualDraftConflict(entry, undefined)).toBe("removed");
    const missing: ManualFieldEntry = { ...entry, draft: { ...entry.draft, fieldKey: "newRequiredField" }, base: manualFieldBase(doc, "newRequiredField") };
    doc.fields.push({ ...doc.fields[0], id: "new-field", fieldKey: "newRequiredField" });
    expect(manualDraftConflict(missing, doc)).toBe("changed");
  });

  it("rebases a manual draft only after explicit acknowledgment", () => {
    const { doc, entry } = manual();
    doc.fields[0].reviewReason = "Concurrent review";
    expect(manualDraftConflict(entry, doc)).toBe("changed");
    entry.base = manualFieldBase(doc, entry.draft.fieldKey);
    expect(manualDraftConflict(entry, doc)).toBeUndefined();
    expect(entry.draft.value).toBe("3120.0");
  });

  it("requires the same shipment, revision and check run", () => {
    const data = makeReviewData();
    const action = { shipmentId: data.shipment.id, revision: 6, runId: data.latestCheckRun!.id };
    expect(isReviewActionCurrent(action, data)).toBe(true);
    expect(isReviewActionCurrent({ ...action, revision: 5 }, data)).toBe(false);
    expect(isReviewActionCurrent({ ...action, runId: "earlier-run-at-same-revision" }, data)).toBe(false);
    expect(isReviewActionCurrent({ ...action, shipmentId: "another-shipment" }, data)).toBe(false);
    expect(isReviewActionCurrent({ revision: 6, runId: null }, { ...data, latestCheckRun: null })).toBe(true);
  });
});

describe("document links across server refreshes", () => {
  function refreshed() {
    const data = makeReviewData();
    const next = structuredClone(data);
    next.shipment.currentRevision++;
    // A server refresh signs a new link for every document.
    next.documents.forEach((doc) => { doc.signedUrl = `${doc.signedUrl}?token=new`; });
    return { data, next };
  }

  it("keeps the link the viewer already uses so a confirm does not reload the PDF", () => {
    const { data, next } = refreshed();
    const state = reviewStateReducer(createReviewState(data), { type: "incoming", data: next });
    expect(state.snapshot.documents.map((doc) => doc.signedUrl)).toEqual(data.documents.map((doc) => doc.signedUrl));
    expect(state.snapshot.shipment.currentRevision).toBe(next.shipment.currentRevision);
  });

  it("still takes the new field data from the refresh", () => {
    const { data, next } = refreshed();
    next.documents[0].fields[0].currentValue = "3200";
    const state = reviewStateReducer(createReviewState(data), { type: "incoming", data: next });
    expect(state.snapshot.documents[0].fields[0].currentValue).toBe("3200");
  });

  it("accepts a link for a document that had none", () => {
    const { data, next } = refreshed();
    data.documents[0].signedUrl = "";
    const state = reviewStateReducer(createReviewState(data), { type: "incoming", data: next });
    expect(state.snapshot.documents[0].signedUrl).toBe(next.documents[0].signedUrl);
  });

  it("keeps a link that was refreshed after an expiry", () => {
    const { data, next } = refreshed();
    const withFresh = reviewStateReducer(createReviewState(data), { type: "document-url", documentId: data.documents[0].id, url: "/fixture/invoice.pdf?token=renewed" });
    const state = reviewStateReducer(withFresh, { type: "incoming", data: next });
    expect(state.snapshot.documents[0].signedUrl).toBe("/fixture/invoice.pdf?token=renewed");
  });
});

describe("optimistic confirmation", () => {
  const fieldStatus = (state: ReturnType<typeof createReviewState>, id: string) =>
    state.snapshot.documents.flatMap((doc) => doc.fields).find((f) => f.id === id)?.reviewStatus;

  function pendingField() {
    const data = makeReviewData();
    const field = data.documents[0].fields.find((f) => f.reviewStatus !== "CONFIRMED")!;
    return { data, field };
  }

  it("shows the field as confirmed straight away", () => {
    const { data, field } = pendingField();
    const state = reviewStateReducer(createReviewState(data), { type: "optimistic-confirm", fieldId: field.id });
    expect(fieldStatus(state, field.id)).toBe("CONFIRMED");
    expect(state.snapshot.shipment.currentRevision).toBe(data.shipment.currentRevision);
  });

  it("keeps the field confirmed when a refresh arrives before the server has answered", () => {
    const { data, field } = pendingField();
    const state = reviewStateReducer(createReviewState(data), { type: "optimistic-confirm", fieldId: field.id });
    // The refresh still carries the old status because the save has not been committed yet.
    const refreshed = reviewStateReducer(state, { type: "incoming", data: structuredClone(data) });
    expect(fieldStatus(refreshed, field.id)).toBe("CONFIRMED");
  });

  it("puts the previous status back when the save is refused", () => {
    const { data, field } = pendingField();
    const confirmed = reviewStateReducer(createReviewState(data), { type: "optimistic-confirm", fieldId: field.id });
    const restored = reviewStateReducer(confirmed, { type: "optimistic-clear", fieldId: field.id, restore: { reviewStatus: field.reviewStatus, reviewReason: field.reviewReason ?? null } });
    expect(fieldStatus(restored, field.id)).toBe(field.reviewStatus);
    // A later refresh no longer re-applies the confirmation.
    const refreshed = reviewStateReducer(restored, { type: "incoming", data: structuredClone(data) });
    expect(fieldStatus(refreshed, field.id)).toBe(field.reviewStatus);
  });

  it("applies a committed save to the current snapshot without undoing other pending confirmations", () => {
    const { data } = pendingField();
    const [first, second] = data.documents[0].fields;
    let state = reviewStateReducer(createReviewState(data), { type: "optimistic-confirm", fieldId: first.id });
    state = reviewStateReducer(state, { type: "optimistic-confirm", fieldId: second.id });
    // The first save comes back. The second is still in flight and must stay confirmed.
    state = reviewStateReducer(state, {
      type: "patch-snapshot", savedFieldId: first.id,
      update: (current) => ({
        ...current,
        shipment: { ...current.shipment, currentRevision: current.shipment.currentRevision + 1 },
        documents: current.documents.map((doc) => ({ ...doc, fields: doc.fields.map((f) => f.id === first.id ? { ...f, reviewStatus: "CONFIRMED" } : f) })),
      }),
    });
    expect(state.snapshot.shipment.currentRevision).toBe(data.shipment.currentRevision + 1);
    expect(fieldStatus(state, first.id)).toBe("CONFIRMED");
    expect(fieldStatus(state, second.id)).toBe("CONFIRMED");
    expect(state.optimistic[first.id]).toBeUndefined();
    expect(state.optimistic[second.id]).toBeDefined();
  });

  it("ignores a patch that would move the revision backwards", () => {
    const { data } = pendingField();
    const state = createReviewState(data);
    const next = reviewStateReducer(state, { type: "patch-snapshot", update: (current) => ({ ...current, shipment: { ...current.shipment, currentRevision: current.shipment.currentRevision - 1 } }) });
    expect(next).toBe(state);
  });
});
