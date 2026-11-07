"use client";

import { ArrowRight, Check, Eye, Plus, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { canEnterManualField, categorizeFieldKey, DOCUMENT_LABELS, FIELD_CATEGORIES, fieldReviewReason, formatFieldLabel, isFieldUncertain, modelEstimate } from "./review-presentation";
import type { EvidenceTarget, FieldAction, FieldCategory, FieldDraft, ManualFieldDraft, ReviewWorkspaceDocument, ReviewWorkspaceField } from "./review-types";

type FieldEditorProps = {
  doc: ReviewWorkspaceDocument;
  field: ReviewWorkspaceField;
  draft?: FieldDraft;
  readOnly: boolean;
  disabled: boolean;
  focused: boolean;
  onDraft: (patch: Partial<Pick<FieldDraft, "value" | "reason">>) => void;
  onSave: (action: FieldAction) => void;
  onDiscard: () => void;
  onAcknowledge: () => void;
  onEvidence: (target: EvidenceTarget, returnId: string) => void;
};

export function FieldEditor({ doc, field, draft, readOnly, disabled, focused, onDraft, onSave, onDiscard, onAcknowledge, onEvidence }: FieldEditorProps) {
  const label = formatFieldLabel(field.fieldKey);
  const uncertain = isFieldUncertain(field);
  const reason = fieldReviewReason(field);
  const reviewed = ["CONFIRMED", "CORRECTED", "MANUAL_ENTRY", "NOT_PRESENT", "NOT_APPLICABLE"].includes(field.reviewStatus);
  const changed = draft?.value !== undefined && draft.value !== (field.currentValue ?? "");
  const canConfirm = !readOnly && !disabled && !draft && !reviewed && Boolean(field.currentValue?.trim());
  const cardId = `field-card-${field.id}`;
  const reasonId = `field-reason-${field.id}`;

  return (
    <article id={cardId} tabIndex={-1} aria-label={`${label}${uncertain ? " (needs review)" : ""}`} data-uncertain={uncertain ? "true" : "false"} data-focused-uncertain={focused ? "true" : undefined} className={cn("min-w-0 space-y-3 border-b border-border px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", uncertain && "border-warning-border bg-warning-surface", focused && "ring-2 ring-inset ring-ring")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`field-input-${field.id}`} className="font-semibold text-foreground">{label}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {draft ? <Badge variant="info">Unsaved draft</Badge> : null}
          <StatusBadge status={field.reviewStatus}>{field.reviewStatus === "PENDING" ? "Awaiting confirmation" : undefined}</StatusBadge>
        </div>
      </div>
      {reason ? <p className={cn("text-sm leading-5", uncertain ? "text-warning" : "text-foreground-secondary")}><span className="font-medium">{uncertain ? "Review reason: " : reviewed ? "Saved reason: " : ""}</span>{reason}</p> : null}
      <Input id={`field-input-${field.id}`} value={draft?.value ?? field.currentValue ?? ""} readOnly={readOnly} disabled={disabled} maxLength={500} className={categorizeFieldKey(field.fieldKey) === "parties" ? "" : "font-mono tabular-nums"} aria-invalid={Boolean(draft?.error)} aria-describedby={draft?.error ? `field-error-${field.id}` : undefined} placeholder={field.currentValue === null ? "No extracted value" : undefined} onChange={(event) => onDraft({ value: event.target.value })} onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (canConfirm) onSave("CONFIRMED");
        else document.getElementById(reasonId)?.focus();
      }} />
      {field.unit ? <p className="text-xs text-muted-foreground">Unit: <span className="font-mono">{field.unit}</span></p> : null}
      {draft?.conflict === "changed" ? (
        <div role="alert" className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning">
          <p className="font-semibold">The saved value or review state changed.</p>
          <p>Latest saved value: <span className="break-words font-mono">{field.currentValue ?? "Empty"}</span>. Your draft and reason are retained. Compare them before saving again.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled || readOnly} onClick={onAcknowledge}>Keep my draft</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onDiscard}>Use saved value</Button></div>
        </div>
      ) : null}
      {draft && !readOnly ? (
        <div className="space-y-2">
          <Label htmlFor={reasonId}>Correction reason <span className="font-normal">(at least 3 characters)</span></Label>
          <Textarea id={reasonId} rows={2} maxLength={500} value={draft.reason} disabled={disabled} onChange={(event) => onDraft({ reason: event.target.value })} placeholder="Explain what you read on the source document." onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && changed && draft.reason.trim().length >= 3 && !draft.conflict && !disabled) { event.preventDefault(); onSave("CORRECTED"); } }} />
        </div>
      ) : null}
      {draft?.error ? <p id={`field-error-${field.id}`} role="alert" className="text-sm text-danger">{draft.error}</p> : null}
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!canConfirm} onClick={() => onSave("CONFIRMED")}><Check className="size-4" aria-hidden="true" />Confirm</Button>
          {draft ? <><Button type="button" size="sm" disabled={disabled || !changed || draft.reason.trim().length < 3 || Boolean(draft.conflict)} onClick={() => onSave("CORRECTED")}><Save className="size-4" aria-hidden="true" />Save correction</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onDiscard}>Discard draft</Button></> : <span className="text-xs text-muted-foreground">Edit the value to correct it.</span>}
        </div>
      ) : draft ? <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onDiscard}>Discard unsaved draft</Button> : null}
      {field.modelValue !== field.currentValue ? <p className="text-sm text-foreground-secondary">Original model value: <span className="break-words font-mono">{field.modelValue ?? "Not found"}</span></p> : null}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{modelEstimate(field.modelConfidence)}</span>
          {field.pageNumber && field.pageNumber <= (doc.pageCount ?? Infinity) ? <Button type="button" size="sm" variant="link" className="px-0" onClick={() => onEvidence({ documentId: doc.id, page: field.pageNumber!, fieldId: field.id, label }, cardId)}><Eye className="size-4" aria-hidden="true" />Source · page {field.pageNumber}</Button> : <span className="text-xs text-muted-foreground">Source page unavailable</span>}
        </div>
        {field.sourceQuote ? <blockquote className="break-words text-sm leading-5 text-foreground-secondary">“{field.sourceQuote}”</blockquote> : <p className="text-sm text-foreground-secondary">No source quote was provided. Inspect the document directly.</p>}
      </div>
    </article>
  );
}

type FieldsInspectorProps = {
  doc?: ReviewWorkspaceDocument;
  drafts: Record<string, FieldDraft>;
  category: FieldCategory | "all";
  reviewFilter: "all" | "uncertain" | "pending";
  focusedId: string | null;
  disabled: boolean;
  readOnly: boolean;
  manualOpen: boolean;
  manualDraft: ManualFieldDraft;
  manualError: string | null;
  manualConflict?: "changed" | "removed";
  onCategory: (value: FieldCategory | "all") => void;
  onReviewFilter: (value: "all" | "uncertain" | "pending") => void;
  onNext: () => void;
  onManualOpen: (open: boolean) => void;
  onManualDraft: (draft: ManualFieldDraft) => void;
  onManualSave: () => void;
  onManualAcknowledge: () => void;
  onDraft: (doc: ReviewWorkspaceDocument, field: ReviewWorkspaceField, patch: Partial<Pick<FieldDraft, "value" | "reason">>) => void;
  onSave: (doc: ReviewWorkspaceDocument, field: ReviewWorkspaceField, action: FieldAction) => void;
  onDiscard: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onEvidence: (target: EvidenceTarget, returnId: string) => void;
  shipmentLink: React.ReactNode;
};

export function FieldsInspector(props: FieldsInspectorProps) {
  const { doc, drafts, category, reviewFilter, focusedId, disabled, readOnly, manualOpen, manualDraft, manualError, manualConflict, onCategory, onReviewFilter, onNext, onManualOpen, onManualDraft, onManualSave, onManualAcknowledge, onDraft, onSave, onDiscard, onAcknowledge, onEvidence, shipmentLink } = props;
  const fields = (doc?.fields ?? []).filter((f) => (category === "all" || categorizeFieldKey(f.fieldKey) === category) && (reviewFilter === "all" || (reviewFilter === "uncertain" ? isFieldUncertain(f) : f.reviewStatus === "PENDING")));
  const uncertainCount = doc?.fields.filter(isFieldUncertain).length ?? 0;
  const pendingCount = doc?.fields.filter((f) => f.reviewStatus === "PENDING").length ?? 0;
  const orphans = Object.entries(drafts).filter(([, draft]) => draft.conflict === "removed");
  const options = doc?.manualFieldOptions ?? [];
  const selectedOption = options.find((option) => option.fieldKey === manualDraft.fieldKey);
  const manualUnlocked = doc && selectedOption && canEnterManualField(doc, selectedOption.fieldKey, manualDraft.page);
  const manualSavedField = doc?.fields.find((field) => field.fieldKey === manualDraft.fieldKey);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div id="review-fields-heading" tabIndex={-1} className={cn("shrink-0 space-y-3 border-b border-border px-4 py-3", FOCUS_RING_STYLES)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-foreground-secondary"><span className={uncertainCount ? "font-medium text-warning" : ""}>{uncertainCount} require review</span><span className="text-muted-foreground"> · {pendingCount} pending</span></p>
          <Button type="button" size="sm" variant="outline" disabled={!doc || uncertainCount === 0} onClick={onNext}>Next uncertain<ArrowRight className="size-4" aria-hidden="true" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="field-category" className="sr-only">Field category</Label><Select id="field-category" value={category} onChange={(event) => onCategory(event.target.value as FieldCategory | "all")}>{FIELD_CATEGORIES.map((value) => <option key={value} value={value}>{value === "all" ? "All categories" : formatFieldLabel(value)}</option>)}</Select></div>
          <div><Label htmlFor="field-review-filter" className="sr-only">Review filter</Label><Select id="field-review-filter" value={reviewFilter} onChange={(event) => onReviewFilter(event.target.value as "all" | "uncertain" | "pending")}><option value="all">All fields</option><option value="uncertain">Review required</option><option value="pending">Awaiting confirmation</option></Select></div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="field-scroll">
        {orphans.length > 0 ? <section className="space-y-3 border-b border-warning-border bg-warning-surface p-4" aria-label="Retained drafts from older extractions"><h3 className="font-semibold text-warning">Drafts from replaced data</h3><p className="text-sm text-warning">These fields no longer belong to the current documents. Your values and reasons are retained for comparison; they cannot overwrite a new extraction.</p>{orphans.map(([id, draft]) => <div key={id} className="space-y-2 border-t border-warning-border pt-3"><p className="text-sm font-medium">{DOCUMENT_LABELS[draft.docType]} · {formatFieldLabel(draft.fieldKey)}</p><Textarea aria-label={`Retained draft for ${draft.fieldKey}`} readOnly value={draft.value} rows={2} /><p className="break-words text-sm">Reason: {draft.reason || "Not supplied"}</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onDiscard(id)}>Discard retained draft</Button></div>)}</section> : null}
        {!doc ? <FeedbackState kind="empty" title="Document not supplied" description="Upload the current document on the shipment page before reviewing its fields." className="px-4" action={shipmentLink} /> : (
          <>
            {manualOpen ? (
              <form className="space-y-3 border-b border-info-border bg-info-surface p-4" aria-label="Manual field entry" onSubmit={(event) => { event.preventDefault(); if (!disabled && !readOnly && manualUnlocked && !manualConflict) onManualSave(); }}>
                <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">Manual field entry</h3><Button type="button" variant="ghost" size="icon" aria-label="Close manual entry (retain draft)" onClick={() => onManualOpen(false)}><X className="size-4" aria-hidden="true" /></Button></div>
                <p className="text-sm text-info">Enter only what the source document supports. With an AI extraction, first mark the source page for manual entry. Existing readable values use correction.</p>
                <div className="space-y-1"><Label htmlFor="manual-field-key">Field</Label><Select id="manual-field-key" value={manualDraft.fieldKey} disabled={disabled || readOnly} required onChange={(event) => onManualDraft({ ...manualDraft, fieldKey: event.target.value })}><option value="">Choose a supported field</option>{options.map((option) => <option key={option.fieldKey} value={option.fieldKey}>{formatFieldLabel(option.fieldKey)}{option.required ? " (required)" : ""}</option>)}</Select></div>
                <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor="manual-field-page">Source page</Label><Input id="manual-field-page" type="number" min={1} max={doc.pageCount ?? undefined} required value={manualDraft.page} disabled={disabled || readOnly} onChange={(event) => onManualDraft({ ...manualDraft, page: Number(event.target.value) })} /></div><div className="space-y-1"><Label htmlFor="manual-field-unit">Unit (if applicable)</Label><Input id="manual-field-unit" value={manualDraft.unit} maxLength={20} disabled={disabled || readOnly} onChange={(event) => onManualDraft({ ...manualDraft, unit: event.target.value })} placeholder="kg, USD, pcs" /></div></div>
                <div className="space-y-1"><Label htmlFor="manual-field-value">Value{selectedOption?.required ? " (required)" : ""}</Label><Input id="manual-field-value" value={manualDraft.value} maxLength={500} required={selectedOption?.required} disabled={disabled || readOnly} onChange={(event) => onManualDraft({ ...manualDraft, value: event.target.value })} placeholder={selectedOption?.isDate ? "2026-11-07" : selectedOption?.isNumeric ? "Number only, e.g. 3165" : "Value shown on the source"} /></div>
                <div className="space-y-1"><Label htmlFor="manual-field-reason">Reason for manual entry</Label><Textarea id="manual-field-reason" value={manualDraft.reason} required minLength={3} maxLength={500} rows={2} disabled={disabled || readOnly} onChange={(event) => onManualDraft({ ...manualDraft, reason: event.target.value })} /></div>
                {selectedOption && !manualUnlocked ? <p className="text-sm text-warning">Manual entry is not unlocked for this field and page. Mark the source page for manual entry, or correct the existing field.</p> : null}
                {manualConflict ? <div role="alert" className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning"><p className="font-semibold">The saved field or extraction changed.</p><p>Your manual value and reason are retained. Latest saved value: <span className="break-words font-mono">{manualSavedField?.currentValue ?? "Not entered"}</span>{manualSavedField?.unit ? ` ${manualSavedField.unit}` : ""}. Compare the current source before saving again.</p>{manualSavedField?.reviewReason ? <p className="break-words">Saved reason: {manualSavedField.reviewReason}</p> : null}<Button type="button" variant="outline" size="sm" disabled={disabled || readOnly} onClick={onManualAcknowledge}>Keep my manual draft</Button></div> : null}
                {manualError ? <p role="alert" className="text-sm text-danger">{manualError}</p> : null}
                <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={disabled || readOnly || !manualUnlocked || Boolean(manualConflict) || manualDraft.reason.trim().length < 3}><Save className="size-4" aria-hidden="true" />Save manual field</Button><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { onManualDraft({ fieldKey: "", value: "", unit: "", reason: "", page: manualDraft.page }); onManualOpen(false); }}>Discard manual draft</Button></div>
              </form>
            ) : null}
            {fields.length > 0 ? fields.map((field) => <FieldEditor key={field.id} doc={doc} field={field} draft={drafts[field.id]} readOnly={readOnly} disabled={disabled} focused={focusedId === field.id} onDraft={(patch) => onDraft(doc, field, patch)} onSave={(action) => onSave(doc, field, action)} onDiscard={() => onDiscard(field.id)} onAcknowledge={() => onAcknowledge(field.id)} onEvidence={onEvidence} />) : <FeedbackState kind="empty" title={doc.fields.length ? "No fields match these filters" : "No extracted fields yet"} description={doc.fields.length ? "Choose All fields or another category to continue." : doc.extractionStatus === "PROCESSING" ? "Extraction is running. Wait for it to finish, then refresh the latest shipment." : "Review the source directly. Manual entry is available when extraction failed or no readable values were produced."} className="px-4" />}
            {!readOnly ? <div className="border-b border-border px-4 py-3"><Button type="button" size="sm" variant="outline" disabled={disabled} aria-expanded={manualOpen} onClick={() => onManualOpen(!manualOpen)}><Plus className="size-4" aria-hidden="true" />{manualOpen ? "Hide manual entry" : "Add manual field"}</Button></div> : null}
            {doc.lineItems.length > 0 ? <section className="space-y-3 py-4" aria-label="Extracted line items">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4"><h3 id="line-items-heading" tabIndex={-1} className={cn("text-base font-semibold", FOCUS_RING_STYLES)}>Line items <span className="font-normal text-muted-foreground">({doc.lineItems.length})</span></h3><p className="text-xs text-muted-foreground">Match invoice and packing lines in Checks.</p></div>
              <Table containerLabel="Line item table" className="min-w-[620px]">
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Description / HSN</TableHead><TableHead numeric>Quantity</TableHead><TableHead numeric>Unit price</TableHead><TableHead numeric>Total</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
                <TableBody>{doc.lineItems.map((item, index) => <TableRow key={item.id}>
                  <TableCell className="font-mono">{item.lineNumber ?? index + 1}</TableCell>
                  <TableCell className="min-w-40 max-w-64 break-words">{item.description ?? "Not supplied"}<span className="mt-1 block font-mono text-xs text-muted-foreground">HSN {item.hsnCode ?? "Not supplied"}{item.sku ? ` · SKU ${item.sku}` : ""}</span></TableCell>
                  <TableCell numeric>{item.quantity ?? "—"}{item.quantityUnit ? ` ${item.quantityUnit}` : ""}</TableCell>
                  <TableCell numeric>{item.unitPrice ?? "—"}</TableCell>
                  <TableCell numeric>{item.lineTotal ?? "—"}{item.currency ? ` ${item.currency}` : ""}</TableCell>
                  <TableCell>{item.pageNumber ? <Button type="button" variant="link" size="sm" className="px-0" onClick={() => onEvidence({ documentId: doc.id, page: item.pageNumber!, label: `Line ${item.lineNumber ?? index + 1}` }, "line-items-heading")}><Eye className="size-4" aria-hidden="true" />Page {item.pageNumber}</Button> : "Unavailable"}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </section> : null}
          </>
        )}
      </div>
    </div>
  );
}
