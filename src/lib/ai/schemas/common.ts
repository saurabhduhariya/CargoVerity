import { z } from "zod";

const scalar = z.union([z.string(), z.number()]).nullable().optional();

export const extractedFieldSchema = z
  .object({
    value: scalar,
    unit: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    sourceQuote: z.string().nullable().optional(),
    pageNumber: z.number().int().positive().nullable().optional(),
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
  })
  .strict();

export const baseDocumentSchema = {
  exporter: extractedFieldSchema.optional(),
  importer: extractedFieldSchema.optional(),
  documentNumber: extractedFieldSchema.optional(),
  issueDate: extractedFieldSchema.optional(),
  currency: extractedFieldSchema.optional(),
  incoterm: extractedFieldSchema.optional(),
  invoiceTotal: extractedFieldSchema.optional(),
  packageCount: extractedFieldSchema.optional(),
  netWeight: extractedFieldSchema.optional(),
  grossWeight: extractedFieldSchema.optional(),
  containerNumber: extractedFieldSchema.optional(),
  vessel: extractedFieldSchema.optional(),
  portOfLoading: extractedFieldSchema.optional(),
  portOfDischarge: extractedFieldSchema.optional(),
  lineItems: z.array(lineItemSchema).default([]),
};
