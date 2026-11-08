"use client";

import { useState } from "react";
import { ChevronRight, History, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CheckEvidence } from "./check-evidence";
import { checkDisplayStatus, checkLabel, displayDate } from "./review-presentation";
import { LineMappingPanel } from "./line-mapping-panel";
import type { CheckRunSummary, CrossCheckResolutionData, EvidenceTarget, ResolutionDraft, ReviewWorkspaceCrossCheck, ReviewWorkspaceDocument, ReviewWorkspaceLineMapping } from "./review-types";

export type ActiveResolutionEditor = { checkId: string; type: CrossCheckResolutionData["type"]; draft: ResolutionDraft };

export function ResolutionEditor({ type, draft, disabled, error, onChange, onCancel, onSave }: { type: CrossCheckResolutionData["type"]; draft: ResolutionDraft; disabled: boolean; error: string | null; onChange: (draft: ResolutionDraft) => void; onCancel: () => void; onSave: () => void }) {
  const exception = type === "ACCEPTED_EXCEPTION";
  return (
    <form aria-label={exception ? "Accepted exception" : "Historical resolution link"} className="space-y-3 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <h4 className="text-base font-semibold">{exception ? "Record an accepted exception" : type === "SOURCE_CORRECTED" ? "Link to a saved correction" : "Link to a document replacement"}</h4>
      <p className="text-sm text-foreground-secondary">{exception ? "The original mismatch stays on record. A manager must sign off before export." : "Link this earlier failure to a saved correction or replacement. The latest check must no longer fail."}</p>
      <div className="space-y-1"><Label htmlFor="resolution-reason">Resolution reason (at least 5 characters)</Label><Textarea id="resolution-reason" value={draft.reason} minLength={5} maxLength={500} rows={3} disabled={disabled} required onChange={(event) => onChange({ ...draft, reason: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="resolution-evidence">{exception ? "External evidence / query reference (required)" : "Evidence reference (optional)"}</Label><Input id="resolution-evidence" value={draft.evidence} required={exception} minLength={exception ? 3 : undefined} maxLength={500} disabled={disabled} placeholder="Supplier email, query or ticket reference" onChange={(event) => onChange({ ...draft, evidence: event.target.value })} /><p className="text-sm text-foreground-secondary">{exception ? "Use a traceable reference, not an unsupported statement that the difference is acceptable." : "The saved fix and its current check run must exist before this historical link can be recorded."}</p></div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-foreground"><input type="checkbox" checked={draft.valuesConfirmed} disabled={disabled} onChange={(event) => onChange({ ...draft, valuesConfirmed: event.target.checked })} className="mt-1 size-4 shrink-0 accent-primary" required /><span>I reviewed the compared values and inspected the source documents.</span></label>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={disabled || !draft.valuesConfirmed || draft.reason.trim().length < 5 || (exception && draft.evidence.trim().length < 3)}>Record {exception ? "exception" : "link"}</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>Close (keep draft)</Button></div>
    </form>
  );
}

export function ResolutionHistory({ resolutions }: { resolutions: CrossCheckResolutionData[] }) {
  return <ul className="space-y-3 text-sm">{resolutions.map((resolution) => <li key={resolution.id} className="space-y-1 border-t border-border pt-3"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={resolution.type} /><span className="text-xs text-muted-foreground">{resolution.createdAt ? displayDate(resolution.createdAt) : ""}</span></div><p className="break-words">{resolution.reason}</p>{resolution.evidence ? <p className="break-words text-foreground-secondary">Evidence: <span className="font-mono">{resolution.evidence}</span></p> : null}<p className="break-words text-xs text-muted-foreground">By {resolution.resolvedBy?.fullName ?? resolution.resolvedBy?.email ?? "reviewer"}{resolution.type === "ACCEPTED_EXCEPTION" ? resolution.managerApprovedAt ? ` · manager signed off ${displayDate(resolution.managerApprovedAt)}` : " · awaiting manager sign-off" : " · audit link only"}</p></li>)}</ul>;
}

type ChecksInspectorProps = {
  checks: ReviewWorkspaceCrossCheck[];
  documents: ReviewWorkspaceDocument[];
  mappings: ReviewWorkspaceLineMapping[];
  run?: CheckRunSummary | null;
  revision: number;
  stale: boolean;
  disabled: boolean;
  canResolve: boolean;
  canRecheck: boolean;
  mappingSelections: Record<string, string>;
  mappingReason: string;
  resolution: ActiveResolutionEditor | null;
  resolutionError: string | null;
  onRecheck: () => void;
  onHistory: () => void;
  onEvidence: (target: EvidenceTarget, returnId: string) => void;
  onStartResolution: (check: ReviewWorkspaceCrossCheck, type: CrossCheckResolutionData["type"]) => void;
  onResolutionChange: (draft: ResolutionDraft) => void;
  onResolutionClose: () => void;
  onResolve: (check: ReviewWorkspaceCrossCheck) => void;
  onMappingSelect: (invoiceId: string, packingId: string) => void;
  onMappingReason: (reason: string) => void;
  onMap: (invoiceId: string) => void;
  onRemoveMapping: (id: string) => void;
  submissionBlockers?: string[];
};

export function ChecksInspector(props: ChecksInspectorProps) {
  const { checks, documents, mappings, run, revision, stale, disabled, canResolve, canRecheck, mappingSelections, mappingReason, resolution, resolutionError, onRecheck, onHistory, onEvidence, onStartResolution, onResolutionChange, onResolutionClose, onResolve, onMappingSelect, onMappingReason, onMap, onRemoveMapping } = props;
  const [filter, setFilter] = useState("all");
  const rank = (check: ReviewWorkspaceCrossCheck) => ["MISMATCH", "INCOMPLETE"].includes(checkDisplayStatus(check)) ? 0 : checkDisplayStatus(check) === "PENDING_MANAGER_APPROVAL" ? 1 : checkDisplayStatus(check) === "HUMAN_CLEARED" ? 2 : 3;
  const ordered = [...checks].filter((check) => filter === "all" || (filter === "unresolved" ? rank(check) === 0 : filter === "exceptions" ? rank(check) === 1 || rank(check) === 2 : check.status === "PASS" || check.status === "NOT_APPLICABLE")).sort((a, b) => rank(a) - rank(b));
  const passed = checks.filter((check) => check.status === "PASS").length;
  const exceptions = checks.filter((check) => ["HUMAN_CLEARED", "PENDING_MANAGER_APPROVAL"].includes(checkDisplayStatus(check))).length;
  const unresolved = checks.filter((check) => ["MISMATCH", "INCOMPLETE"].includes(checkDisplayStatus(check))).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h3 id="review-checks-heading" tabIndex={-1} className={cn("text-base font-semibold", FOCUS_RING_STYLES)}>Cross-checks</h3><p className="mt-1 text-xs text-muted-foreground">{run ? `Revision ${run.revision} · ${run.createdAt ? displayDate(run.createdAt) : "Updating timestamp"}` : `No checks for revision ${revision}`}</p></div><Button type="button" size="sm" variant="outline" disabled={disabled || !canRecheck} onClick={onRecheck}><RefreshCw className="size-4" aria-hidden="true" />Re-run checks</Button></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="checks-scroll">
        {props.submissionBlockers?.length ? <section role="alert" className="space-y-3 border-b border-danger-border bg-danger-surface p-4 text-sm text-danger"><h4 className="font-semibold">Submission blocked · {props.submissionBlockers.length} issues</h4><ul className="list-disc space-y-2 pl-5">{props.submissionBlockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul></section> : null}
        {stale ? <div role="alert" className="space-y-2 border-b border-warning-border bg-warning-surface p-4 text-sm text-warning"><p className="font-semibold">Checks are not current.</p><p>Review changes were saved, but checks for this revision are unavailable. Re-run them before submission or approval. Previous runs remain in History.</p></div> : null}
        {checks.length === 0 ? <FeedbackState kind="empty" title="No checks for this revision" description="Save any drafts, then run checks on the saved document values." className="px-4" /> : <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5"><p className="flex flex-wrap gap-x-3 gap-y-1 text-sm"><span className="text-success">{`${passed} passed`}</span><span className={unresolved ? "font-medium text-danger" : "text-foreground-secondary"}>{`${unresolved} unresolved`}</span>{exceptions ? <span className="text-foreground-secondary">{`${exceptions} human exception${exceptions === 1 ? "" : "s"}`}</span> : null}</p><div className="ml-auto"><Label htmlFor="check-filter" className="sr-only">Show checks</Label><Select id="check-filter" className="h-8 w-auto py-0 pr-8 text-xs pointer-coarse:h-11" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All checks ({checks.length})</option><option value="unresolved">Unresolved ({unresolved})</option><option value="exceptions">Human exceptions ({exceptions})</option><option value="passed">Passed / not applicable</option></Select></div></div>
          {!ordered.length ? <FeedbackState kind="empty" title="No checks in this view" description="Choose All checks to see the saved results." className="p-4" action={<Button type="button" variant="outline" size="sm" onClick={() => setFilter("all")}>Show all checks</Button>} /> : null}
          {ordered.map((check) => {
            const failing = check.status === "MISMATCH" || check.status === "INCOMPLETE";
            const displayStatus = checkDisplayStatus(check);
            const id = `check-card-${check.id ?? check.ruleKey}`;
            const editing = resolution?.checkId === check.id;
            return <article key={check.id ?? check.ruleKey} id={id} tabIndex={-1} className="min-w-0 border-b border-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid={`check-${check.ruleKey}`}>
              <details open={failing} className="group/check">
                <summary className={cn("flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-subtle [&::-webkit-details-marker]:hidden", failing && displayStatus === check.status && "bg-danger-surface/60", FOCUS_RING_STYLES)}><span className="flex min-w-0 items-center gap-2 text-sm font-semibold"><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] group-open/check:rotate-90 motion-reduce:transition-none" />{checkLabel(check)}</span><span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={displayStatus} /><Badge variant={check.severity === "WARNING" ? "warning" : "outline"}>{check.severity === "WARNING" ? "Warning" : "Blocking rule"}</Badge></span></summary>
                <div className="space-y-4 px-4 pb-4">
                  <p className="text-sm leading-6 text-foreground-secondary">{check.details.message ?? check.details.note ?? "Inspect the computed evidence for this result."}</p>
                  {displayStatus !== check.status ? <p className="text-sm text-foreground-secondary">Original machine result: <strong>{check.status === "MISMATCH" ? "Mismatch" : "Incomplete"}</strong>. {check.clearedForSubmission === true ? "Exception accepted for submission." : ""} {check.clearedForApproval === true ? "Manager sign-off recorded." : displayStatus === "PENDING_MANAGER_APPROVAL" ? "Manager sign-off is still required." : ""}</p> : null}
                  <CheckEvidence check={check} documents={documents} onEvidence={onEvidence} returnId={id} />
                  <details className="text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer rounded-small py-2 sm:min-h-9">Calculation reference</summary><p className="break-words py-2">Revision {run?.revision ?? "unavailable"} · <span className="font-mono">{check.runId ?? run?.id ?? "Run ID unavailable"}</span>{check.ruleCode ? <span className="mt-1 block font-mono">{check.ruleCode}</span> : null}</p></details>
                  {check.ruleKey === "invoice_quantity_vs_packing_list" ? <LineMappingPanel check={check} documents={documents} mappings={mappings} selections={mappingSelections} reason={mappingReason} disabled={disabled || !canRecheck} onSelect={onMappingSelect} onReasonChange={onMappingReason} onMap={onMap} onRemove={onRemoveMapping} onInspect={(target) => onEvidence(target, id)} /> : null}
                  {check.resolutions?.length ? <div className="space-y-2"><h4 className="text-sm font-medium">Resolution history</h4><ResolutionHistory resolutions={check.resolutions} /></div> : null}
                  {failing && !editing ? <div className="space-y-2"><p className="text-sm text-foreground-secondary">Correct the source value first. If the difference is genuine, record an exception with evidence.</p><Button type="button" size="sm" variant="outline" disabled={disabled || !canResolve || stale || !check.id} onClick={() => onStartResolution(check, "ACCEPTED_EXCEPTION")}>{displayStatus === "HUMAN_CLEARED" || displayStatus === "PENDING_MANAGER_APPROVAL" ? "Record another exception" : "Record exception"}</Button></div> : null}
                  {editing && resolution ? <ResolutionEditor type={resolution.type} draft={resolution.draft} disabled={disabled || !canResolve || stale} error={resolutionError} onChange={onResolutionChange} onCancel={onResolutionClose} onSave={() => onResolve(check)} /> : null}
                </div>
              </details>
            </article>;
          })}
        </>}
        <div className="p-4"><Button type="button" size="sm" variant="ghost" onClick={onHistory}><History className="size-4" aria-hidden="true" />View previous runs and audit history</Button></div>
      </div>
    </div>
  );
}
