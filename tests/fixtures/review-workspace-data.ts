import type { ExportPreviewData, ExportRecordSummary } from "../../src/lib/export/preview";
import type { ReviewWorkspaceDocument, ReviewWorkspaceField, ReviewWorkspaceInitialData } from "../../src/features/review/review-types";

/** In-memory component fixtures only; never writes to a shipment or private storage. */
export function makeReviewField(patch: Partial<ReviewWorkspaceField> = {}): ReviewWorkspaceField {
  return {
    id: "invoice-weight", fieldKey: "grossWeight", modelValue: "3120", currentValue: "3120",
    unit: "kg", modelConfidence: 0.72, sourceQuote: "Gross weight: 3120 kg", pageNumber: 2,
    reviewStatus: "REQUIRES_REVIEW", reviewReason: "LOW_MODEL_CONFIDENCE", ...patch,
  };
}

export function makeReviewData(): ReviewWorkspaceInitialData {
  const invoice: ReviewWorkspaceDocument = {
    id: "invoice", docType: "INVOICE", originalFileName: "synthetic-review-invoice.pdf",
    mimeType: "application/pdf", documentVersion: 1, pageCount: 2, signedUrl: "/fixture/invoice.pdf",
    extractionStatus: "REVIEW_REQUIRED", latestRunId: "extraction-invoice", extractionProvider: "synthetic-review-qa",
    pages: [1, 2].map((pageNumber) => ({ id: `invoice-page-${pageNumber}`, pageNumber, isReadable: true, manualEntryRequired: false, reviewNote: null })),
    manualFieldOptions: [{ fieldKey: "grossWeight", required: false, isNumeric: true }, { fieldKey: "importer", required: true }],
    fields: [
      makeReviewField(),
      makeReviewField({ id: "invoice-exporter", fieldKey: "exporter", modelValue: "Synthetic Review QA Supplier", currentValue: "Synthetic Review QA Supplier", unit: null, modelConfidence: 0.98, pageNumber: 1, sourceQuote: "Exporter: Synthetic Review QA Supplier", reviewStatus: "PENDING", reviewReason: null }),
      makeReviewField({ id: "invoice-importer", fieldKey: "importer", modelValue: null, currentValue: null, unit: null, modelConfidence: null, pageNumber: null, sourceQuote: null, reviewReason: "REQUIRED_FIELD_MISSING" }),
    ],
    lineItems: [1, 2].map((lineNumber) => ({ id: `invoice-line-${lineNumber}`, lineNumber, description: "LED panel light 40W", hsnCode: "9405.10", quantity: "1200", quantityUnit: "pcs", unitPrice: "6.80", lineTotal: "8160.00", currency: "USD", sourceQuote: `${lineNumber}. LED panel light 40W | 1200 pcs`, pageNumber: 2 })),
  };
  const packing: ReviewWorkspaceDocument = {
    ...invoice, id: "packing", docType: "PACKING_LIST", originalFileName: "synthetic-review-packing-list.pdf",
    signedUrl: "/fixture/packing.pdf", extractionStatus: "EXTRACTED", latestRunId: "extraction-packing",
    pages: [1, 2].map((pageNumber) => ({ id: `packing-page-${pageNumber}`, pageNumber, isReadable: true, manualEntryRequired: false, reviewNote: null })),
    fields: [makeReviewField({ id: "packing-weight", modelValue: "3165", currentValue: "3165", modelConfidence: 0.98, sourceQuote: "Gross weight: 3165 kg", reviewStatus: "CONFIRMED", reviewReason: null })],
    lineItems: [1, 2].map((lineNumber) => ({ id: `packing-line-${lineNumber}`, lineNumber, description: "LED panel light 40W", quantity: "1200", quantityUnit: "pcs", lineTotal: null, currency: null, sourceQuote: `${lineNumber}. LED panel light 40W | 1200 pcs`, pageNumber: 2 })),
  };
  return {
    shipment: { id: "qa-shipment", reference: "QA-REVIEW-UNIT-01", status: "NEEDS_REVIEW", currentRevision: 6 },
    currentUserRole: "EXECUTIVE", documents: [invoice, packing],
    latestCheckRun: { id: "check-run-6", revision: 6, createdAt: "2026-11-07T17:37:44.123Z" },
    crossChecksStale: false, lineMappings: [],
    crossChecks: [
      { id: "weight-check", runId: "check-run-6", ruleKey: "gross_weight_comparison", status: "MISMATCH", severity: "BLOCKING", details: {
        message: "Available documents differ by 45.000 kg; cause is unknown.", unit: "kg", differenceKg: "45.000", toleranceKg: "15.825",
        values: [
          { documentType: "INVOICE", fieldId: "invoice-weight", rawValue: "3120", rawUnit: "kg", normalizedKg: "3120.000", sourceQuote: "Gross weight: 3120 kg" },
          { documentType: "PACKING_LIST", fieldId: "packing-weight", rawValue: "3165", rawUnit: "kg", normalizedKg: "3165.000", sourceQuote: "Gross weight: 3165 kg" },
        ],
      } },
      { id: "quantity-check", runId: "check-run-6", ruleKey: "invoice_quantity_vs_packing_list", status: "INCOMPLETE", severity: "BLOCKING", details: {
        message: "Ambiguous duplicate goods lines require manual mapping.", matchedPairs: [], staleManualMappings: [],
        unmatchedLines: [invoice, packing].flatMap((doc) => doc.lineItems.map((line) => ({ documentType: doc.docType, lineId: line.id, lineNumber: line.lineNumber, description: line.description, quantity: line.quantity, unit: line.quantityUnit, reason: "AMBIGUOUS_DUPLICATE_CANDIDATES" }))),
      } },
    ],
    auditHistory: [{ id: "audit-6", action: "PAGE_MARKED_FOR_MANUAL_ENTRY", entityType: "DocumentPage", actorEmail: "reviewer@fixture.test", actorRole: "EXECUTIVE", metadata: { revision: 6 }, createdAt: "2026-11-07T17:52:36.000Z" }],
  };
}

export function makeExportRecord(patch: Partial<ExportRecordSummary> = {}): ExportRecordSummary {
  return { id: "server-export-1", profileId: "demo-v1", profileVersion: "1", revision: 6, createdAt: "2026-11-07T18:00:00.000Z", exportedBy: "manager@fixture.test", checksumSha256: "a".repeat(64), fileName: "QA-REVIEW-UNIT-01-demo-v1-rev6.csv", rowCount: 2, ...patch };
}

export function makeExportPreview(patch: Partial<ExportPreviewData> = {}): ExportPreviewData {
  return {
    ready: true, allowed: true, blockers: [], profileId: "demo-v1", profileVersion: "1",
    assumptionLabel: "Synthetic QA profile only; not for customs filing.", currentRevision: 6,
    shipmentStatus: "APPROVED", approvedRevision: 6, approvedAt: "2026-11-07T17:55:00.000Z",
    approvedBy: "manager@fixture.test", recentExport: null, fileName: "QA-REVIEW-UNIT-01-demo-v1-rev6.csv",
    checksumSha256: "a".repeat(64), headers: ["Description", "Quantity"], rows: [["LED panel light 40W", "1200"], ["LED panel light 40W", "1200"]], rowCount: 2,
    ...patch,
  };
}
