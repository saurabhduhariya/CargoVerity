"use client";

import { Link2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ReviewWorkspaceCrossCheck,
  ReviewWorkspaceDocument,
  ReviewWorkspaceLineMapping,
} from "@/features/review/review-workspace";

/**
 * Week 4 Step 4: manual Invoice -> Packing List line mapping for lines the deterministic matcher
 * left unresolved (no candidate or ambiguous duplicates). Charge lines are never offered.
 */

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
};

function lineLabel(line: { lineNumber?: number; description: string | null; quantity: string | number | null; unit?: string | null }) {
  const quantity = line.quantity !== null && line.quantity !== undefined ? ` · ${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : "";
  return `#${line.lineNumber ?? "?"} ${line.description ?? "(no description)"}${quantity}`;
}

export function LineMappingPanel(props: LineMappingPanelProps) {
  const { check, documents, mappings, selections, reason, disabled, onSelect, onReasonChange, onMap, onRemove } = props;
  const details = check.details as {
    unmatchedLines?: UnmatchedLine[];
    staleManualMappings?: StaleMapping[];
  };
  const unmatched = details.unmatchedLines ?? [];
  const unmatchedInvoice = unmatched.filter((line) => line.documentType === "INVOICE" && line.lineId);
  const unmatchedPacking = unmatched.filter((line) => line.documentType === "PACKING_LIST" && line.lineId);
  const stale = details.staleManualMappings ?? [];

  const allLines = new Map(
    documents.flatMap((doc) => doc.lineItems.map((item) => [item.id, { ...item, docType: doc.docType }] as const)),
  );

  if (unmatchedInvoice.length === 0 && mappings.length === 0 && stale.length === 0) return null;

  return (
    <section aria-label="Manual line mapping" className="mt-2 space-y-2 rounded-md border border-sky-200 bg-sky-50/40 p-2 text-[11px]">
      <h4 className="font-semibold text-slate-800">Manual line mapping</h4>

      {mappings.length > 0 ? (
        <ul className="space-y-1">
          {mappings.map((mapping) => {
            const invoiceLine = allLines.get(mapping.invoiceLineId);
            const packingLine = allLines.get(mapping.packingListLineId);
            return (
              <li key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white p-1.5">
                <span className="text-slate-700">
                  Invoice {invoiceLine ? lineLabel({ ...invoiceLine, unit: invoiceLine.quantityUnit }) : mapping.invoiceLineId}
                  {" -> "}
                  Packing list {packingLine ? lineLabel({ ...packingLine, unit: packingLine.quantityUnit }) : mapping.packingListLineId}
                  <span className="block text-[10px] text-slate-500">
                    Mapped by {mapping.createdBy ?? "reviewer"} on {new Date(mapping.createdAt).toLocaleString()} · {mapping.reason}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px]"
                  disabled={disabled}
                  onClick={() => onRemove(mapping.id)}
                  aria-label={`Remove mapping for invoice line ${invoiceLine?.lineNumber ?? ""}`}
                >
                  <Unlink className="mr-1 size-3" aria-hidden="true" /> Remove mapping
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {stale.length > 0 ? (
        <div role="status" className="rounded border border-amber-300 bg-amber-50 p-1.5 text-amber-900">
          {stale.length} saved mapping(s) refer to lines that are no longer in the current extraction. Remove them and map the current lines.
        </div>
      ) : null}

      {unmatchedInvoice.length > 0 ? (
        <div className="space-y-1.5">
          <label className="block">
            <span className="text-slate-700">Reason for mapping (required, min 5 characters)</span>
            <Input
              className="mt-0.5 h-7 bg-white text-xs"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="e.g. Same SKU; supplier uses a different description"
            />
          </label>
          {unmatchedInvoice.map((line) => {
            const selectId = `map-select-${line.lineId}`;
            const options = unmatchedPacking;
            return (
              <div key={line.lineId} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-1.5">
                <div className="min-w-[180px] flex-1">
                  <span className="block text-slate-800">Invoice {lineLabel(line)}</span>
                  {line.reason === "AMBIGUOUS_DUPLICATE_CANDIDATES" ? (
                    <span className="text-[10px] text-amber-800">Several packing-list lines match; choose one.</span>
                  ) : (
                    <span className="text-[10px] text-slate-500">No packing-list line matched automatically.</span>
                  )}
                </div>
                <label htmlFor={selectId} className="sr-only">
                  Packing list line for invoice line {line.lineNumber}
                </label>
                <select
                  id={selectId}
                  className="h-7 rounded border border-slate-300 bg-white px-1 text-[11px]"
                  value={selections[line.lineId!] ?? ""}
                  disabled={disabled || options.length === 0}
                  onChange={(event) => onSelect(line.lineId!, event.target.value)}
                >
                  <option value="">{options.length === 0 ? "No unmatched packing-list lines" : "Choose packing list line"}</option>
                  {options.map((option) => (
                    <option key={option.lineId} value={option.lineId}>
                      {lineLabel(option)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={disabled || !selections[line.lineId!] || reason.trim().length < 5}
                  onClick={() => onMap(line.lineId!)}
                >
                  <Link2 className="mr-1 size-3" aria-hidden="true" /> Map lines
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
