import { z } from "zod";

import {
  ExtractedValueSchema,
  commonDocumentHeaderSchema,
  lineItemSchema,
} from "@/lib/ai/schemas/common";

/**
 * Week 3 Step 1: Commercial Invoice Extraction Schema
 * Explicit schema tailored to invoices: includes billing, total, currency, incoterm, line items, and optional weights/packages.
 */
export const InvoiceExtractionSchema = z
  .object({
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
    lineItems: z.array(lineItemSchema).default([]),
  })
  .strict();

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
