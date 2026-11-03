import type { DocumentType } from "@/lib/ai/types";

const fieldsByDocumentType: Record<DocumentType, string[]> = {
  INVOICE: [
    "exporter",
    "importer",
    "documentNumber",
    "issueDate",
    "currency",
    "incoterm",
    "invoiceTotal",
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
  return `You extract customs-document data from page images. Document type: ${documentType}.

Return only one valid JSON object. Do not use Markdown fences. Extract only fields applicable to this document type: ${fieldsByDocumentType[documentType].join(", ")}.

For every scalar field, return an object with value, unit, confidence, sourceQuote, and pageNumber. Use null when a value is absent. Never infer or invent a value. confidence must be a number from 0 to 1 and is a model estimate, not a calibrated probability. For lineItems, preserve the printed line number when visible, use a stable description, and include sourceQuote and pageNumber. Keep quantities, weights, prices and totals as strings so decimal precision is not lost.

The page images are labelled with their page number in the user message. Use the page containing the evidence. If a field is not applicable, omit it. Keep lineItems as an empty array when none are visible.`;
}

export function extractionUserPrompt(documentType: DocumentType, pageNumbers: number[]) {
  return `Extract the ${documentType.replaceAll("_", " ").toLowerCase()} from the attached page images. Pages included: ${pageNumbers.join(", ")}. Return the JSON object now.`;
}
