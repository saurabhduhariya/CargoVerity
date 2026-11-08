"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FileDown, FileText, Lock, RefreshCw, RotateCw, Send, ShieldCheck, X, ZoomIn, ZoomOut } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChecksInspector, type ActiveResolutionEditor } from "./checks-inspector";
import { DocumentViewer } from "./document-viewer";
import { ExportPreviewDialog } from "./export-preview-dialog";
import { FieldsInspector } from "./fields-inspector";
import { HistoryInspector } from "./history-inspector";
import { ManagerDecisionSummary } from "./manager-decision-summary";
import { mappingSelectionIssue } from "./line-mapping-panel";
import { nextUncertainFieldId } from "./next-uncertain";
import { isReviewActionCurrent, manualDraftConflict, manualFieldBase, type ReviewActionBase } from "./review-drafts";
import { blockingAcceptedExceptions, calculateNextRotation, calculateNextZoom, canEnterManualField, checkLabel, DOCUMENT_LABELS, DOCUMENT_TYPES, formatFieldLabel, isFieldUncertain, validateManagerDecision } from "./review-presentation";
import { useReviewController } from "./use-review-controller";
import type { CrossCheckResolutionData, EvidenceTarget, FieldCategory, InspectorTab, ManualFieldDraft, ManualFieldEntry, ResolutionDraft, ReviewWorkspaceCrossCheck, ReviewWorkspaceDocument, ReviewWorkspaceInitialData } from "./review-types";

// Preserve the feature's public imports while keeping state and presentation independently testable.
export type * from "./review-types";
export { calculateNextRotation, calculateNextZoom, categorizeFieldKey, deriveEffectiveCheckStatus, formatFieldLabel, isAllowedPreApprovalStatus, isFieldUncertain, validateFieldCorrection } from "./review-presentation";

const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function getDesktopSnapshot() { return window.matchMedia(DESKTOP_QUERY).matches; }
function getDesktopServerSnapshot() { return true; }
function focusReviewElement(id: string, fallbackId?: string) {
  requestAnimationFrame(() => {
    const element = document.getElementById(id) ?? (fallbackId ? document.getElementById(fallbackId) : null);
    for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    element?.scrollIntoView({ block: "nearest" });
    element?.focus({ preventScroll: true });
  });
}
function blankManualDraft(page: number): ManualFieldDraft { return { fieldKey: "", value: "", unit: "", reason: "", page }; }
function manualIsDirty(draft: ManualFieldDraft) { return Boolean(draft.fieldKey || draft.value || draft.unit || draft.reason); }
function resolutionIsDirty(draft: ResolutionDraft) { return Boolean(draft.reason || draft.evidence || draft.valuesConfirmed); }

type EvidenceReturn = { tab: InspectorTab; docType: ReviewWorkspaceDocument["docType"]; page: number; rotation: number; elementId: string; label: string };
type PendingAction = ReviewActionBase & { title: string; description: string; confirmLabel: string; execute: () => Promise<boolean> };
type ManualPageTarget = ReviewActionBase & { documentId: string; page: number };

export function ReviewWorkspace({ initialData }: { initialData: ReviewWorkspaceInitialData }) {
  const router = useRouter();
  const controller = useReviewController(initialData);
  const { snapshot, drafts, feedback, setFeedback, busy, isRefreshing, refreshRequired, isReadOnly, dispatch } = controller;
  const { shipment, documents, crossChecks } = snapshot;
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getDesktopServerSnapshot);
  const initialDocType = documents.find((doc) => doc.id === initialData.initialDocumentId)?.docType ?? DOCUMENT_TYPES.find((type) => documents.some((doc) => doc.docType === type)) ?? "INVOICE";
  const [activeDocType, setActiveDocType] = useState<ReviewWorkspaceDocument["docType"]>(initialDocType);
  const [entryDocumentId, setEntryDocumentId] = useState(initialData.initialDocumentId);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("fields");
  const [mobilePane, setMobilePane] = useState("review");
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [pdfPageCounts, setPdfPageCounts] = useState<Record<string, number>>({});
  const [focusedUncertainId, setFocusedUncertainId] = useState<string | null>(null);
  const [category, setCategory] = useState<FieldCategory | "all">("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "uncertain" | "pending">("all");
  const [evidenceReturn, setEvidenceReturn] = useState<EvidenceReturn | null>(null);
  const activeDoc = documents.find((doc) => doc.docType === activeDocType);
  const [viewerDocumentId, setViewerDocumentId] = useState(activeDoc?.id);

  // A document-ID entry selects that document. Ordinary refreshes do not reset the selection.
  if (entryDocumentId !== initialData.initialDocumentId) {
    setEntryDocumentId(initialData.initialDocumentId);
    if (initialData.initialDocumentId) setActiveDocType(initialDocType);
  }
  if (viewerDocumentId !== activeDoc?.id) {
    setViewerDocumentId(activeDoc?.id);
    setCurrentPage(1);
    setRotation(0);
    setFocusedUncertainId(null);
  }
  const maxPages = Math.max(1, activeDoc ? pdfPageCounts[activeDoc.id] ?? activeDoc.pageCount ?? 1 : 1);
  const page = Math.min(currentPage, maxPages);
  const activePage = activeDoc?.pages.find((item) => item.pageNumber === page);
  const isManager = snapshot.currentUserRole === "MANAGER";
  const disabled = Boolean(busy || isRefreshing || refreshRequired);
  const documentReadOnly = isReadOnly || activeDoc?.extractionStatus === "PROCESSING";

  const [manualEntries, setManualEntries] = useState<Record<string, ManualFieldEntry>>({});
  const [manualError, setManualError] = useState<string | null>(null);
  const manualEntry = activeDoc ? manualEntries[activeDoc.id] : undefined;
  const manualDraft = manualEntry?.draft ?? blankManualDraft(page);
  const manualConflict = manualDraftConflict(manualEntry, activeDoc);
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({});
  const [mappingReason, setMappingReason] = useState("");
  const [resolutionEntries, setResolutionEntries] = useState<Record<string, { check: ReviewWorkspaceCrossCheck; type: CrossCheckResolutionData["type"]; draft: ResolutionDraft }>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const resolving = resolvingId ? resolutionEntries[resolvingId] : undefined;
  const resolution: ActiveResolutionEditor | null = resolving && resolvingId ? { checkId: resolvingId, type: resolving.type, draft: resolving.draft } : null;
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const [manualPageTarget, setManualPageTarget] = useState<ManualPageTarget | null>(null);
  const [pageNote, setPageNote] = useState("");
  const [managerTarget, setManagerTarget] = useState<ReviewActionBase | null>(null);
  const [managerDecision, setManagerDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [managerComment, setManagerComment] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const dirtyManualEntries = Object.entries(manualEntries).filter(([, entry]) => manualIsDirty(entry.draft));
  const dirtyResolutions = Object.entries(resolutionEntries).filter(([, entry]) => resolutionIsDirty(entry.draft));
  const hasMappingDraft = Boolean(mappingReason || Object.values(mappingSelections).some(Boolean));
  const fieldDraftCount = Object.keys(drafts).length;
  const draftCount = fieldDraftCount + dirtyManualEntries.length + dirtyResolutions.length + Number(hasMappingDraft);
  const hasFieldDrafts = fieldDraftCount > 0 || dirtyManualEntries.length > 0;
  const hasDrafts = draftCount > 0;
  const checksStale = Boolean(snapshot.crossChecksStale || !snapshot.latestCheckRun || snapshot.latestCheckRun.revision !== shipment.currentRevision);
  const canResolve = ["DRAFT", "IN_REVIEW", "NEEDS_REVIEW"].includes(shipment.status) && !hasFieldDrafts && !checksStale;
  const acceptedExceptions = blockingAcceptedExceptions(crossChecks);
  const managerCommentRequired = managerDecision === "REJECT" || acceptedExceptions.length > 0;
  const uncertainTotal = documents.reduce((count, doc) => count + doc.fields.filter(isFieldUncertain).length, 0);

  useEffect(() => {
    if (!hasDrafts && !managerComment) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasDrafts, managerComment]);

  const goToNextUncertainField = useCallback(() => {
    const fields = activeDoc?.fields.filter(isFieldUncertain) ?? [];
    const id = nextUncertainFieldId(fields.map((field) => field.id), focusedUncertainId);
    const field = fields.find((item) => item.id === id);
    if (!field) {
      setFeedback({ kind: "info", message: "No uncertain fields require review on this document. Pending values may still need confirmation." });
      return;
    }
    setFocusedUncertainId(field.id);
    setCategory("all");
    setReviewFilter("all");
    setInspectorTab("fields");
    setMobilePane("review");
    if (field.pageNumber) setCurrentPage(field.pageNumber);
    focusReviewElement(`field-card-${field.id}`);
    setFeedback({ kind: "info", message: `Uncertain field ${fields.indexOf(field) + 1} of ${fields.length}: ${formatFieldLabel(field.fieldKey)}.` });
  }, [activeDoc, focusedUncertainId, setFeedback]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector("dialog[open]") || target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      if (key === "n") { event.preventDefault(); goToNextUncertainField(); }
      else if (activeDoc && ["[", "]", "PageUp", "PageDown", "+", "=", "-", "_", "0", "r"].includes(event.key === "R" ? "r" : event.key)) {
        event.preventDefault();
        if (event.key === "[" || event.key === "PageUp") setCurrentPage((value) => Math.max(1, value - 1));
        else if (event.key === "]" || event.key === "PageDown") setCurrentPage((value) => Math.min(maxPages, value + 1));
        else if (key === "+" || key === "=") setZoomLevel((value) => calculateNextZoom(value, "in"));
        else if (key === "-" || key === "_") setZoomLevel((value) => calculateNextZoom(value, "out"));
        else if (key === "0") { setZoomLevel(100); setRotation(0); }
        else if (key === "r") setRotation((value) => calculateNextRotation(value));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDoc, goToNextUncertainField, maxPages]);

  const reportPageCount = useCallback((documentId: string, count: number) => setPdfPageCounts((previous) => previous[documentId] === count ? previous : { ...previous, [documentId]: count }), []);

  function actionBase(): ReviewActionBase {
    return { shipmentId: shipment.id, revision: shipment.currentRevision, runId: snapshot.latestCheckRun?.id ?? null };
  }

  async function requestFreshDocumentUrl(documentId: string) {
    const response = await fetch(`/api/documents/${documentId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { signedUrl?: string };
    if (!body.signedUrl) return null;
    dispatch({ type: "document-url", documentId, url: body.signedUrl });
    return body.signedUrl;
  }

  async function openOriginal(doc: ReviewWorkspaceDocument) {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await requestFreshDocumentUrl(doc.id);
      if (!url) throw new Error("Secure evidence is unavailable");
      if (tab) tab.location.href = url;
      else setFeedback({ kind: "warning", message: "The browser blocked the new tab. Allow pop-ups, then open the original document again." });
    } catch {
      tab?.close();
      setFeedback({ kind: "error", message: "The private document could not be opened. Retry the secure document or check storage availability." });
    }
  }

  function inspectEvidence(target: EvidenceTarget, elementId: string) {
    const doc = documents.find((item) => item.id === target.documentId);
    if (!doc) {
      setFeedback({ kind: "warning", message: "This evidence belongs to a document that is no longer current. Inspect its preserved check snapshot in History." });
      return;
    }
    setEvidenceReturn({ tab: inspectorTab, docType: activeDocType, page, rotation, elementId, label: target.label });
    setActiveDocType(doc.docType);
    setViewerDocumentId(doc.id);
    setCurrentPage(Math.max(1, Math.min(target.page, pdfPageCounts[doc.id] ?? doc.pageCount ?? target.page)));
    if (doc.id !== activeDoc?.id) setRotation(0);
    setMobilePane("document");
    focusReviewElement("document-pane-heading");
  }

  function returnFromEvidence() {
    if (!evidenceReturn) return;
    setActiveDocType(evidenceReturn.docType);
    setViewerDocumentId(documents.find((doc) => doc.docType === evidenceReturn.docType)?.id);
    setCurrentPage(evidenceReturn.page);
    setRotation(evidenceReturn.rotation);
    setInspectorTab(evidenceReturn.tab);
    setMobilePane("review");
    if (evidenceReturn.tab === "fields") { setCategory("all"); setReviewFilter("all"); }
    focusReviewElement(evidenceReturn.elementId, `review-${evidenceReturn.tab}-heading`);
    setEvidenceReturn(null);
  }

  function requestRunChange(execute: () => Promise<boolean>, title = "Start a new check run?") {
    if (disabled || isReadOnly) return;
    if (crossChecks.some((check) => check.resolutions?.length || check.activeResolution) || dirtyResolutions.length > 0) {
      const action: PendingAction = {
        ...actionBase(), title,
        description: "This action recomputes checks from saved values. Existing exceptions and sign-offs will not carry into the new run. Earlier results and resolutions remain in History; unsaved resolution drafts remain available for comparison.",
        confirmLabel: "Continue with new run", execute,
      };
      pendingActionRef.current = action;
      setPendingAction(action);
    } else void execute();
  }

  function closePendingAction() { pendingActionRef.current = null; setPendingAction(null); }
  function confirmPendingAction() {
    if (busy || isRefreshing) return;
    const action = pendingActionRef.current;
    if (!action) return;
    // Consume before awaiting. A failed mutation must not leave an old captured closure retryable.
    closePendingAction();
    if (refreshRequired || isReadOnly || !isReviewActionCurrent(action, snapshot)) {
      setFeedback({ kind: "warning", message: "The shipment or its current check run changed. Refresh and reopen the action after reviewing the latest data. Your drafts are retained." });
      return;
    }
    void action.execute();
  }

  function startResolution(check: ReviewWorkspaceCrossCheck, type: CrossCheckResolutionData["type"]) {
    if (!check.id || disabled || !canResolve) return;
    setFeedback(null);
    setResolutionEntries((entries) => ({ ...entries, [check.id!]: { check, type, draft: entries[check.id!]?.draft ?? { reason: "", evidence: "", valuesConfirmed: false } } }));
    setResolvingId(check.id);
  }
  function changeResolution(draft: ResolutionDraft) {
    if (!resolvingId || !resolving) return;
    setFeedback(null);
    setResolutionEntries((entries) => ({ ...entries, [resolvingId]: { ...resolving, draft } }));
  }
  async function saveResolution(check: ReviewWorkspaceCrossCheck) {
    if (!resolvingId || !resolving || !canResolve || disabled) return false;
    if (resolving.type === "ACCEPTED_EXCEPTION" && !crossChecks.some((current) => current.id === check.id)) {
      setFeedback({ kind: "warning", message: "This exception draft belongs to an older run. Review the latest compared values and start an exception on the current check." });
      return false;
    }
    const saved = await controller.resolveCheck(check, resolving.type, resolving.draft);
    if (saved) {
      setResolutionEntries((entries) => { const next = { ...entries }; delete next[resolvingId]; return next; });
      setResolvingId(null);
    }
    return saved;
  }

  function setManualDraft(draft: ManualFieldDraft) {
    if (!activeDoc) return;
    setManualError(null);
    setManualEntries((entries) => {
      const previous = entries[activeDoc.id];
      const base = !draft.fieldKey ? null : previous?.draft.fieldKey === draft.fieldKey && previous.base
        ? previous.base : manualFieldBase(activeDoc, draft.fieldKey);
      return { ...entries, [activeDoc.id]: { open: previous?.open ?? true, draft, base } };
    });
  }
  function setManualOpen(open: boolean) {
    if (!activeDoc) return;
    setManualError(null);
    setManualEntries((entries) => {
      const entry = entries[activeDoc.id];
      return { ...entries, [activeDoc.id]: { open, draft: entry && manualIsDirty(entry.draft) ? entry.draft : blankManualDraft(page), base: entry?.base ?? null } };
    });
  }
  function acknowledgeManualDraft() {
    if (!activeDoc || !manualEntry || disabled || documentReadOnly) return;
    setManualError(null);
    setManualEntries((entries) => ({ ...entries, [activeDoc.id]: { ...manualEntry, base: manualFieldBase(activeDoc, manualDraft.fieldKey) } }));
  }
  function saveManualDraft() {
    if (!activeDoc || disabled || documentReadOnly || manualConflict || !manualDraft.fieldKey ||
      manualDraft.reason.trim().length < 3 || !canEnterManualField(activeDoc, manualDraft.fieldKey, manualDraft.page)) return;
    const doc = activeDoc;
    const form = manualDraft;
    requestRunChange(async () => {
      const saved = await controller.saveManualField(doc, form);
      if (saved) setManualEntries((entries) => ({ ...entries, [doc.id]: { open: false, draft: blankManualDraft(form.page), base: null } }));
      else setManualError("The manual value was not saved. Check the response above; your draft is retained.");
      return saved;
    });
  }
  function resumeManualDraft(documentId: string) {
    const doc = documents.find((item) => item.id === documentId);
    const entry = manualEntries[documentId];
    if (!doc || !entry) return;
    setActiveDocType(doc.docType);
    setViewerDocumentId(doc.id);
    setCurrentPage(entry.draft.page);
    setRotation(0);
    setInspectorTab("fields");
    setMobilePane("review");
    setManualEntries((entries) => ({ ...entries, [documentId]: { ...entry, open: true } }));
    focusReviewElement("manual-field-key");
  }

  function saveMapping(invoiceId: string) {
    if (disabled || isReadOnly || hasFieldDrafts || checksStale) return;
    const check = crossChecks.find((item) => item.ruleKey === "invoice_quantity_vs_packing_list");
    const issue = mappingSelectionIssue(check, documents, snapshot.lineMappings ?? [], mappingSelections, invoiceId);
    if (issue) { setFeedback({ kind: "warning", message: issue }); return; }
    const packingId = mappingSelections[invoiceId];
    const reason = mappingReason;
    requestRunChange(async () => {
      const saved = await controller.mapLines(invoiceId, packingId, reason);
      if (saved) {
        const next = { ...mappingSelections };
        delete next[invoiceId];
        setMappingSelections(next);
        if (!Object.values(next).some(Boolean)) setMappingReason("");
      }
      return saved;
    });
  }

  function markManualPage() {
    if (!manualPageTarget || busy || isRefreshing) return;
    const doc = documents.find((item) => item.id === manualPageTarget.documentId);
    if (refreshRequired || isReadOnly || !doc || doc.extractionStatus === "PROCESSING" || !isReviewActionCurrent(manualPageTarget, snapshot)) {
      setDialogError("The shipment or its check run changed. Close this dialog, review the latest source, then mark the page again.");
      return;
    }
    if (pageNote.trim().length < 3) { setDialogError("Give a reason of at least 3 characters for manual entry."); return; }
    const targetPage = manualPageTarget.page;
    void controller.markPage(doc, targetPage, pageNote).then((saved) => {
      if (!saved) return;
      setManualPageTarget(null);
      setPageNote("");
      setInspectorTab("fields");
      setMobilePane("review");
      setManualEntries((entries) => {
        const entry = entries[doc.id];
        return { ...entries, [doc.id]: { open: true, draft: entry && manualIsDirty(entry.draft) ? entry.draft : blankManualDraft(targetPage), base: entry?.base ?? null } };
      });
    });
  }

  function confirmManagerDecision() {
    if (!managerTarget || busy || isRefreshing) return;
    if (!isReviewActionCurrent(managerTarget, snapshot)) {
      setDialogError("The shipment or its latest checks changed. Close this dialog and review the latest revision before deciding.");
      return;
    }
    const error = validateManagerDecision(managerDecision, managerComment, crossChecks, { hasDrafts, refreshRequired, checksStale });
    if (error) { setDialogError(error); return; }
    void controller.decide(managerDecision, managerComment).then((saved) => {
      if (saved) { setManagerTarget(null); setManagerComment(""); }
    });
  }

  function guardLink(event: MouseEvent<HTMLAnchorElement>) {
    if ((!hasDrafts && !managerComment) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setLeaveHref(event.currentTarget.getAttribute("href"));
  }
  const shipmentLink = <Link href={`/shipments/${shipment.id}`} onClick={guardLink} className={cn("inline-flex min-h-[var(--control-height)] items-center gap-2 text-sm font-medium text-primary", FOCUS_RING_STYLES)}>Open shipment<FileText className="size-4" aria-hidden="true" /></Link>;

  const documentPane = (
    <section aria-label="Document evidence viewer" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-surface" data-testid="document-pane">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 id="document-pane-heading" tabIndex={-1} className={cn("min-w-0 flex-1 truncate text-sm font-medium", FOCUS_RING_STYLES)} title={activeDoc?.originalFileName}>{activeDoc?.originalFileName ?? `${DOCUMENT_LABELS[activeDocType]} not supplied`}</h2>
        <Button type="button" variant="ghost" size="icon" disabled={!activeDoc} aria-label="Rotate document 90 degrees" title="Rotate 90° (R)" onClick={() => setRotation((value) => calculateNextRotation(value))}><RotateCw className="size-4" aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={!activeDoc} aria-label="Open original secure document in new tab" onClick={() => activeDoc && void openOriginal(activeDoc)}><ExternalLink className="size-4" aria-hidden="true" /></Button>
      </div>
      <div role="group" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2" aria-label="Document controls">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" disabled={!activeDoc || page <= 1} aria-label="Previous page" title="Previous page ([)" onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <Label htmlFor="document-page" className="sr-only">Document page</Label>
          <Input id="document-page" type="number" className="w-14 px-2 text-center font-mono" value={page} min={1} max={maxPages} disabled={!activeDoc} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= maxPages) setCurrentPage(next); }} />
          <span className="whitespace-nowrap text-sm text-muted-foreground">/ {maxPages}</span>
          <Button type="button" size="icon" variant="ghost" disabled={!activeDoc || page >= maxPages} aria-label="Next page" title="Next page (])" onClick={() => setCurrentPage((value) => Math.min(maxPages, value + 1))}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" disabled={!activeDoc || zoomLevel <= 50} aria-label="Zoom out" onClick={() => setZoomLevel((value) => calculateNextZoom(value, "out"))}><ZoomOut className="size-4" aria-hidden="true" /></Button>
          <Button type="button" size="sm" variant="ghost" className="px-2 font-mono" disabled={!activeDoc} aria-label="Fit width and reset rotation" title="Fit width (0)" onClick={() => { setZoomLevel(100); setRotation(0); }}>{zoomLevel}%</Button>
          <Button type="button" size="icon" variant="ghost" disabled={!activeDoc || zoomLevel >= 200} aria-label="Zoom in" onClick={() => setZoomLevel((value) => calculateNextZoom(value, "in"))}><ZoomIn className="size-4" aria-hidden="true" /></Button>
        </div>
      </div>
      {evidenceReturn ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-info-border bg-info-surface px-4 py-2">
        <p className="text-sm text-info">Evidence for {evidenceReturn.label}</p>
        <Button type="button" variant="link" size="sm" className="px-0" onClick={returnFromEvidence}><ArrowLeft className="size-4" aria-hidden="true" />Back to {evidenceReturn.tab === "fields" ? "field" : evidenceReturn.tab === "checks" ? "check" : "history"}</Button>
      </div> : null}
      <div className="min-h-0 flex-1 bg-viewer-background">
        {activeDoc ? <DocumentViewer key={activeDoc.id} url={activeDoc.signedUrl} mimeType={activeDoc.mimeType} fileName={activeDoc.originalFileName} page={page} zoom={zoomLevel} rotation={rotation} onPageCount={(count) => reportPageCount(activeDoc.id, count)} onRequestFreshUrl={() => requestFreshDocumentUrl(activeDoc.id)} /> : <FeedbackState kind="empty" title={`${DOCUMENT_LABELS[activeDocType]} not supplied`} description="Upload the document on the shipment page to inspect its evidence." className="p-6" action={shipmentLink} />}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
        <p className="text-xs text-muted-foreground">{activePage?.manualEntryRequired ? `Page ${page} · manual entry enabled` : activePage?.isReadable === false ? `Page ${page} · model could not read this page` : `Page ${page} · ${zoomLevel === 100 ? "fit width" : `${zoomLevel}% zoom`}${rotation ? ` · ${rotation}°` : ""}`}</p>
        {activeDoc && !documentReadOnly && !activePage?.manualEntryRequired ? <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { setPageNote(""); setDialogError(null); setManualPageTarget({ ...actionBase(), documentId: activeDoc.id, page }); }}>Mark page for manual entry</Button> : null}
      </div>
    </section>
  );

  const inspector = (
    <section aria-label="Document review inspector" className="h-full min-h-0 min-w-0 overflow-hidden rounded-panel border border-border bg-surface" data-testid="review-inspector">
      <Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as InspectorTab)} className="flex h-full min-h-0 flex-col">
        <TabsList aria-label="Review inspector" className="shrink-0 px-3 py-2">
          <TabsTrigger value="fields">Fields{activeDoc ? ` (${activeDoc.fields.length})` : ""}</TabsTrigger>
          <TabsTrigger value="checks">Checks ({crossChecks.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="fields" className="min-h-0 flex-1 pt-0" tabIndex={-1}>
          <FieldsInspector
            doc={activeDoc} drafts={drafts} category={category} reviewFilter={reviewFilter} focusedId={focusedUncertainId}
            disabled={disabled} readOnly={documentReadOnly} manualOpen={manualEntry?.open ?? false} manualDraft={manualDraft}
            manualError={manualError} manualConflict={manualConflict} onCategory={setCategory} onReviewFilter={setReviewFilter}
            onNext={goToNextUncertainField} onManualOpen={setManualOpen} onManualDraft={setManualDraft}
            onManualSave={saveManualDraft} onManualAcknowledge={acknowledgeManualDraft}
            onDraft={(doc, field, patch) => dispatch({ type: "draft", doc, field, patch })}
            onSave={(doc, field, action) => requestRunChange(() => controller.saveField(doc, field, action), "Save and recompute checks?")}
            onDiscard={(fieldId) => dispatch({ type: "discard", fieldId })} onAcknowledge={(fieldId) => dispatch({ type: "acknowledge", fieldId })}
            onEvidence={inspectEvidence} shipmentLink={shipmentLink}
          />
        </TabsContent>
        <TabsContent value="checks" className="min-h-0 flex-1 pt-0" tabIndex={-1}>
          <ChecksInspector
            checks={crossChecks} documents={documents} mappings={snapshot.lineMappings ?? []} run={snapshot.latestCheckRun}
            revision={shipment.currentRevision} stale={checksStale} disabled={disabled || hasFieldDrafts}
            canResolve={canResolve} canRecheck={!isReadOnly} mappingSelections={mappingSelections} mappingReason={mappingReason}
            resolution={resolution} resolutionError={resolving && feedback?.kind === "error" ? feedback.message : null}
            onRecheck={() => requestRunChange(controller.recheck)} onHistory={() => setInspectorTab("history")} onEvidence={inspectEvidence}
            onStartResolution={startResolution} onResolutionChange={changeResolution} onResolutionClose={() => setResolvingId(null)}
            onResolve={(check) => void saveResolution(check)}
            onMappingSelect={(invoiceId, packingId) => setMappingSelections((previous) => ({ ...previous, [invoiceId]: packingId }))}
            onMappingReason={setMappingReason} onMap={saveMapping}
            onRemoveMapping={(id) => requestRunChange(() => controller.removeMapping(id), "Remove mapping and recompute checks?")}
            submissionBlockers={controller.submitBlockers}
          />
        </TabsContent>
        <TabsContent value="history" className="min-h-0 flex-1 pt-0" tabIndex={-1}>
          <HistoryInspector
            data={snapshot} active={inspectorTab === "history"} disabled={disabled} canResolve={canResolve}
            resolution={resolution} resolutionError={resolving && feedback?.kind === "error" ? feedback.message : null}
            onRefresh={controller.refreshLatest} onEvidence={inspectEvidence} onStartResolution={startResolution}
            onResolutionChange={changeResolution} onResolutionClose={() => setResolvingId(null)} onResolve={(check) => void saveResolution(check)}
          />
        </TabsContent>
      </Tabs>
    </section>
  );

  return (
    <div className="flex h-dvh min-h-[560px] w-full flex-col bg-background text-foreground" data-testid="review-workspace" data-layout={isDesktop ? "desktop" : "mobile"}>
      <header className="shrink-0 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <Link href={`/shipments/${shipment.id}`} onClick={guardLink} aria-label="Back to shipment" className={cn("inline-flex size-[var(--control-height)] shrink-0 items-center justify-center rounded-control text-foreground-secondary hover:bg-surface-subtle", FOCUS_RING_STYLES)}><ArrowLeft className="size-5" aria-hidden="true" /></Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold leading-7">Document review</h1><StatusBadge status={shipment.status} /><Badge variant="outline">Rev {shipment.currentRevision}</Badge></div>
              <p className="mt-1 break-words text-sm text-foreground-secondary"><span className="font-mono tabular-nums text-foreground">{shipment.reference}</span><span className="hidden sm:inline"> · {shipment.supplier?.name ?? "Supplier not specified"}</span></p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy || isRefreshing)} loading={isRefreshing} onClick={controller.refreshLatest} aria-label="Refresh latest shipment"><RefreshCw className="size-4" aria-hidden="true" />Refresh</Button>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setExportOpen(true)}><FileDown className="size-4" aria-hidden="true" />Export preview</Button>
            {isManager && shipment.status === "READY_FOR_APPROVAL" ? <Button type="button" size="sm" disabled={disabled || hasDrafts} onClick={() => { setManagerDecision("APPROVE"); setDialogError(null); setManagerTarget(actionBase()); }}><ShieldCheck className="size-4" aria-hidden="true" />Manager decision</Button> : !isManager && snapshot.currentUserRole === "EXECUTIVE" && !isReadOnly && shipment.status !== "READY_FOR_APPROVAL" ? <Button type="button" size="sm" disabled={disabled || hasDrafts || checksStale} loading={busy === "Submitting shipment"} onClick={() => { void controller.submit().then((saved) => { if (!saved) { setInspectorTab("checks"); setMobilePane("review"); } }); }}><Send className="size-4" aria-hidden="true" />Submit to manager</Button> : null}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-6" aria-label="Shipment review workspace">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Choose a document" className="flex min-w-0 flex-wrap gap-1">
            {DOCUMENT_TYPES.map((type) => {
              const doc = documents.find((item) => item.docType === type);
              return <Button key={type} type="button" size="sm" variant="ghost" aria-pressed={activeDocType === type} className={cn("gap-2", activeDocType === type && "bg-selected text-primary enabled:hover:bg-selected")} onClick={() => { setActiveDocType(type); setCurrentPage(1); setEvidenceReturn(null); setFocusedUncertainId(null); }}><span>{DOCUMENT_LABELS[type]}</span><span className="font-mono text-xs">{doc ? `v${doc.documentVersion}` : "Missing"}</span></Button>;
            })}
          </div>
          <p className="hidden text-xs text-muted-foreground xl:block">N: next uncertain · [ / ]: pages · + / −: zoom · R: rotate</p>
        </div>
        {isReadOnly ? <p className="flex shrink-0 items-start gap-2 text-sm text-foreground-secondary"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{shipment.status === "EXTRACTING" ? "Extraction is running. Review edits are locked until it finishes." : `Read-only ${shipment.status.toLowerCase()} revision. Saved values, source evidence and history remain available.`}</p> : shipment.status === "READY_FOR_APPROVAL" ? <p className="shrink-0 text-sm text-foreground-secondary">Awaiting manager approval. Saving any review change withdraws this submission.</p> : activeDoc?.extractionStatus === "PROCESSING" ? <p className="shrink-0 text-sm text-foreground-secondary">This document is being extracted. Its saved values are read-only until extraction finishes.</p> : null}

        {hasDrafts ? <details className="shrink-0 rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
          <summary className={cn("cursor-pointer font-medium", FOCUS_RING_STYLES)}>{draftCount} unsaved draft{draftCount === 1 ? "" : "s"} · save or discard before submitting, approving or downloading</summary>
          <div className="max-h-52 space-y-3 overflow-y-auto pt-3">
            {Object.entries(drafts).map(([id, draft]) => <div key={id} className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 flex-1 break-words">{DOCUMENT_LABELS[draft.docType]} · {formatFieldLabel(draft.fieldKey)}: <span className="font-mono">{draft.value || "Empty"}</span>{draft.conflict ? " · conflict requires review" : ""}</p><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => dispatch({ type: "discard", fieldId: id })}>Discard field draft</Button></div>)}
            {dirtyManualEntries.map(([id, entry]) => {
              const doc = documents.find((item) => item.id === id);
              return <div key={id} className="space-y-1">
                <p className="break-words">{doc ? DOCUMENT_LABELS[doc.docType] : "Replaced document"} · Manual field {formatFieldLabel(entry.draft.fieldKey)}: <span className="font-mono">{entry.draft.value}</span>{manualDraftConflict(entry, doc) ? " · conflict requires review" : ""}</p>
                <p className="break-words">Reason: {entry.draft.reason || "Not supplied"}</p>
                <div className="flex flex-wrap gap-2">{doc ? <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => resumeManualDraft(id)}>Resume manual draft</Button> : null}<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setManualEntries((entries) => ({ ...entries, [id]: { open: false, draft: blankManualDraft(entry.draft.page), base: null } }))}>Discard manual draft</Button></div>
              </div>;
            })}
            {dirtyResolutions.map(([id, entry]) => {
              const current = crossChecks.some((check) => check.id === id);
              return <div key={id} className="space-y-1">
                <p className="font-medium">{checkLabel(entry.check)} · {current ? "Current resolution draft" : "Retained draft from an earlier run"}</p>
                <p className="break-words">Reason: {entry.draft.reason || "Not supplied"}</p>
                {entry.draft.evidence ? <p className="break-words">Evidence: {entry.draft.evidence}</p> : null}
                <div className="flex flex-wrap gap-2">{current || entry.type !== "ACCEPTED_EXCEPTION" ? <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { setResolvingId(id); setInspectorTab(current ? "checks" : "history"); setMobilePane("review"); focusReviewElement(current ? `check-card-${id}` : `history-check-${id}`); }}>Resume resolution draft</Button> : null}<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setResolutionEntries((entries) => { const next = { ...entries }; delete next[id]; return next; }); if (resolvingId === id) setResolvingId(null); }}>Discard resolution draft</Button></div>
              </div>;
            })}
            {hasMappingDraft ? <div className="space-y-1"><p>Unsaved line selection or mapping reason</p>{mappingReason ? <p className="break-words">Reason: {mappingReason}</p> : null}<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setMappingReason(""); setMappingSelections({}); }}>Discard mapping draft</Button></div> : null}
          </div>
        </details> : null}

        {feedback || busy || isRefreshing || refreshRequired ? <div role={feedback?.kind === "error" || feedback?.kind === "warning" || refreshRequired ? "alert" : "status"} data-feedback={feedback?.kind ?? "loading"} className={cn("flex shrink-0 items-start justify-between gap-3 rounded-control border px-3 py-2 text-sm", feedback?.kind === "error" ? "border-danger-border bg-danger-surface text-danger" : feedback?.kind === "warning" || refreshRequired ? "border-warning-border bg-warning-surface text-warning" : feedback?.kind === "success" ? "border-success-border bg-success-surface text-success" : "border-info-border bg-info-surface text-info")}>
          <div className="min-w-0"><p className="break-words">{busy ? `${busy}…` : isRefreshing ? "Refreshing saved values and audit history. Drafts are retained…" : feedback?.message ?? "Refresh the latest shipment before saving. Drafts are retained."}</p>{refreshRequired ? <Button type="button" variant="link" size="sm" disabled={Boolean(busy || isRefreshing)} className="px-0" onClick={controller.refreshLatest}>Refresh latest; keep drafts</Button> : null}</div>
          {!busy && !isRefreshing && !refreshRequired ? <Button type="button" size="icon" variant="ghost" aria-label="Dismiss review feedback" onClick={() => setFeedback(null)}><X className="size-4" aria-hidden="true" /></Button> : null}
        </div> : null}

        {isDesktop ? <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(390px,0.7fr)] gap-4">{documentPane}{inspector}</div> : <Tabs value={mobilePane} onValueChange={setMobilePane} className="flex min-h-0 flex-1 flex-col">
          <TabsList aria-label="Workspace pane" className="mb-3 shrink-0 border-0 bg-surface p-1"><TabsTrigger value="document" className="flex-1">Document</TabsTrigger><TabsTrigger value="review" className="flex-1">Review{uncertainTotal ? ` (${uncertainTotal})` : ""}</TabsTrigger></TabsList>
          <TabsContent value="document" className="min-h-0 flex-1 pt-0" tabIndex={-1}>{documentPane}</TabsContent>
          <TabsContent value="review" className="min-h-0 flex-1 pt-0" tabIndex={-1}>{inspector}</TabsContent>
        </Tabs>}
      </main>

      <ConfirmDialog open={Boolean(pendingAction)} onClose={closePendingAction} onConfirm={confirmPendingAction} title={pendingAction?.title ?? "Start a new check run?"} description={pendingAction?.description} confirmLabel={pendingAction?.confirmLabel} busy={Boolean(busy || isRefreshing)} />
      <ConfirmDialog open={Boolean(manualPageTarget)} onClose={() => setManualPageTarget(null)} onConfirm={markManualPage} title={`Enable manual entry for page ${manualPageTarget?.page ?? page}?`} description="This records a human manual-entry flag and bumps the shipment revision. It does not change the model's readability evidence. Any existing submission is withdrawn and checks must be recomputed." confirmLabel="Mark for manual entry" busy={Boolean(busy || isRefreshing)}>
        <div className="space-y-2"><Label htmlFor="page-manual-note">Why does this page need manual entry?</Label><Textarea id="page-manual-note" value={pageNote} maxLength={500} rows={3} disabled={Boolean(busy || isRefreshing)} aria-invalid={Boolean(dialogError)} onChange={(event) => { setPageNote(event.target.value); setDialogError(null); }} />{dialogError || feedback?.kind === "error" || feedback?.kind === "warning" ? <p role="alert" className="text-sm text-danger">{dialogError ?? feedback?.message}</p> : null}</div>
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(managerTarget)} onClose={() => setManagerTarget(null)} onConfirm={confirmManagerDecision} title={`Manager decision · revision ${managerTarget?.revision ?? shipment.currentRevision}`} description="Decide on this exact saved revision after reviewing fields, checks and audit history. Server approval and revision guards are re-evaluated before recording the decision." confirmLabel={managerDecision === "APPROVE" ? "Approve shipment" : "Return to review"} variant={managerDecision === "REJECT" ? "destructive" : "default"} busy={Boolean(busy || isRefreshing)} className="max-w-2xl">
        <div className="space-y-3">
          <ManagerDecisionSummary data={snapshot} checksStale={checksStale} onInspect={(tab) => { setManagerTarget(null); setInspectorTab(tab); setMobilePane("review"); focusReviewElement(`review-${tab}-heading`); }} />
          <div className="space-y-1"><Label htmlFor="manager-decision">Decision</Label>
          <Select id="manager-decision" value={managerDecision} disabled={Boolean(busy || isRefreshing)} onChange={(event) => { setManagerDecision(event.target.value as "APPROVE" | "REJECT"); setDialogError(null); }}><option value="APPROVE">Approve this revision</option><option value="REJECT">Return to review</option></Select></div>
          <div className="space-y-1"><Label htmlFor="manager-decision-comment">Decision comment {managerCommentRequired ? "(required, at least 5 characters)" : "(optional)"}</Label>
          <Textarea id="manager-decision-comment" value={managerComment} required={managerCommentRequired} minLength={managerCommentRequired ? 5 : undefined} maxLength={500} rows={3} disabled={Boolean(busy || isRefreshing)} aria-invalid={Boolean(dialogError)} aria-describedby={dialogError ? "manager-decision-error" : undefined} onChange={(event) => { setManagerComment(event.target.value); setDialogError(null); }} /></div>
          {dialogError || feedback?.kind === "error" || feedback?.kind === "warning" ? <p id="manager-decision-error" role="alert" className="text-sm text-danger">{dialogError ?? feedback?.message}</p> : null}
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(leaveHref)} onClose={() => setLeaveHref(null)} onConfirm={() => { if (leaveHref) router.push(leaveHref); }} title="Leave this review?" description="Unsaved values and reasons will be lost when leaving this workspace. Stay here to save or discard them deliberately." confirmLabel="Leave without saving" variant="destructive" />
      <ExportPreviewDialog isOpen={exportOpen} onClose={() => setExportOpen(false)} shipmentId={shipment.id} shipmentReference={shipment.reference} shipmentRevision={shipment.currentRevision} shipmentStatus={shipment.status} hasUnsavedChanges={hasDrafts || disabled} onExportSuccess={controller.refreshLatest} onRequestRefresh={controller.refreshLatest} />
    </div>
  );
}
