import { z } from "zod";
import { documentTypes } from "@/lib/ai/types";

export const CANONICAL_DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Normalizes numeric inputs into canonical decimal strings (e.g. "3120.00", "2400", "0.50")
 * while stripping formatting commas and preventing floating point precision loss.
 */
export function toCanonicalDecimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Strip thousands grouping commas (e.g., 3,120.50 -> 3120.50)
    const cleaned = trimmed.replace(/,/g, "");
    if (CANONICAL_DECIMAL_REGEX.test(cleaned)) {
      return cleaned;
    }
    return trimmed;
  }
  return null;
}

const scalar = z.union([z.string(), z.number()]).nullable().optional();

/**
 * Week 3 Step 1: Common ExtractedValueSchema
 * Represents a single extracted field with provenance, confidence estimate,
 * source quote, page evidence, and optional explicit reviewReason when null or missing evidence.
 */
export const ExtractedValueSchema = z
  .object({
    value: scalar,
    unit: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    sourceQuote: z.string().nullable().optional(),
    pageNumber: z.number().int().positive().nullable().optional(),
    reviewReason: z.string().nullable().optional(),
  })
  .strict();

export const extractedFieldSchema = ExtractedValueSchema;

export const PageReadabilitySchema = z
  .object({
    pageNumber: z.number().int().positive(),
    isReadable: z.boolean().default(true),
    reviewNote: z.string().nullable().optional(),
  })
  .strict();

export const lineItemSchema = z
  .object({
    lineNumber: z.number().int().positive().optional(),
    description: z.string().nullable().optional(),
    hsnCode: z.string().nullable().optional(),
    quantity: scalar,
    quantityUnit: z.string().nullable().optional(),
    unitPrice: scalar,
    currency: z.string().nullable().optional(),
    lineTotal: scalar,
    confidence: z.number().min(0).max(1).nullable().optional(),
    sourceQuote: z.string().nullable().optional(),
    pageNumber: z.number().int().positive().nullable().optional(),
    reviewReason: z.string().nullable().optional(),
  })
  .strict();

export const commonDocumentHeaderSchema = {
  detectedDocumentType: z.enum(documentTypes).nullable().optional(),
  pageReadability: z.array(PageReadabilitySchema).optional().default([]),
};

export const baseDocumentSchema = {
  ...commonDocumentHeaderSchema,
  exporter: ExtractedValueSchema.optional(),
  importer: ExtractedValueSchema.optional(),
  documentNumber: ExtractedValueSchema.optional(),
  issueDate: ExtractedValueSchema.optional(),
  currency: ExtractedValueSchema.optional(),
  incoterm: ExtractedValueSchema.optional(),
  invoiceTotal: ExtractedValueSchema.optional(),
  packageCount: ExtractedValueSchema.optional(),
  netWeight: ExtractedValueSchema.optional(),
  grossWeight: ExtractedValueSchema.optional(),
  containerNumber: ExtractedValueSchema.optional(),
  vessel: ExtractedValueSchema.optional(),
  portOfLoading: ExtractedValueSchema.optional(),
  portOfDischarge: ExtractedValueSchema.optional(),
  lineItems: z.array(lineItemSchema).default([]),
};
