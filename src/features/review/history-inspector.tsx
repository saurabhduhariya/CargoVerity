"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { FeedbackState } from "@/components/ui/feedback-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { CheckEvidence } from "./check-evidence";
import { ResolutionEditor, ResolutionHistory, type ActiveResolutionEditor } from "./checks-inspector";
import { checkLabel, displayDate, DOCUMENT_LABELS, formatFieldLabel } from "./review-presentation";
import type {
  CrossCheckResolutionData,
  EvidenceTarget,
  ResolutionDraft,
  ReviewCheckRun,
  ReviewWorkspaceCrossCheck,
  ReviewWorkspaceInitialData,
} from "./review-types";

type HistoryInspectorProps = {
  data: ReviewWorkspaceInitialData;
  active: boolean;
  disabled: boolean;
  canResolve: boolean;
  resolution: ActiveResolutionEditor | null;
  resolutionError: string | null;
  onRefresh: () => void;
  onEvidence: (target: EvidenceTarget, returnId: string) => void;
  onStartResolution: (check: ReviewWorkspaceCrossCheck, type: CrossCheckResolutionData["type"]) => void;
  onResolutionChange: (draft: ResolutionDraft) => void;
  onResolutionClose: () => void;
  onResolve: (check: ReviewWorkspaceCrossCheck) => void;
};

export function auditEventDetails(metadata: Record<string, unknown> | null | undefined): string[] {
  const meta = metadata ?? {};
  return [
    typeof meta.fieldKey === "string" ? formatFieldLabel(meta.fieldKey) : null,
    "previousValue" in meta || "newValue" in meta || "value" in meta
      ? `${meta.previousValue ?? "Empty"} → ${meta.newValue ?? meta.value ?? "Empty"}`
      : null,
    typeof meta.ruleKey === "string" ? formatFieldLabel(meta.ruleKey) : null,
    typeof meta.reason === "string" && meta.reason ? `Reason: ${meta.reason}` : null,
    typeof meta.evidence === "string" && meta.evidence ? `Evidence: ${meta.evidence}` : null,
    typeof meta.comment === "string" && meta.comment ? `Comment: ${meta.comment}` : null,
    typeof meta.revision === "number" ? `Revision ${meta.revision}` : null,
  ].filter((value): value is string => value !== null);
}

type CheckRunHistoryProps = Omit<HistoryInspectorProps, "active" | "onRefresh"> & {
  run: ReviewCheckRun;
  serverChanged: boolean;
};

export function CheckRunHistory({
  run, data, serverChanged, disabled, canResolve, resolution, resolutionError,
  onEvidence, onStartResolution, onResolutionChange, onResolutionClose, onResolve,
}: CheckRunHistoryProps) {
  const current = run.id === data.latestCheckRun?.id;
  return (
    <details className="min-w-0 border-t border-border pt-2">
      <summary className={cn("cursor-pointer space-y-1 py-2 text-sm", FOCUS_RING_STYLES)}>
        <span className="font-medium">Revision {run.revision} · {current ? "Current run" : "Historical run"}</span>
        <span className="block text-xs text-muted-foreground">{displayDate(run.createdAt)}{run.triggeredBy ? ` · ${formatFieldLabel(run.triggeredBy)}` : ""}</span>
      </summary>
      <div className="space-y-4 py-3">
        {run.results.map((check) => {
          const id = `history-check-${check.id ?? `${run.id}-${check.ruleKey}`}`;
          const latest = data.crossChecks.find((result) => result.ruleKey === check.ruleKey);
          const fixed = Boolean(latest && latest.status !== "MISMATCH" && latest.status !== "INCOMPLETE");
          const failing = check.status === "MISMATCH" || check.status === "INCOMPLETE";
          const editing = resolution && resolution.checkId === check.id && !current ? resolution : null;
          return (
            <article key={check.id ?? check.ruleKey} id={id} tabIndex={-1} className="space-y-3 border-t border-border pt-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-semibold">{checkLabel(check)}</h5>
                <StatusBadge status={check.status} />
              </div>
              <Badge variant="outline">{check.severity === "WARNING" ? "Warning rule" : "Blocking rule"}</Badge>
              <p className="text-sm text-foreground-secondary">{check.details.message ?? check.details.note ?? "Inspect the recorded evidence."}</p>
              <CheckEvidence check={check} documents={data.documents} onEvidence={onEvidence} returnId={id} />
              {check.resolutions?.length ? <ResolutionHistory resolutions={check.resolutions} /> : null}
              {!current && failing && !editing ? (
                <div className="space-y-2">
                  <p className="text-sm text-foreground-secondary">{fixed
                    ? "The current run no longer fails this rule. Link this historical failure to the saved correction or document replacement."
                    : "The current rule still fails, or no current run exists. Fix the source first; audit links cannot clear a current failure."}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={disabled || !canResolve || !fixed || serverChanged} onClick={() => onStartResolution(check, "SOURCE_CORRECTED")}>Link saved correction</Button>
                    <Button type="button" size="sm" variant="outline" disabled={disabled || !canResolve || !fixed || serverChanged} onClick={() => onStartResolution(check, "DOCUMENT_REPLACEMENT")}>Link document replacement</Button>
                  </div>
                </div>
              ) : null}
              {editing ? <ResolutionEditor type={editing.type} draft={editing.draft} disabled={disabled || !canResolve || serverChanged} error={resolutionError} onChange={onResolutionChange} onCancel={onResolutionClose} onSave={() => onResolve(check)} /> : null}
            </article>
          );
        })}
        <details className="text-sm">
          <summary className={cn("cursor-pointer py-2 text-foreground-secondary", FOCUS_RING_STYLES)}>Immutable run snapshot</summary>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-surface-subtle p-3 font-mono text-sm">{JSON.stringify(run.inputSnapshot ?? run.snapshot, null, 2)}</pre>
        </details>
      </div>
    </details>
  );
}

export function HistoryInspector(props: HistoryInspectorProps) {
  const { data, active, disabled, onRefresh, onEvidence } = props;
  const [attempt, setAttempt] = useState(0);
  const key = `${data.shipment.id}|${data.shipment.currentRevision}|${data.latestCheckRun?.id ?? "none"}|${data.auditHistory?.[0]?.id ?? "none"}|${attempt}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    runs: ReviewCheckRun[];
    error?: string;
    revision?: number;
    runId?: string | null;
  } | null>(null);
  const history = loaded?.key === key ? loaded : null;

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/shipments/${data.shipment.id}/crosschecks?includeHistory=true`, { cache: "no-store", signal: abort.signal });
        const body = await response.json() as { history?: ReviewCheckRun[]; currentRevision?: number; latestRun?: { id: string } | null; error?: string };
        if (!response.ok) throw new Error(body.error ?? "History could not be loaded.");
        if (!abort.signal.aborted) setLoaded({ key, runs: body.history ?? [], revision: body.currentRevision, runId: body.latestRun?.id ?? null });
      } catch (error) {
        if (!abort.signal.aborted) setLoaded({ key, runs: [], error: error instanceof Error ? error.message : "History could not be loaded." });
      }
    })();
    return () => abort.abort();
  }, [active, key, data.shipment.id]);

  const modified = data.documents.flatMap((doc) => doc.fields
    .filter((field) => field.currentValue !== field.modelValue || ["CORRECTED", "MANUAL_ENTRY"].includes(field.reviewStatus))
    .map((field) => ({ ...field, doc })));
  const audit = data.auditHistory ?? [];
  const serverChanged = Boolean(history && !history.error && (
    history.revision !== data.shipment.currentRevision ||
    history.runId !== (data.latestCheckRun?.id ?? null)
  ));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div><h3 id="review-history-heading" tabIndex={-1} className="text-base font-semibold">Review history</h3><p className="mt-1 text-xs text-muted-foreground">Corrections, immutable check runs and audit events</p></div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => { setAttempt((value) => value + 1); onRefresh(); }}><RefreshCw className="size-4" aria-hidden="true" />Refresh history</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="history-scroll">
        {serverChanged ? <div role="alert" className="space-y-2 border-b border-warning-border bg-warning-surface p-4 text-sm text-warning"><p>The shipment or its latest check run changed. Refresh the workspace before recording a resolution.</p><Button type="button" variant="outline" size="sm" onClick={onRefresh}>Refresh latest shipment</Button></div> : null}

        <section className="space-y-3 border-b border-border p-4" aria-label="Current document versions">
          <h4 className="text-sm font-semibold">Current documents</h4>
          {data.documents.map((doc) => <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2"><Button type="button" variant="link" size="sm" className="px-0" onClick={() => onEvidence({ documentId: doc.id, page: 1, label: `${DOCUMENT_LABELS[doc.docType]} v${doc.documentVersion}` }, "review-history-heading")}>{DOCUMENT_LABELS[doc.docType]} · v{doc.documentVersion}</Button><StatusBadge status={doc.extractionStatus} /></div>)}
        </section>

        <details open={modified.length > 0} className="border-b border-border px-4 py-3">
          <summary className={cn("cursor-pointer py-2 text-sm font-semibold", FOCUS_RING_STYLES)}>Model to reviewed values ({modified.length})</summary>
          <div className="space-y-4 py-3">
            {modified.length === 0 ? <p className="text-sm text-foreground-secondary">No corrected or manually entered values. Saved values still match the model proposals.</p> : modified.map((field) => (
              <div key={field.id} className="space-y-2 border-t border-border pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{DOCUMENT_LABELS[field.doc.docType]} · {formatFieldLabel(field.fieldKey)}</p><StatusBadge status={field.reviewStatus} /></div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-foreground-secondary">Model proposal</dt><dd className="break-words font-mono">{field.modelValue ?? "Not found"}</dd></div>
                  <div><dt className="text-foreground-secondary">Saved value</dt><dd className="break-words font-mono">{field.currentValue ?? "Empty"}</dd></div>
                </dl>
                {field.reviewReason ? <p className="break-words text-sm text-foreground-secondary">Reason: {field.reviewReason}</p> : null}
              </div>
            ))}
          </div>
        </details>

        <section className="space-y-3 border-b border-border p-4" aria-label="Cross-check run history">
          <h4 className="text-base font-semibold">Check runs</h4>
          <p className="text-sm text-foreground-secondary">Historical results preserve the original evidence. They do not grant current submission, approval or export clearance.</p>
          {!history ? <FeedbackState kind="loading" title="Loading check history" className="py-4" /> : history.error ? <FeedbackState kind="error" title="Check history unavailable" description={history.error} className="py-4" action={<Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Retry history</Button>} /> : !history.runs.length ? <p className="text-sm text-muted-foreground">No check runs have been recorded.</p> : history.runs.map((run) => <CheckRunHistory key={run.id} {...props} run={run} serverChanged={serverChanged} />)}
        </section>

        <section className="space-y-4 p-4" aria-label="Shipment audit trail">
          <h4 className="text-base font-semibold">Audit trail <span className="font-normal text-muted-foreground">({audit.length})</span></h4>
          {audit.length === 200 ? <p className="text-sm text-foreground-secondary">Showing the most recent 200 events.</p> : null}
          {!audit.length ? <p className="text-sm text-muted-foreground">No audit events have been recorded.</p> : (
            <ol className="space-y-4">{audit.map((event) => (
              <li key={event.id} className="space-y-2 border-t border-border pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{formatFieldLabel(event.action)}</span><time dateTime={event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt} className="text-xs text-muted-foreground">{displayDate(event.createdAt)}</time></div>
                <p className="break-words text-xs text-muted-foreground">{event.actorEmail ?? "System"}{event.actorRole ? ` · ${formatFieldLabel(event.actorRole)}` : ""}</p>
                {auditEventDetails(event.metadata).map((detail, index) => <p key={index} className="break-words text-sm text-foreground-secondary">{detail}</p>)}
                <details className="text-sm">
                  <summary className={cn("cursor-pointer py-1 text-muted-foreground", FOCUS_RING_STYLES)}>Event details</summary>
                  <p className="mt-2 break-words font-mono text-xs">{event.entityType} · {event.id}</p>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-surface-subtle p-3 font-mono text-sm">{JSON.stringify(event.metadata ?? {}, null, 2)}</pre>
                </details>
              </li>
            ))}</ol>
          )}
        </section>
      </div>
    </div>
  );
}
