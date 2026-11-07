import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DOCUMENT_LABELS, formatFieldLabel } from "./review-presentation";
import type { EvidenceTarget, ReviewWorkspaceCrossCheck, ReviewWorkspaceDocument } from "./review-types";

function scalar(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function documentLabel(value: unknown): string {
  const type = scalar(value) ?? "Source";
  return DOCUMENT_LABELS[type as keyof typeof DOCUMENT_LABELS] ?? formatFieldLabel(type);
}

type ComparedRow = { label: string; raw: string; normalized: string };

/** Read the engine's recorded values; never recompute or round trade data in the UI. */
export function comparedEvidenceRows(check: ReviewWorkspaceCrossCheck): ComparedRow[] {
  const details = check.details;
  const values = records(details.comparedValues ?? details.values);
  if (values.length > 0) {
    return values.map((value) => {
      const unit = scalar(value.rawUnit) ?? scalar(value.rawType) ?? scalar(value.unit) ?? "";
      const raw = scalar(value.rawValue) ?? scalar(value.rawCount) ?? scalar(value.value) ?? "Not supplied";
      const normalized = scalar(value.normalizedKg) ?? scalar(value.normalizedValue) ?? scalar(value.normalizedCount) ?? scalar(value.normalizedName) ?? scalar(value.canonicalString);
      return {
        label: documentLabel(value.documentType),
        raw: `${raw}${unit ? ` ${unit}` : ""}`,
        normalized: normalized !== null ? `${normalized}${value.normalizedKg !== undefined ? " kg" : ""}` : "—",
      };
    });
  }
  if (details.comparedValuesKg) {
    return Object.entries(details.comparedValuesKg).map(([type, value]) => ({ label: documentLabel(type), raw: `${value} kg`, normalized: `${value} kg` }));
  }
  const pairs = records(details.matchedPairs);
  if (pairs.length > 0) {
    return pairs.map((pair) => ({
      label: `Invoice #${scalar(pair.invoiceLineNumber) ?? "?"} / packing list #${scalar(pair.packingListLineNumber) ?? "?"}`,
      raw: `${scalar(pair.invoiceQuantity) ?? "Not supplied"} ${scalar(pair.invoiceUnit) ?? ""} / ${scalar(pair.packingListQuantity) ?? "Not supplied"} ${scalar(pair.packingListUnit) ?? ""}`,
      normalized: pair.difference !== null && pair.difference !== undefined ? `Difference ${scalar(pair.difference)} ${scalar(pair.canonicalUnit) ?? ""}` : "Not comparable",
    }));
  }
  const documents = records(details.documents);
  if (documents.length > 0) {
    return documents.map((document) => ({
      label: documentLabel(document.documentType),
      raw: `Gross ${scalar(document.grossWeight) ?? "Not supplied"} / net ${scalar(document.netWeight) ?? "Not supplied"}`,
      normalized: `Gross ${scalar(document.grossWeightKg) ?? "—"} kg / net ${scalar(document.netWeightKg) ?? "—"} kg`,
    }));
  }
  if (details.compared && typeof details.compared === "object" && !Array.isArray(details.compared)) {
    const compared = details.compared as Record<string, unknown>;
    const currency = scalar(compared.currency) ?? "";
    return [
      ...Object.entries(compared).flatMap(([key, value]) => scalar(value) !== null && key !== "currency"
        ? [{ label: formatFieldLabel(key), raw: `${scalar(value)}${currency ? ` ${currency}` : ""}`, normalized: "—" }]
        : []),
      ...records(compared.charges).map((charge) => ({
        label: `${formatFieldLabel(scalar(charge.kind) ?? "Charge")} (${formatFieldLabel(scalar(charge.source) ?? "Source")})`,
        raw: `${scalar(charge.amount) ?? "—"}${currency ? ` ${currency}` : ""}`,
        normalized: `${scalar(charge.signedAmount) ?? "—"}${currency ? ` ${currency}` : ""}`,
      })),
    ];
  }
  return [];
}

type Source = {
  documentId: string;
  docType: ReviewWorkspaceDocument["docType"];
  page: number | null;
  fieldId?: string;
  label: string;
  quote: string | null;
};

export function checkSourceTargets(check: ReviewWorkspaceCrossCheck, documents: ReviewWorkspaceDocument[]) {
  const sources = new Map<string, Source>(documents.flatMap((doc) => [
    ...doc.fields.map((field) => [field.id, { documentId: doc.id, docType: doc.docType, page: field.pageNumber, fieldId: field.id, label: formatFieldLabel(field.fieldKey), quote: field.sourceQuote }] as const),
    ...doc.lineItems.map((line) => [line.id, { documentId: doc.id, docType: doc.docType, page: line.pageNumber ?? null, label: `Line ${line.lineNumber ?? "?"}`, quote: line.sourceQuote ?? null }] as const),
  ]));
  const referenced = new Set<string>();
  const recordedQuotes = new Map<string, string>();
  function collect(value: unknown) {
    if (typeof value === "string" && sources.has(value)) referenced.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const id = scalar(record.fieldId) ?? scalar(record.lineItemId);
      if (id && typeof record.sourceQuote === "string") recordedQuotes.set(id, record.sourceQuote);
      Object.values(record).forEach(collect);
    }
  }
  collect(check.details);
  return [...referenced].map((id) => ({ id, ...sources.get(id)!, quote: recordedQuotes.get(id) ?? sources.get(id)!.quote }));
}

export function CheckEvidence({ check, documents, onEvidence, returnId }: {
  check: ReviewWorkspaceCrossCheck;
  documents: ReviewWorkspaceDocument[];
  onEvidence: (target: EvidenceTarget, returnId: string) => void;
  returnId: string;
}) {
  const compared = comparedEvidenceRows(check);
  const sources = checkSourceTargets(check, documents);
  const difference = check.details.differenceKg ?? check.details.difference;
  const tolerance = scalar(check.details.toleranceUsed) ?? scalar(check.details.toleranceKg);
  const unit = check.details.differenceKg !== undefined ? "kg" : scalar(check.details.unit) ?? scalar(check.details.currency) ?? "";
  return (
    <div className="space-y-3">
      {compared.length > 0 ? (
        <Table containerLabel="Compared values" className="min-w-[340px]">
          <TableHeader><TableRow><TableHead>Compared value</TableHead><TableHead numeric>Source value</TableHead><TableHead numeric>Normalized</TableHead></TableRow></TableHeader>
          <TableBody>{compared.map((row, index) => <TableRow key={`${row.label}-${index}`}><TableCell>{row.label}</TableCell><TableCell numeric>{row.raw}</TableCell><TableCell numeric>{row.normalized}</TableCell></TableRow>)}</TableBody>
        </Table>
      ) : null}
      {difference != null || tolerance !== null ? <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {difference != null ? <div><dt className="text-foreground-secondary">Difference</dt><dd className="font-mono tabular-nums">{difference}{unit ? ` ${unit}` : ""}</dd></div> : null}
        {tolerance !== null ? <div><dt className="text-foreground-secondary">Tolerance</dt><dd className="font-mono tabular-nums">±{tolerance}{unit ? ` ${unit}` : ""}</dd></div> : null}
      </dl> : null}
      {sources.length > 0 ? <div className="space-y-3">
        <h4 className="text-sm font-medium">Source evidence</h4>
        {sources.map((source) => <div key={source.id} className="space-y-1 border-t border-border pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{DOCUMENT_LABELS[source.docType]} · {source.label}</span>
            {source.page ? <Button type="button" size="sm" variant="link" className="px-0" onClick={() => onEvidence({ documentId: source.documentId, page: source.page!, fieldId: source.fieldId, label: source.label }, returnId)}><Eye className="size-4" aria-hidden="true" />Source · page {source.page}</Button> : <span className="text-xs text-muted-foreground">Page unavailable</span>}
          </div>
          <p className="break-words text-sm text-foreground-secondary">{source.quote ? `“${source.quote}”` : "No direct source quote was returned."}</p>
        </div>)}
      </div> : <p className="text-sm text-foreground-secondary">No current source-page links are available for this result. Recorded values remain in Full computed evidence.</p>}
      <details className="min-w-0 text-sm">
        <summary className={cn("cursor-pointer py-2 font-medium text-foreground-secondary", FOCUS_RING_STYLES)}>Full computed evidence</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-subtle p-3 font-mono text-sm leading-6">{JSON.stringify(check.details, null, 2)}</pre>
      </details>
    </div>
  );
}
