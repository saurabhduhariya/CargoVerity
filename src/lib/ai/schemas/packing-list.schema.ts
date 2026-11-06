import { z } from "zod";

import {
  ExtractedValueSchema,
  commonDocumentHeaderSchema,
  lineItemSchema,
} from "@/lib/ai/schemas/common";

/**
 * Week 3 Step 1: Packing List Extraction Schema
 * Tailored to packing lists: package counts, weights, item quantities, and breakdown.
 */
export const PackingListExtractionSchema = z
  .object({
    ...commonDocumentHeaderSchema,
    exporter: ExtractedValueSchema.optional(),
    importer: ExtractedValueSchema.optional(),
    documentNumber: ExtractedValueSchema.optional(),
    issueDate: ExtractedValueSchema.optional(),
    packageCount: ExtractedValueSchema.optional(),
    netWeight: ExtractedValueSchema.optional(),
    grossWeight: ExtractedValueSchema.optional(),
    lineItems: z.array(lineItemSchema).default([]),
  })
  .strict();

export type PackingListExtraction = z.infer<typeof PackingListExtractionSchema>;
