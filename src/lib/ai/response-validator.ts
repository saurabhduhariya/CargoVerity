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
  const parsed = parseJsonContent(input.content);
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
