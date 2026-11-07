import { BillOfLadingExtractionSchema } from "@/lib/ai/schemas/bill-of-lading.schema";
import { InvoiceExtractionSchema } from "@/lib/ai/schemas/invoice.schema";
import { PackingListExtractionSchema } from "@/lib/ai/schemas/packing-list.schema";
import { toCanonicalDecimalString, CANONICAL_DECIMAL_REGEX } from "@/lib/ai/schemas/common";
import { PROMPT_VERSION, SCHEMA_VERSION } from "@/lib/ai/extraction-prompts";
import type {
  DocumentType,
  ExtractionAdapterOutput,
  ExtractionUsage,
  NormalizedField,
  NormalizedLineItem,
  PageReadability,
} from "@/lib/ai/types";

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
    "packageCount",
    "netWeight",
    "grossWeight",
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

const numericFieldKeys = new Set([
  "invoiceTotal",
  "packageCount",
  "netWeight",
  "grossWeight",
  "quantity",
  "unitPrice",
  "lineTotal",
]);

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
    hsCode: hsCodeAlias,
    hsn_code: hsnCodeAlias,
    unit_price: unitPriceAlias,
    line_total: lineTotalAlias,
    source_quote: sourceQuoteAlias,
    page_number: pageNumberAlias,
    line_number: lineNumberAlias,
    review_reason: reviewReasonAlias,
    ...canonicalItem
  } = item;

  return {
    ...canonicalItem,
    lineNumber: numericValue(canonicalItem.lineNumber ?? lineNumberAlias),
    hsnCode: canonicalItem.hsnCode ?? hsCodeAlias ?? hsnCodeAlias,
    quantityUnit: canonicalItem.quantityUnit ?? unit ?? quantityUnitAlias,
    unitPrice: canonicalItem.unitPrice ?? unitPriceAlias,
    lineTotal: canonicalItem.lineTotal ?? lineTotalAlias,
    sourceQuote: canonicalItem.sourceQuote ?? sourceQuoteAlias,
    pageNumber: numericValue(canonicalItem.pageNumber ?? pageNumberAlias),
    confidence: numericValue(canonicalItem.confidence),
    reviewReason: canonicalItem.reviewReason ?? reviewReasonAlias,
  };
}

/**
 * Maps common key aliases vision models emit on field objects onto the canonical keys before
 * strict schema validation (snake_case evidence keys, and a field-level "currency" that belongs
 * in "unit"). Unknown keys are left in place so the strict schema still rejects them.
 */
function normalizeFieldObject(value: unknown) {
  if (!isJsonRecord(value)) return value;
  const {
    currency: currencyAlias,
    source_quote: sourceQuoteAlias,
    page_number: pageNumberAlias,
    review_reason: reviewReasonAlias,
    ...canonical
  } = value;

  const normalized: JsonRecord = { ...canonical };
  if (normalized.unit === undefined || normalized.unit === null) {
    if (typeof currencyAlias === "string") normalized.unit = currencyAlias;
  }
  if (normalized.sourceQuote === undefined && sourceQuoteAlias !== undefined) normalized.sourceQuote = sourceQuoteAlias;
  if (normalized.pageNumber === undefined && pageNumberAlias !== undefined) normalized.pageNumber = pageNumberAlias;
  if (normalized.reviewReason === undefined && reviewReasonAlias !== undefined) normalized.reviewReason = reviewReasonAlias;
  if (normalized.pageNumber !== undefined) normalized.pageNumber = numericValue(normalized.pageNumber);
  if (normalized.confidence !== undefined) normalized.confidence = numericValue(normalized.confidence);
  return normalized;
}

function normalizePageReadability(page: unknown) {
  if (!isJsonRecord(page)) return page;
  const { page_number: pageNumberAlias, review_note: reviewNoteAlias, ...canonical } = page;
  return {
    ...canonical,
    pageNumber: numericValue(canonical.pageNumber ?? pageNumberAlias),
    ...(canonical.reviewNote !== undefined || reviewNoteAlias !== undefined
      ? { reviewNote: canonical.reviewNote ?? reviewNoteAlias }
      : {}),
  };
}

function normalizeResponsePayload(payload: unknown) {
  if (!isJsonRecord(payload)) return payload;

  const normalized: JsonRecord = { ...payload };
  for (const key of Object.keys(normalized)) {
    if (key === "lineItems" || key === "pageReadability") continue;
    if (isJsonRecord(normalized[key])) normalized[key] = normalizeFieldObject(normalized[key]);
  }
  if (Array.isArray(normalized.lineItems)) {
    normalized.lineItems = normalized.lineItems.map(normalizeLineItem);
  }
  if (Array.isArray(normalized.pageReadability)) {
    normalized.pageReadability = normalized.pageReadability.map(normalizePageReadability);
  }
  return normalized;
}

export function parseJsonContent(content: string): unknown {
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

function normalizeField(
  fieldKey: string,
  value: unknown,
): Omit<NormalizedField, "fieldKey"> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    value?: string | number | null;
    unit?: string | null;
    confidence?: number | null;
    sourceQuote?: string | null;
    pageNumber?: number | null;
    reviewReason?: string | null;
  };

  const rawVal = candidate.value;
  let formattedValue: string | null = null;
  if (rawVal !== null && rawVal !== undefined) {
    if (numericFieldKeys.has(fieldKey)) {
      formattedValue = toCanonicalDecimalString(rawVal);
    } else {
      formattedValue = String(rawVal);
    }
  }

  return {
    value: formattedValue,
    unit: candidate.unit ?? null,
    modelConfidence: typeof candidate.confidence === "number" ? candidate.confidence : null,
    sourceQuote: candidate.sourceQuote ?? null,
    pageNumber: typeof candidate.pageNumber === "number" ? candidate.pageNumber : null,
    reviewReason: candidate.reviewReason ?? null,
    reviewStatus: "PENDING" as const,
  };
}

/**
 * Week 3 Step 1: Business validation after provider response parsing.
 * Validates canonical decimal representations, confidence bounds,
 * evidence completeness, and document type consistency.
 */
export function validateBusinessRules(
  output: ExtractionAdapterOutput,
  lowConfidenceThreshold = 0.85,
): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // 1. Document type mismatch check
  if (output.typeMismatch && output.detectedType) {
    warnings.push(
      `Document type mismatch: declared as ${output.documentType}, but document headers indicate ${output.detectedType}.`,
    );
  }

  // 2. Unreadable page checks
  for (const page of output.pageReadability ?? []) {
    if (!page.isReadable) {
      warnings.push(
        `Page ${page.pageNumber} reported unreadable${page.reviewNote ? `: ${page.reviewNote}` : ""}.`,
      );
    }
  }

  // 3. Field business validations
  for (const field of output.fields) {
    // Model confidence estimate threshold (LOW_CONFIDENCE_THRESHOLD)
    if (field.modelConfidence !== null && field.modelConfidence < lowConfidenceThreshold) {
      warnings.push(`Low model confidence for ${field.fieldKey}.`);
    }

    // Evidence validation: if value exists, require sourceQuote & pageNumber or reviewReason
    if (field.value !== null) {
      const hasQuote = field.sourceQuote && field.sourceQuote.trim().length > 0;
      const hasPage = typeof field.pageNumber === "number";
      if (!hasQuote || !hasPage) {
        if (!field.reviewReason) {
          warnings.push(`Missing source evidence for ${field.fieldKey}.`);
        }
      }

      // Canonical decimal validation for numeric fields
      if (numericFieldKeys.has(field.fieldKey) && field.value) {
        if (!CANONICAL_DECIMAL_REGEX.test(field.value)) {
          warnings.push(
            `Field ${field.fieldKey} has non-canonical numeric format: "${field.value}".`,
          );
        }
      }
    }
  }

  // 4. Line item business validations
  for (const item of output.lineItems) {
    if (item.modelConfidence !== null && item.modelConfidence < lowConfidenceThreshold) {
      warnings.push(`Low model confidence on line item ${item.lineNumber}.`);
    }
    if (item.quantity && !CANONICAL_DECIMAL_REGEX.test(item.quantity)) {
      warnings.push(
        `Line item ${item.lineNumber} quantity has non-canonical decimal format: "${item.quantity}".`,
      );
    }
    if (item.unitPrice && !CANONICAL_DECIMAL_REGEX.test(item.unitPrice)) {
      warnings.push(
        `Line item ${item.lineNumber} unit price has non-canonical decimal format: "${item.unitPrice}".`,
      );
    }
    if (item.lineTotal && !CANONICAL_DECIMAL_REGEX.test(item.lineTotal)) {
      warnings.push(
        `Line item ${item.lineNumber} line total has non-canonical decimal format: "${item.lineTotal}".`,
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

export function validateAndNormalizeResponse(input: {
  documentType: DocumentType;
  content: string;
  provider: "groq" | "openrouter";
  model: string;
  latencyMs?: number;
  usage?: ExtractionUsage;
  rawRequestId?: string;
  promptVersion?: string;
  schemaVersion?: string;
  /** Page numbers actually sent in this request; evidence citing other pages is discarded. */
  pageNumbers?: number[];
  lowConfidenceThreshold?: number;
}): ExtractionAdapterOutput {
  const parsed = normalizeResponsePayload(parseJsonContent(input.content));
  const schema = schemas[input.documentType];
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`AI response failed ${input.documentType} schema validation.`);
  }

  const payload = result.data as Record<string, unknown>;

  // Detect document type and check for mismatch
  const detectedType =
    typeof payload.detectedDocumentType === "string" &&
    ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"].includes(payload.detectedDocumentType)
      ? (payload.detectedDocumentType as DocumentType)
      : null;

  const typeMismatch = detectedType !== null && detectedType !== input.documentType;

  // Extract page readability metadata
  const pageReadability: PageReadability[] = Array.isArray(payload.pageReadability)
    ? payload.pageReadability.map((p) => ({
        pageNumber: Number(p.pageNumber),
        isReadable: Boolean(p.isReadable),
        reviewNote: typeof p.reviewNote === "string" ? p.reviewNote : null,
      }))
    : [];

  // Extract and normalize fields
  const fields: NormalizedField[] = fieldKeysByDocumentType[input.documentType].flatMap(
    (fieldKey) => {
      const field = normalizeField(fieldKey, payload[fieldKey]);
      return field ? [{ fieldKey, ...field }] : [];
    },
  );

  // Extract and normalize line items
  const lineItems: NormalizedLineItem[] = Array.isArray(payload.lineItems)
    ? payload.lineItems.map((item, index) => {
        const line = item as Record<string, unknown>;
        return {
          lineNumber:
            typeof line.lineNumber === "number" ? line.lineNumber : index + 1,
          description: typeof line.description === "string" ? line.description : null,
          hsnCode: typeof line.hsnCode === "string" ? line.hsnCode : null,
          quantity: toCanonicalDecimalString(line.quantity),
          quantityUnit:
            typeof line.quantityUnit === "string" ? line.quantityUnit : null,
          unitPrice: toCanonicalDecimalString(line.unitPrice),
          currency: typeof line.currency === "string" ? line.currency : null,
          lineTotal: toCanonicalDecimalString(line.lineTotal),
          modelConfidence:
            typeof line.confidence === "number" ? line.confidence : null,
          sourceQuote:
            typeof line.sourceQuote === "string" ? line.sourceQuote : null,
          pageNumber:
            typeof line.pageNumber === "number" ? line.pageNumber : null,
          reviewReason:
            typeof line.reviewReason === "string" ? line.reviewReason : null,
        };
      })
    : [];

  const rawOutput: ExtractionAdapterOutput = {
    documentType: input.documentType,
    detectedType,
    typeMismatch,
    pageReadability,
    provider: input.provider,
    model: input.model,
    fields,
    lineItems,
    usage: input.usage,
    providerMetadata: {
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion ?? PROMPT_VERSION,
      schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
      latencyMs: input.latencyMs,
      rawRequestId: input.rawRequestId,
    },
    warnings: [],
  };

  const evidenceWarnings = input.pageNumbers ? boundEvidenceToPages(rawOutput, input.pageNumbers) : [];

  const businessValidation = validateBusinessRules(rawOutput, input.lowConfidenceThreshold);
  rawOutput.warnings = [...evidenceWarnings, ...businessValidation.warnings];

  return rawOutput;
}

/**
 * A model can only cite pages it was shown. Page references outside the batch are removed (so
 * the review policy flags the value for evidence review), and readability reports for pages that
 * were not sent are dropped instead of being written onto the wrong page.
 */
function boundEvidenceToPages(output: ExtractionAdapterOutput, pageNumbers: number[]) {
  const allowed = new Set(pageNumbers);
  const warnings: string[] = [];

  for (const field of output.fields) {
    if (field.pageNumber !== null && !allowed.has(field.pageNumber)) {
      warnings.push(`Field ${field.fieldKey} cited page ${field.pageNumber}, which was not provided.`);
      field.pageNumber = null;
      field.reviewReason = field.reviewReason ?? "OUTSIDE_PROVIDED_PAGES";
    }
  }
  for (const item of output.lineItems) {
    if (item.pageNumber !== null && !allowed.has(item.pageNumber)) {
      warnings.push(`Line item ${item.lineNumber} cited page ${item.pageNumber}, which was not provided.`);
      item.pageNumber = null;
      item.reviewReason = item.reviewReason ?? "OUTSIDE_PROVIDED_PAGES";
    }
  }

  const seen = new Set<number>();
  output.pageReadability = (output.pageReadability ?? []).filter((page) => {
    if (!allowed.has(page.pageNumber) || seen.has(page.pageNumber)) return false;
    seen.add(page.pageNumber);
    return true;
  });

  return warnings;
}

/** Safe message for an extraction failure: only our own fixed provider messages pass through. */
export function normalizeProviderError(error: unknown) {
  if (error && typeof error === "object" && "name" in error && error.name === "ProviderError" && error instanceof Error) {
    return error.message;
  }
  return "Extraction failed.";
}
