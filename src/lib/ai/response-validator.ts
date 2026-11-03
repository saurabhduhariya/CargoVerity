import { BillOfLadingExtractionSchema } from "@/lib/ai/schemas/bill-of-lading.schema";
import { InvoiceExtractionSchema } from "@/lib/ai/schemas/invoice.schema";
import { PackingListExtractionSchema } from "@/lib/ai/schemas/packing-list.schema";
import type { DocumentType, ExtractionResult } from "@/lib/ai/types";

const schemas = {
  INVOICE: InvoiceExtractionSchema,
  PACKING_LIST: PackingListExtractionSchema,
  BILL_OF_LADING: BillOfLadingExtractionSchema,
} as const;

const fieldKeysByDocumentType: Record<DocumentType, string[]> = {
  INVOICE: [
    "exporter",
    "importer",
    "documentNumber",
    "issueDate",
    "currency",
    "incoterm",
    "invoiceTotal",
  ],
  PACKING_LIST: [
    "exporter",
    "importer",
    "documentNumber",
    "issueDate",
    "packageCount",
    "netWeight",
    "grossWeight",
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
  ],
};

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function normalizeLineItem(item: unknown) {
  if (!isJsonRecord(item)) return item;

  const {
    unit,
    quantity_unit: quantityUnitAlias,
    hsn_code: hsnCodeAlias,
    unit_price: unitPriceAlias,
    line_total: lineTotalAlias,
    source_quote: sourceQuoteAlias,
    page_number: pageNumberAlias,
    line_number: lineNumberAlias,
    ...canonicalItem
  } = item;

  return {
    ...canonicalItem,
    lineNumber: numericValue(canonicalItem.lineNumber ?? lineNumberAlias),
    hsnCode: canonicalItem.hsnCode ?? hsnCodeAlias,
    quantityUnit: canonicalItem.quantityUnit ?? unit ?? quantityUnitAlias,
    unitPrice: canonicalItem.unitPrice ?? unitPriceAlias,
    lineTotal: canonicalItem.lineTotal ?? lineTotalAlias,
    sourceQuote: canonicalItem.sourceQuote ?? sourceQuoteAlias,
    pageNumber: numericValue(canonicalItem.pageNumber ?? pageNumberAlias),
    confidence: numericValue(canonicalItem.confidence),
  };
}

function normalizeResponsePayload(payload: unknown) {
  if (!isJsonRecord(payload) || !Array.isArray(payload.lineItems)) return payload;

  return {
    ...payload,
    lineItems: payload.lineItems.map(normalizeLineItem),
  };
}

function parseJsonContent(content: string) {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    throw new Error("The AI provider returned invalid JSON.");
  }
}

function textValue(value: string | number | null | undefined) {
  return value === null || value === undefined ? null : String(value);
}

function normalizeField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    value?: string | number | null;
    unit?: string | null;
    confidence?: number | null;
    sourceQuote?: string | null;
    pageNumber?: number | null;
  };

  return {
    value: textValue(candidate.value),
    unit: candidate.unit ?? null,
    modelConfidence: candidate.confidence ?? null,
    sourceQuote: candidate.sourceQuote ?? null,
    pageNumber: candidate.pageNumber ?? null,
    reviewStatus: "PENDING" as const,
  };
}

export function validateAndNormalizeResponse(input: {
  documentType: DocumentType;
  content: string;
  provider: "groq" | "openrouter";
  model: string;
}): ExtractionResult {
  const parsed = normalizeResponsePayload(parseJsonContent(input.content));
  const schema = schemas[input.documentType];
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`AI response failed ${input.documentType} schema validation.`);
  }

  const payload = result.data as Record<string, unknown>;
  const fields = fieldKeysByDocumentType[input.documentType].flatMap((fieldKey) => {
    const field = normalizeField(payload[fieldKey]);
    return field ? [{ fieldKey, ...field }] : [];
  });

  const lineItems = Array.isArray(payload.lineItems)
    ? payload.lineItems.map((item, index) => {
        const line = item as Record<string, unknown>;
        return {
          lineNumber:
            typeof line.lineNumber === "number" ? line.lineNumber : index + 1,
          description: typeof line.description === "string" ? line.description : null,
          hsnCode: typeof line.hsnCode === "string" ? line.hsnCode : null,
          quantity: textValue(line.quantity as string | number | null | undefined),
          quantityUnit:
            typeof line.quantityUnit === "string" ? line.quantityUnit : null,
          unitPrice: textValue(line.unitPrice as string | number | null | undefined),
          currency: typeof line.currency === "string" ? line.currency : null,
          lineTotal: textValue(line.lineTotal as string | number | null | undefined),
          modelConfidence:
            typeof line.confidence === "number" ? line.confidence : null,
          sourceQuote:
            typeof line.sourceQuote === "string" ? line.sourceQuote : null,
          pageNumber:
            typeof line.pageNumber === "number" ? line.pageNumber : null,
        };
      })
    : [];

  const warnings = fields.flatMap((field) =>
    field.modelConfidence !== null && field.modelConfidence < 0.85
      ? [`Low model confidence for ${field.fieldKey}.`]
      : field.value !== null && !field.sourceQuote
        ? [`Missing source evidence for ${field.fieldKey}.`]
        : [],
  );

  return {
    documentType: input.documentType,
    provider: input.provider,
    model: input.model,
    fields,
    lineItems,
    warnings,
  };
}

export function normalizeProviderError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown provider error.";
}
