import { EVIDENCE_REVIEW_REASONS } from "@/lib/ai/schemas/common";
import type { DocumentType } from "@/lib/ai/types";

/**
 * Bump PROMPT_VERSION whenever the prompt text changes: it is stored on every ExtractionRun and
 * is part of the extraction idempotency key, so results from different prompts never mix.
 * v2 (2026-11-07): field objects carry the currency in "unit" (the strict schema has no
 * field-level "currency" key), lists the evidence reviewReason codes, and limits page numbers
 * to the pages actually sent. The response JSON shape (SCHEMA_VERSION) is unchanged.
 */
export const PROMPT_VERSION = "2026.11-v2";
export const SCHEMA_VERSION = "2026.11-v1";

const fieldsByDocumentType: Record<DocumentType, string[]> = {
  INVOICE: [
    "exporter",
    "importer",
    "documentNumber",
    "issueDate",
    "currency",
    "incoterm",
    "invoiceTotal",
    "packageCount",
    "netWeight",
    "grossWeight",
    "lineItems",
  ],
  PACKING_LIST: [
    "exporter",
    "importer",
    "documentNumber",
    "issueDate",
    "packageCount",
    "netWeight",
    "grossWeight",
    "lineItems",
  ],
  BILL_OF_LADING: [
    "exporter",
    "importer",
    "documentNumber",
    "issueDate",
    "packageCount",
    "netWeight",
    "grossWeight",
    "containerNumber",
    "vessel",
    "portOfLoading",
    "portOfDischarge",
    "lineItems",
  ],
};

export function extractionSystemPrompt(documentType: DocumentType) {
  return `You extract customs-document data from page images. [Prompt Version: ${PROMPT_VERSION}, Schema Version: ${SCHEMA_VERSION}]
Expected document type: ${documentType}.

Return only one valid JSON object. Do not use Markdown fences.
Extract only fields applicable to this document type: ${fieldsByDocumentType[documentType].join(", ")}.

Header Metadata:
- "detectedDocumentType": State the actual detected type from document headers ("INVOICE", "PACKING_LIST", "BILL_OF_LADING").
- "pageReadability": For each page provided, report an object with pageNumber, isReadable (boolean), and reviewNote (if unreadable or blurred).

Field Rules:
1. For every field, return an object with exactly these keys: value, unit, confidence, sourceQuote, pageNumber, reviewReason.
2. Use null when a value is absent in the document. Never infer, assume, calculate from other documents, or invent values.
3. Represent all numeric values (weights, amounts, quantities, prices, counts) as canonical decimal strings (e.g. "3120.00", "2400", "15.50") without commas, spaces or symbols. Put the unit (e.g. "kg", "pcs") or the currency code (e.g. "USD", "EUR") in "unit".
4. "confidence" must be a number from 0 to 1 and is a model estimate, not a calibrated statistical probability.
5. "sourceQuote" is the exact text printed on the page; "pageNumber" is one of the page numbers listed in the request.
6. If a value is present but sourceQuote or pageNumber cannot be cited, set them to null and give "reviewReason" as one of: ${EVIDENCE_REVIEW_REASONS.join(", ")}. Otherwise set reviewReason to null.

Line Item Rules:
- Each line item has: lineNumber, description, hsnCode, quantity, quantityUnit, unitPrice, currency, lineTotal, confidence, sourceQuote, pageNumber, reviewReason.
- Preserve printed line numbers when visible.
- Keep quantities, unit prices, and line totals as canonical decimal strings.
- Provide sourceQuote and pageNumber for each line item.
- Return lineItems as an empty array [] if none are visible.`;
}

export function extractionUserPrompt(documentType: DocumentType, pageNumbers: number[]) {
  return `Extract the ${documentType.replaceAll("_", " ").toLowerCase()} from the attached page images. Pages included: ${pageNumbers.join(", ")}. Return the JSON object now.`;
}
