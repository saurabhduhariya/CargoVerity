import type {
  FieldDraft,
  ManualFieldBase,
  ManualFieldEntry,
  ReviewWorkspaceDocument,
  ReviewWorkspaceField,
  ReviewWorkspaceInitialData,
} from "./review-types";

/** Field status shown immediately while the save is still on its way to the server. */
export type OptimisticFieldStatus = { reviewStatus: string; reviewReason: string | null };

export type ReviewState = {
  incoming: ReviewWorkspaceInitialData;
  snapshot: ReviewWorkspaceInitialData;
  drafts: Record<string, FieldDraft>;
  refreshRequired: boolean;
  /** Fields whose save has not been confirmed by the server yet. Re-applied over every refresh. */
  optimistic: Record<string, OptimisticFieldStatus>;
};

export function createReviewState(data: ReviewWorkspaceInitialData): ReviewState {
  return { incoming: data, snapshot: data, drafts: {}, refreshRequired: false, optimistic: {} };
}

function setFieldStatus(data: ReviewWorkspaceInitialData, fieldId: string, status: OptimisticFieldStatus): ReviewWorkspaceInitialData {
  if (!data.documents.some((doc) => doc.fields.some((field) => field.id === fieldId))) return data;
  return {
    ...data,
    documents: data.documents.map((doc) => doc.fields.some((field) => field.id === fieldId)
      ? { ...doc, fields: doc.fields.map((field) => field.id === fieldId ? { ...field, reviewStatus: status.reviewStatus, reviewReason: status.reviewReason } : field) }
      : doc),
  };
}

function applyOptimistic(data: ReviewWorkspaceInitialData, optimistic: Record<string, OptimisticFieldStatus>): ReviewWorkspaceInitialData {
  return Object.entries(optimistic).reduce((result, [fieldId, status]) => setFieldStatus(result, fieldId, status), data);
}

export function reconcileFieldDrafts(drafts: Record<string, FieldDraft>, documents: ReviewWorkspaceDocument[]): Record<string, FieldDraft> {
  const fields = new Map(documents.flatMap((doc) => doc.fields.map((field) => [field.id, field] as const)));
  return Object.fromEntries(Object.entries(drafts).map(([id, draft]) => {
    const field = fields.get(id);
    const changed = field && (
      field.currentValue !== draft.baseValue || field.reviewStatus !== draft.baseStatus ||
      field.unit !== draft.baseUnit || (field.reviewReason ?? null) !== draft.baseReason ||
      field.pageNumber !== draft.basePage
    );
    return [id, { ...draft, conflict: !field ? "removed" : changed ? "changed" : undefined }];
  }));
}

export function manualFieldBase(doc: ReviewWorkspaceDocument, fieldKey: string): ManualFieldBase {
  const field = doc.fields.find((item) => item.fieldKey === fieldKey);
  return {
    runId: doc.latestRunId ?? null,
    fieldId: field?.id ?? null,
    value: field?.currentValue ?? null,
    unit: field?.unit ?? null,
    status: field?.reviewStatus ?? null,
    reason: field?.reviewReason ?? null,
    page: field?.pageNumber ?? null,
  };
}

export function manualDraftConflict(entry: ManualFieldEntry | undefined, doc: ReviewWorkspaceDocument | undefined): "changed" | "removed" | undefined {
  if (!entry?.base || !entry.draft.fieldKey) return undefined;
  if (!doc) return "removed";
  const current = manualFieldBase(doc, entry.draft.fieldKey);
  return (Object.keys(current) as Array<keyof ManualFieldBase>).some((key) => current[key] !== entry.base?.[key]) ? "changed" : undefined;
}

/** A confirmation is single-use and applies to the revision and check run that were inspected. */
export type ReviewActionBase = { shipmentId?: string; revision: number; runId: string | null };

export function isReviewActionCurrent(
  action: ReviewActionBase,
  snapshot: ReviewWorkspaceInitialData,
): boolean {
  return (!action.shipmentId || action.shipmentId === snapshot.shipment.id) &&
    action.revision === snapshot.shipment.currentRevision && action.runId === (snapshot.latestCheckRun?.id ?? null);
}

type ReviewStateAction =
  | { type: "incoming"; data: ReviewWorkspaceInitialData }
  | { type: "snapshot"; data: ReviewWorkspaceInitialData; savedFieldId?: string }
  /** Applies a change to the CURRENT snapshot, so overlapping saves cannot overwrite each other. */
  | { type: "patch-snapshot"; update: (current: ReviewWorkspaceInitialData) => ReviewWorkspaceInitialData; savedFieldId?: string; savedFieldIds?: string[] }
  | { type: "optimistic-confirm"; fieldId: string }
  | { type: "optimistic-clear"; fieldId: string; restore?: OptimisticFieldStatus }
  | { type: "draft"; doc: ReviewWorkspaceDocument; field: ReviewWorkspaceField; patch: Partial<Pick<FieldDraft, "value" | "reason" | "error">> }
  | { type: "discard"; fieldId: string }
  | { type: "acknowledge"; fieldId: string }
  | { type: "document-url"; documentId: string; url: string }
  | { type: "refresh-required" };

/**
 * Every server refresh signs fresh download links, which would make the viewer re-download and
 * redraw an unchanged PDF after each save. A document id never changes its file, so keep the link
 * the viewer already uses. The viewer fetches a fresh link by itself if this one has expired.
 */
function keepKnownDocumentUrls(incoming: ReviewWorkspaceInitialData, previous: ReviewWorkspaceInitialData): ReviewWorkspaceInitialData {
  const known = new Map(previous.documents.map((doc) => [doc.id, doc.signedUrl]));
  const needsKeeping = (doc: ReviewWorkspaceInitialData["documents"][number]) => {
    const url = known.get(doc.id);
    return Boolean(url) && url !== doc.signedUrl;
  };
  if (!incoming.documents.some(needsKeeping)) return incoming;
  return {
    ...incoming,
    documents: incoming.documents.map((doc) => (needsKeeping(doc) ? { ...doc, signedUrl: known.get(doc.id) as string } : doc)),
  };
}

export function reviewStateReducer(state: ReviewState, action: ReviewStateAction): ReviewState {
  if (action.type === "incoming") {
    if (action.data.shipment.id !== state.snapshot.shipment.id) return createReviewState(action.data);
    if (action.data.shipment.currentRevision < state.snapshot.shipment.currentRevision) return { ...state, incoming: action.data };
    const snapshot = applyOptimistic(keepKnownDocumentUrls(action.data, state.snapshot), state.optimistic);
    return { ...state, incoming: action.data, snapshot, drafts: reconcileFieldDrafts(state.drafts, snapshot.documents), refreshRequired: false };
  }
  if (action.type === "patch-snapshot") {
    const next = action.update(state.snapshot);
    if (next.shipment.id !== state.snapshot.shipment.id || next.shipment.currentRevision < state.snapshot.shipment.currentRevision) return state;
    const drafts = { ...state.drafts };
    const optimistic = { ...state.optimistic };
    for (const id of [...(action.savedFieldId ? [action.savedFieldId] : []), ...(action.savedFieldIds ?? [])]) { delete drafts[id]; delete optimistic[id]; }
    const snapshot = applyOptimistic(next, optimistic);
    return { ...state, snapshot, drafts: reconcileFieldDrafts(drafts, snapshot.documents), optimistic };
  }
  if (action.type === "optimistic-confirm") {
    const status: OptimisticFieldStatus = { reviewStatus: "CONFIRMED", reviewReason: null };
    return { ...state, snapshot: setFieldStatus(state.snapshot, action.fieldId, status), optimistic: { ...state.optimistic, [action.fieldId]: status } };
  }
  if (action.type === "optimistic-clear") {
    const optimistic = { ...state.optimistic };
    delete optimistic[action.fieldId];
    return { ...state, optimistic, snapshot: action.restore ? setFieldStatus(state.snapshot, action.fieldId, action.restore) : state.snapshot };
  }
  if (action.type === "snapshot") {
    if (action.data.shipment.id !== state.snapshot.shipment.id || action.data.shipment.currentRevision < state.snapshot.shipment.currentRevision) return state;
    const drafts = { ...state.drafts };
    if (action.savedFieldId) delete drafts[action.savedFieldId];
    return { ...state, snapshot: action.data, drafts: reconcileFieldDrafts(drafts, action.data.documents) };
  }
  if (action.type === "refresh-required") return { ...state, refreshRequired: true };
  if (action.type === "document-url") {
    return {
      ...state,
      snapshot: { ...state.snapshot, documents: state.snapshot.documents.map((doc) => doc.id === action.documentId ? { ...doc, signedUrl: action.url } : doc) },
    };
  }
  if (action.type === "discard") {
    const drafts = { ...state.drafts };
    delete drafts[action.fieldId];
    return { ...state, drafts };
  }
  if (action.type === "acknowledge") {
    const field = state.snapshot.documents.flatMap((doc) => doc.fields).find((item) => item.id === action.fieldId);
    const draft = state.drafts[action.fieldId];
    if (!field || !draft || state.refreshRequired) return state;
    return {
      ...state,
      drafts: {
        ...state.drafts,
        [field.id]: {
          ...draft,
          baseValue: field.currentValue,
          baseStatus: field.reviewStatus,
          baseUnit: field.unit,
          baseReason: field.reviewReason ?? null,
          basePage: field.pageNumber,
          baseRevision: state.snapshot.shipment.currentRevision,
          conflict: undefined,
          error: undefined,
        },
      },
    };
  }
  const { doc, field, patch } = action;
  const base: FieldDraft = state.drafts[field.id] ?? {
    documentId: doc.id,
    docType: doc.docType,
    fieldKey: field.fieldKey,
    value: field.currentValue ?? "",
    reason: "",
    baseValue: field.currentValue,
    baseStatus: field.reviewStatus,
    baseUnit: field.unit,
    baseReason: field.reviewReason ?? null,
    basePage: field.pageNumber,
    baseRevision: state.snapshot.shipment.currentRevision,
  };
  const draft: FieldDraft = { ...base, error: undefined, ...patch };
  const drafts = { ...state.drafts, [field.id]: draft };
  if (draft.value === (field.currentValue ?? "") && !draft.reason && !draft.conflict && !draft.error) delete drafts[field.id];
  return { ...state, drafts };
}
