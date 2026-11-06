import { z } from "zod";

import {
  ExtractedValueSchema,
  commonDocumentHeaderSchema,
  lineItemSchema,
} from "@/lib/ai/schemas/common";

/**
 * Week 3 Step 1: Bill of Lading Extraction Schema
 * Tailored to bills of lading: carrier, vessel, ports, container numbers, and transport weights.
 */
export const BillOfLadingExtractionSchema = z
  .object({
    ...commonDocumentHeaderSchema,
    exporter: ExtractedValueSchema.optional(),
    importer: ExtractedValueSchema.optional(),
    documentNumber: ExtractedValueSchema.optional(),
    issueDate: ExtractedValueSchema.optional(),
    packageCount: ExtractedValueSchema.optional(),
    netWeight: ExtractedValueSchema.optional(),
    grossWeight: ExtractedValueSchema.optional(),
    containerNumber: ExtractedValueSchema.optional(),
    vessel: ExtractedValueSchema.optional(),
    portOfLoading: ExtractedValueSchema.optional(),
    portOfDischarge: ExtractedValueSchema.optional(),
    lineItems: z.array(lineItemSchema).default([]),
  })
  .strict();

export type BillOfLadingExtraction = z.infer<typeof BillOfLadingExtractionSchema>;
