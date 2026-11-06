import type { DocumentType } from "@/lib/ai/types";

export const PROMPT_VERSION = "2026.11-v1";
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
1. For every field, return an object with: value, unit, confidence, sourceQuote, pageNumber, reviewReason.
2. Use null when a value is absent in the document. Never infer, assume, or invent values.
3. Represent all numeric values (weights, amounts, quantities, prices, counts) as canonical decimal strings (e.g. "3120.00", "2400", "15.50") without commas. Put the unit (e.g. "kg", "pcs") or currency (e.g. "USD", "EUR") in the "unit" or "currency" field.
4. "confidence" must be a number from 0 to 1 and is a model estimate, not a calibrated statistical probability.
5. If a value is present but sourceQuote or pageNumber cannot be cited, provide an explicit "reviewReason" (e.g. "CALCULATED", "BLURRED_MARGIN", "STAMP_OBSTRUCTED").

Line Item Rules:
- Preserve printed line numbers when visible.
- Keep quantities, unit prices, and line totals as canonical decimal strings.
- Provide sourceQuote and pageNumber for each line item.
- Return lineItems as an empty array [] if none are visible.`;
}

export function extractionUserPrompt(documentType: DocumentType, pageNumbers: number[]) {
  return `Extract the ${documentType.replaceAll("_", " ").toLowerCase()} from the attached page images. Pages included: ${pageNumbers.join(", ")}. Return the JSON object now.`;
}
