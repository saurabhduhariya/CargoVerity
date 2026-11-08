"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ManagerDecisionSummary } from "@/features/review/manager-decision-summary";
import { validateManagerDecision } from "@/features/review/review-presentation";
import { makeReviewData } from "./review-workspace-data";

/** Isolated visual fixture; never mounted on an app route and never calls a mutation API. */
export function WorkflowDecisionPreview() {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = makeReviewData();
  data.shipment.status = "READY_FOR_APPROVAL";
  data.crossChecks = [{ ...data.crossChecks[0], activeResolution: { id: "fixture-exception", type: "ACCEPTED_EXCEPTION", reason: "Synthetic QA workflow exception only: Invoice 3120kg differs from supporting 3165kg; discrepancy is not corrected.", evidence: "QA-REVIEW-DECISIONS-LAYOUT-FIXTURE-MEMO" } }];

  return <main className="space-y-4 p-6">
    <h1 className="text-xl font-semibold">Isolated synthetic decision-layout fixture</h1>
    <p className="text-sm text-foreground-secondary">No server decision or shipment mutation. Actual authenticated decisions were tested separately.</p>
    <Button type="button" onClick={() => { setOpen(true); setError(null); }}>Open decision fixture</Button>
    <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={() => setError(validateManagerDecision("APPROVE", comment, data.crossChecks, { hasDrafts: false, refreshRequired: false, checksStale: false }) ?? "Fixture only: no approval API was called.")} title={`Manager decision · revision ${data.shipment.currentRevision}`} description="Decide on this exact saved revision after reviewing fields, checks and audit history. Server approval and revision guards are re-evaluated before recording the decision." confirmLabel="Approve shipment" className="max-w-2xl">
      <div className="space-y-3">
        <ManagerDecisionSummary data={data} checksStale={false} onInspect={() => setOpen(false)} />
        <div className="space-y-1"><Label htmlFor="fixture-comment">Decision comment (required, at least 5 characters)</Label><Textarea id="fixture-comment" value={comment} onChange={(event) => setComment(event.target.value)} required minLength={5} rows={3} aria-invalid={Boolean(error)} aria-describedby={error ? "fixture-error" : undefined} /></div>
        {error ? <p id="fixture-error" role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </ConfirmDialog>
  </main>;
}
