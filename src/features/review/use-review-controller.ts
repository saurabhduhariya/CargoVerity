"use client";

import { useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReviewState, reviewStateReducer } from "./review-drafts";
import { formatFieldLabel, isAllowedPreApprovalStatus, validateFieldCorrection } from "./review-presentation";
import type {
  CrossCheckResolutionData, FieldAction, ManualFieldDraft, ResolutionDraft, ReviewFeedback,
  ReviewWorkspaceCrossCheck, ReviewWorkspaceDocument, ReviewWorkspaceField, ReviewWorkspaceInitialData, ReviewWorkspacePage,
} from "./review-types";

type ActionResponse = {
  error?: string;
  code?: string;
  blockingReasons?: string[];
  revision?: number;
  shipmentStatus?: string;
  shipment?: { status: string; currentRevision: number };
  field?: ReviewWorkspaceField & { extractionRunId?: string };
  page?: ReviewWorkspacePage;
  crossChecks?: ReviewWorkspaceCrossCheck[] | null;
  crossChecksStale?: boolean;
  approvalInvalidated?: boolean;
  crossCheckRunId?: string | null;
  runId?: string;
  results?: ReviewWorkspaceCrossCheck[];
  resolution?: CrossCheckResolutionData;
  effectiveStatus?: string;
  latestRun?: { id: string; revision: number; createdAt: string; results: ReviewWorkspaceCrossCheck[] } | null;
  signedOffExceptionIds?: string[];
  approval?: { approvedAt: string } | null;
  mapping?: { id: string; invoiceLineItemId: string; packingListLineItemId: string; reason: string; createdAt: string };
  supersededMappingIds?: string[];
};

export function useReviewController(initialData: ReviewWorkspaceInitialData) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reviewStateReducer, initialData, createReviewState);
  // App Router refreshes preserve client state. Reconcile new server props without resetting drafts.
  if (state.incoming !== initialData) dispatch({ type: "incoming", data: initialData });
  const [isRefreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const [submitBlockers, setSubmitBlockers] = useState<string[]>([]);
  const { snapshot, drafts, refreshRequired } = state;
  const shipmentRevision = snapshot.shipment.currentRevision;
  const isReadOnly = !isAllowedPreApprovalStatus(snapshot.shipment.status);

  function refreshLatest() {
    startRefresh(() => router.refresh());
  }

  function updateSnapshot(data: ActionResponse, patch: Partial<ReviewWorkspaceInitialData> = {}, savedFieldId?: string) {
    const revision = data.revision ?? data.shipment?.currentRevision ?? shipmentRevision;
    const runId = data.crossCheckRunId ?? data.runId;
    const checks = data.latestRun?.results ?? data.crossChecks ?? data.results;
    dispatch({ type: "snapshot", savedFieldId, data: {
      ...snapshot, ...patch,
      shipment: { ...snapshot.shipment, currentRevision: revision, status: data.shipmentStatus ?? data.shipment?.status ?? snapshot.shipment.status },
      ...(checks ? { crossChecks: checks, crossChecksStale: Boolean(data.crossChecksStale) } : {}),
      ...(data.latestRun ? { latestCheckRun: data.latestRun } : runId ? { latestCheckRun: { id: runId, revision, createdAt: null } } : {}),
      ...(data.crossChecksStale ? { crossChecksStale: true } : {}),
    } });
    setSubmitBlockers([]);
  }

  async function mutate(label: string, url: string, body: unknown, onSuccess: (data: ActionResponse) => void, options: { method?: string; field?: ReviewWorkspaceField; doc?: ReviewWorkspaceDocument } = {}): Promise<boolean> {
    if (busyRef.current || isRefreshing) return false;
    if (refreshRequired) {
      setFeedback({ kind: "warning", message: "Refresh the latest shipment before saving. Your drafts are retained." });
      return false;
    }
    busyRef.current = true;
    setBusy(label);
    setFeedback(null);
    try {
      const response = await fetch(url, { method: options.method ?? "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
      const data = await response.json() as ActionResponse;
      if (!response.ok) {
        const stale = response.status === 409 && ["STALE_REVISION", "FIELD_SUPERSEDED", "CHECK_NOT_LATEST", "SHIPMENT_LOCKED", "EXTRACTION_LOCKED", "EXTRACTION_IN_PROGRESS", "NOT_SUBMITTED", "STALE_CHECK_RUN", "MAPPING_CONFLICT"].includes(data.code ?? "");
        if (stale) dispatch({ type: "refresh-required" });
        if (Array.isArray(data.blockingReasons)) setSubmitBlockers(data.blockingReasons);
        const message = data.error ?? `${label} could not be completed.`;
        setFeedback({ kind: stale ? "warning" : "error", message: stale ? `${message} Your drafts are retained; refresh the latest shipment.` : message });
        if (options.doc && options.field) dispatch({ type: "draft", doc: options.doc, field: options.field, patch: { error: message } });
        return false;
      }
      onSuccess(data);
      refreshLatest();
      return true;
    } catch {
      // A lost response may follow a committed write. Never retry at a guessed revision.
      dispatch({ type: "refresh-required" });
      setFeedback({ kind: "error", message: "The response was interrupted. Your drafts are retained. Refresh the latest shipment to check whether the action was saved before retrying." });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function saveField(doc: ReviewWorkspaceDocument, field: ReviewWorkspaceField, action: FieldAction) {
    const draft = drafts[field.id];
    if (isReadOnly || doc.extractionStatus === "PROCESSING" || draft?.conflict) return false;
    if (action === "CONFIRMED" && draft) {
      const error = "Save or discard the draft value and reason before confirming the saved value.";
      dispatch({ type: "draft", doc, field, patch: { error } });
      setFeedback({ kind: "error", message: error });
      return false;
    }
    const value = draft?.value ?? field.currentValue;
    const validation = validateFieldCorrection(action, value, field.currentValue, draft?.reason);
    if (!validation.valid) {
      const error = validation.error ?? "Check the value and correction reason.";
      dispatch({ type: "draft", doc, field, patch: { error } });
      setFeedback({ kind: "error", message: error });
      return false;
    }
    return mutate(`Saving ${formatFieldLabel(field.fieldKey)}`, `/api/fields/${field.id}/review`, {
      status: action, value: action === "CONFIRMED" ? field.currentValue : value,
      reason: action === "CONFIRMED" ? undefined : draft?.reason.trim(), expectedRevision: shipmentRevision,
    }, (data) => {
      const saved = data.field;
      if (!saved) throw new Error("Missing saved field");
      updateSnapshot(data, { documents: snapshot.documents.map((d) => d.id === doc.id ? { ...d, fields: d.fields.map((f) => f.id === field.id ? { ...f, ...saved } : f) } : d) }, field.id);
      setFeedback({ kind: data.crossChecksStale ? "warning" : "success", message: `${formatFieldLabel(field.fieldKey)} ${action === "CONFIRMED" ? "confirmed" : "saved"} at revision ${data.revision}.${data.approvalInvalidated ? " The previous submission was withdrawn; review and resubmit." : ""}${data.crossChecksStale ? " Checks could not be refreshed. Re-run checks before submitting." : ""}` });
    }, { field, doc });
  }

  async function markPage(doc: ReviewWorkspaceDocument, page: number, reviewNote: string) {
    if (isReadOnly || doc.extractionStatus === "PROCESSING") return false;
    return mutate("Marking page for manual entry", `/api/documents/${doc.id}/pages/manual`, { pageNumber: page, manualEntryRequired: true, reviewNote: reviewNote.trim(), expectedRevision: shipmentRevision }, (data) => {
      if (!data.page) throw new Error("Missing saved page");
      const savedPage = data.page;
      updateSnapshot(data, { crossChecksStale: true, crossChecks: [], latestCheckRun: null, documents: snapshot.documents.map((d) => d.id === doc.id ? { ...d, pages: [...d.pages.filter((p) => p.pageNumber !== page), savedPage].sort((a, b) => a.pageNumber - b.pageNumber) } : d) });
      setFeedback({ kind: "success", message: `Page ${page} marked for manual entry. The model's readability evidence is unchanged. Re-run checks after entering the source values.` });
    });
  }

  async function saveManualField(doc: ReviewWorkspaceDocument, form: ManualFieldDraft) {
    if (isReadOnly || doc.extractionStatus === "PROCESSING") return false;
    return mutate("Saving manual field", `/api/documents/${doc.id}/fields/manual`, { fieldKey: form.fieldKey, value: form.value.trim() || null, unit: form.unit.trim() || null, pageNumber: form.page, reason: form.reason.trim(), expectedRevision: shipmentRevision }, (data) => {
      if (!data.field) throw new Error("Missing saved field");
      const field = data.field;
      const runId = data.crossChecks?.[0]?.runId;
      updateSnapshot({ ...data, crossCheckRunId: runId, crossChecksStale: !data.crossChecks }, { documents: snapshot.documents.map((d) => d.id === doc.id ? { ...d, latestRunId: field.extractionRunId ?? d.latestRunId, extractionProvider: d.latestRunId ? d.extractionProvider : "manual", fields: [...d.fields.filter((f) => f.fieldKey !== field.fieldKey), field] } : d) }, field.id);
      setFeedback({ kind: data.crossChecks ? "success" : "warning", message: `${formatFieldLabel(field.fieldKey)} manually entered at revision ${data.revision}.${data.crossChecks ? " Checks were recomputed." : " Re-run checks before submitting."}` });
    });
  }

  async function resolveCheck(check: ReviewWorkspaceCrossCheck, type: CrossCheckResolutionData["type"], form: ResolutionDraft) {
    if (!check.id || !["DRAFT", "IN_REVIEW", "NEEDS_REVIEW"].includes(snapshot.shipment.status)) return false;
    return mutate("Recording check resolution", `/api/crosschecks/${check.id}/resolve`, { type, reason: form.reason.trim(), evidence: form.evidence.trim() || undefined, valuesConfirmed: form.valuesConfirmed, expectedRevision: shipmentRevision }, (data) => {
      if (!data.resolution) throw new Error("Missing resolution");
      const resolution = data.resolution;
      const crossChecks = snapshot.crossChecks.map((c) => c.id === check.id ? { ...c, effectiveStatus: data.effectiveStatus, derivedStatus: data.effectiveStatus, activeResolution: resolution, resolutions: [resolution, ...(c.resolutions ?? [])] } : c);
      updateSnapshot(data, { crossChecks });
      setFeedback({ kind: "success", message: type === "ACCEPTED_EXCEPTION" ? resolution.managerApprovedAt ? "Exception approved by the manager. The original machine result is unchanged." : "Exception recorded and awaiting manager approval. The original machine result is unchanged." : "Historical failure linked to the saved fix. The original check and its evidence are unchanged." });
    });
  }

  async function recheck() {
    if (isReadOnly) return false;
    return mutate("Running checks", `/api/shipments/${snapshot.shipment.id}/crosschecks`, undefined, (data) => {
      if (data.revision !== shipmentRevision) {
        dispatch({ type: "refresh-required" });
        setFeedback({ kind: "warning", message: `Checks ran on revision ${data.revision}. Refresh to review the changed shipment; your drafts are retained.` });
        return;
      }
      updateSnapshot(data, { crossChecksStale: false });
      setFeedback({ kind: "success", message: `Checks evaluated for saved revision ${data.revision}. Previous runs remain in History.` });
    });
  }

  async function mapLines(invoiceLineId: string, packingListLineId: string, reason: string) {
    if (isReadOnly) return false;
    return mutate("Mapping lines", `/api/shipments/${snapshot.shipment.id}/line-mappings`, { invoiceLineId, packingListLineId, reason: reason.trim(), expectedRevision: shipmentRevision }, (data) => {
      if (!data.mapping) throw new Error("Missing mapping");
      const mapping = data.mapping;
      updateSnapshot(data, { lineMappings: [...(snapshot.lineMappings ?? []).filter((m) => !(data.supersededMappingIds ?? []).includes(m.id)), { id: mapping.id, invoiceLineId: mapping.invoiceLineItemId, packingListLineId: mapping.packingListLineItemId, reason: mapping.reason, createdAt: mapping.createdAt, createdBy: null }] });
      setFeedback({ kind: "success", message: "Lines mapped. A new check run was created; the mapping and reason are recorded in History." });
    });
  }

  async function removeMapping(mappingId: string) {
    if (isReadOnly) return false;
    return mutate("Removing mapping", `/api/shipments/${snapshot.shipment.id}/line-mappings/${mappingId}`, { expectedRevision: shipmentRevision }, (data) => {
      updateSnapshot(data, { lineMappings: (snapshot.lineMappings ?? []).filter((m) => m.id !== mappingId) });
      setFeedback({ kind: "success", message: "Mapping removed and checks recomputed. The earlier mapping is retained in audit history." });
    }, { method: "DELETE" });
  }

  async function submit() {
    if (isReadOnly || snapshot.currentUserRole !== "EXECUTIVE" || snapshot.shipment.status === "READY_FOR_APPROVAL") return false;
    setSubmitBlockers([]);
    return mutate("Submitting shipment", `/api/shipments/${snapshot.shipment.id}/submit`, { expectedRevision: shipmentRevision }, (data) => {
      updateSnapshot({ ...data, shipmentStatus: "READY_FOR_APPROVAL" });
      setFeedback({ kind: "success", message: "Saved shipment submitted for manager approval. Any accepted exceptions still require manager sign-off." });
    });
  }

  async function decide(decision: "APPROVE" | "REJECT", comment: string) {
    if (snapshot.currentUserRole !== "MANAGER" || snapshot.shipment.status !== "READY_FOR_APPROVAL") return false;
    return mutate(decision === "APPROVE" ? "Approving shipment" : "Returning shipment to review", `/api/shipments/${snapshot.shipment.id}/decision`, { decision, comment: comment.trim(), expectedRevision: shipmentRevision }, (data) => {
      const signedOff = new Set(data.signedOffExceptionIds ?? []);
      const approvedAt = data.approval?.approvedAt;
      updateSnapshot(data, { crossChecks: snapshot.crossChecks.map((c) => c.activeResolution && signedOff.has(c.activeResolution.id) ? { ...c, derivedStatus: "HUMAN_CLEARED", effectiveStatus: "HUMAN_CLEARED", activeResolution: { ...c.activeResolution, ...(approvedAt ? { managerApprovedAt: approvedAt } : {}) }, resolutions: c.resolutions?.map((resolution) => signedOff.has(resolution.id) && approvedAt ? { ...resolution, managerApprovedAt: approvedAt } : resolution) } : c) });
      setFeedback({ kind: "success", message: decision === "APPROVE" ? `Revision ${shipmentRevision} approved. Export remains subject to the server's preflight guards.` : "Shipment returned to Needs review. The manager's comment is recorded in History." });
    });
  }

  return { snapshot, drafts, feedback, setFeedback, submitBlockers, setSubmitBlockers, busy, isRefreshing, refreshRequired, isReadOnly, dispatch, refreshLatest, saveField, markPage, saveManualField, resolveCheck, recheck, mapLines, removeMapping, submit, decide };
}
