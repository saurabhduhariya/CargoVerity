"use client";

import { Eye, Link2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { displayDate } from "./review-presentation";
import type { EvidenceTarget, ReviewWorkspaceCrossCheck, ReviewWorkspaceDocument, ReviewWorkspaceLineMapping } from "./review-types";

type UnmatchedLine = {
  documentType: "INVOICE" | "PACKING_LIST";
  lineId?: string;
  lineNumber?: number;
  description: string;
  quantity: string | null;
  unit: string | null;
  reason: string;
  candidateLineIds?: string[];
};
type StaleMapping = { mappingId?: string; invoiceLineId: string; packingListLineId: string; reason: string };
type MappingDetails = { unmatchedLines?: UnmatchedLine[]; staleManualMappings?: StaleMapping[] };

export type LineMappingPanelProps = {
  check: ReviewWorkspaceCrossCheck;
  documents: ReviewWorkspaceDocument[];
  mappings: ReviewWorkspaceLineMapping[];
  selections: Record<string, string>;
  reason: string;
  disabled: boolean;
  onSelect: (invoiceLineId: string, packingListLineId: string) => void;
  onReasonChange: (value: string) => void;
  onMap: (invoiceLineId: string) => void;
  onRemove: (mappingId: string) => void;
  onInspect?: (target: EvidenceTarget) => void;
};

function lineLabel(line: { lineNumber?: number; description: string | null; quantity: string | number | null; unit?: string | null }) {
  return `#${line.lineNumber ?? "?"} ${line.description ?? "No description"}${line.quantity != null ? ` · ${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : ""}`;
}

/** Retain selections across refresh, but never send a vanished or newly matched line. */
export function mappingSelectionIssue(
  check: ReviewWorkspaceCrossCheck | undefined,
  documents: ReviewWorkspaceDocument[],
  mappings: ReviewWorkspaceLineMapping[],
  selections: Record<string, string>,
  invoiceId: string,
): string | null {
  const packingId = selections[invoiceId];
  if (!packingId) return "Choose a packing-list line.";
  const invoice = documents.find((doc) => doc.docType === "INVOICE")?.lineItems.find((line) => line.id === invoiceId);
  const packing = documents.find((doc) => doc.docType === "PACKING_LIST")?.lineItems.find((line) => line.id === packingId);
  if (!invoice || !packing) return "A selected line is no longer in the current extraction. Inspect the current lines and choose again.";
  const unmatched = (check?.details as MappingDetails | undefined)?.unmatchedLines ?? [];
  if (!unmatched.some((line) => line.documentType === "INVOICE" && line.lineId === invoiceId)) {
    return "This invoice line no longer needs manual mapping. Discard the retained selection and review the current check.";
  }
  if (!unmatched.some((line) => line.documentType === "PACKING_LIST" && line.lineId === packingId) ||
    mappings.some((mapping) => mapping.invoiceLineId === invoiceId || mapping.packingListLineId === packingId)) {
    return "The selected line has already been matched or mapped. Choose another current unmatched line.";
  }
  if (Object.entries(selections).some(([id, selected]) => id !== invoiceId && selected === packingId)) {
    return "This packing-list line is selected for another invoice line. Choose a different line.";
  }
  return null;
}

export function LineMappingPanel({ check, documents, mappings, selections, reason, disabled, onSelect, onReasonChange, onMap, onRemove, onInspect }: LineMappingPanelProps) {
  const details = check.details as MappingDetails;
  const unmatched = details.unmatchedLines ?? [];
  const invoices = unmatched.filter((line) => line.documentType === "INVOICE" && line.lineId);
  const packing = unmatched.filter((line) => line.documentType === "PACKING_LIST" && line.lineId);
  const stale = details.staleManualMappings ?? [];
  const allLines = new Map(documents.flatMap((doc) => doc.lineItems.map((line) => [line.id, { ...line, doc }] as const)));
  const retained = Object.entries(selections).filter(([invoiceId, selected]) => selected && !invoices.some((line) => line.lineId === invoiceId));
  if (!invoices.length && !mappings.length && !stale.length && !retained.length) return null;

  return (
    <section aria-label="Manual line mapping" className="space-y-3 border-t border-border pt-4 text-sm">
      <h4 className="text-base font-semibold">Line mapping</h4>
      <p className="text-foreground-secondary">Resolve ambiguous goods lines by choosing one invoice line and one packing-list line. Charge lines are excluded. Every mapping requires a reason and recomputes checks.</p>
      {mappings.length ? <ul className="space-y-3">{mappings.map((mapping) => {
        const invoice = allLines.get(mapping.invoiceLineId);
        const pack = allLines.get(mapping.packingListLineId);
        return (
          <li key={mapping.id} className="space-y-2 border-t border-border pt-3">
            <p className="font-medium">Invoice {invoice ? lineLabel({ ...invoice, unit: invoice.quantityUnit }) : "older line"}<span className="block text-foreground-secondary">→ Packing list {pack ? lineLabel({ ...pack, unit: pack.quantityUnit }) : "older line"}</span></p>
            <p className="break-words text-foreground-secondary">{mapping.reason}</p>
            <p className="break-words text-xs text-muted-foreground">Mapped by {mapping.createdBy ?? "reviewer"} · {displayDate(mapping.createdAt)}</p>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onRemove(mapping.id)} aria-label={`Remove mapping for invoice line ${invoice?.lineNumber ?? "older extraction"}`}><Unlink className="size-4" aria-hidden="true" />Remove mapping</Button>
          </li>
        );
      })}</ul> : null}
      {stale.length ? <div role="status" className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-warning">
        <p>{stale.length} saved mapping{stale.length === 1 ? " refers" : "s refer"} to lines outside the current extraction. Remove stale mappings, then map the current goods lines.</p>
        {stale.filter((entry) => entry.mappingId && !mappings.some((mapping) => mapping.id === entry.mappingId)).map((entry) => <Button key={entry.mappingId} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onRemove(entry.mappingId!)}>Remove stale mapping</Button>)}
      </div> : null}
      {retained.length ? <div role="alert" className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-warning">
        <p>{retained.length} unsaved selection{retained.length === 1 ? " no longer refers" : "s no longer refer"} to an unmatched invoice line. The draft is retained, but cannot be saved against changed data.</p>
        {retained.map(([invoiceId]) => <Button key={invoiceId} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect(invoiceId, "")}>Discard outdated line selection</Button>)}
      </div> : null}
      {invoices.length ? <div className="space-y-4">
        <div className="space-y-1"><Label htmlFor="mapping-reason">Mapping reason (at least 5 characters)</Label><Textarea id="mapping-reason" rows={2} maxLength={500} value={reason} disabled={disabled} onChange={(event) => onReasonChange(event.target.value)} placeholder="Explain how the source documents identify the same goods." /></div>
        {invoices.map((line) => {
          const selected = selections[line.lineId!] ?? "";
          const options = packing.filter((candidate) => allLines.get(candidate.lineId ?? "")?.doc.docType === "PACKING_LIST" &&
            !mappings.some((mapping) => mapping.packingListLineId === candidate.lineId) &&
            !Object.entries(selections).some(([invoiceId, packingId]) => invoiceId !== line.lineId && packingId === candidate.lineId));
          const selectionAvailable = options.some((option) => option.lineId === selected);
          const selectionIssue = selected ? mappingSelectionIssue(check, documents, mappings, selections, line.lineId!) : null;
          const source = allLines.get(line.lineId!);
          const packingSource = allLines.get(selected);
          const errorId = `map-error-${line.lineId}`;
          return (
            <div key={line.lineId} className="space-y-3 border-t border-border pt-3">
              <p className="font-medium">Invoice {lineLabel(line)}</p>
              <p className="text-warning">{line.reason === "AMBIGUOUS_DUPLICATE_CANDIDATES" ? "Several packing-list lines match. Inspect both sources before choosing." : "No packing-list line matched automatically."}</p>
              {source?.sourceQuote ? <p className="break-words text-foreground-secondary">“{source.sourceQuote}”</p> : null}
              <div className="space-y-1">
                <Label htmlFor={`map-select-${line.lineId}`}>Packing list line for invoice line {line.lineNumber}</Label>
                <Select id={`map-select-${line.lineId}`} value={selected} disabled={disabled} aria-invalid={Boolean(selectionIssue)} aria-describedby={selectionIssue ? errorId : undefined} onChange={(event) => onSelect(line.lineId!, event.target.value)}>
                  <option value="">{options.length ? "Choose a packing-list line" : "No unmatched packing-list lines"}</option>
                  {selected && !selectionAvailable ? <option value={selected} disabled>Previous selection (no longer available)</option> : null}
                  {options.map((option) => <option key={option.lineId} value={option.lineId}>{lineLabel(option)}</option>)}
                </Select>
              </div>
              {selectionIssue ? <p id={errorId} role="alert" className="text-sm text-warning">{selectionIssue}</p> : null}
              {packingSource?.sourceQuote ? <p className="break-words text-foreground-secondary">Packing list: “{packingSource.sourceQuote}”</p> : null}
              <div className="flex flex-wrap gap-2">
                {source?.pageNumber && onInspect ? <Button type="button" size="sm" variant="link" className="px-0" onClick={() => onInspect({ documentId: source.doc.id, page: source.pageNumber!, label: `Invoice line ${line.lineNumber}` })}><Eye className="size-4" aria-hidden="true" />Invoice · page {source.pageNumber}</Button> : null}
                {packingSource?.pageNumber && onInspect ? <Button type="button" size="sm" variant="link" className="px-0" onClick={() => onInspect({ documentId: packingSource.doc.id, page: packingSource.pageNumber!, label: `Packing-list line ${packingSource.lineNumber}` })}><Eye className="size-4" aria-hidden="true" />Packing list · page {packingSource.pageNumber}</Button> : null}
                <Button type="button" size="sm" disabled={disabled || !selected || Boolean(selectionIssue) || reason.trim().length < 5} onClick={() => onMap(line.lineId!)}><Link2 className="size-4" aria-hidden="true" />Map lines</Button>
              </div>
            </div>
          );
        })}
      </div> : null}
    </section>
  );
}
