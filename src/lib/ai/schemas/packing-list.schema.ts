import { z } from "zod";

import { baseDocumentSchema } from "@/lib/ai/schemas/common";

export const PackingListExtractionSchema = z.object({
  exporter: baseDocumentSchema.exporter,
  importer: baseDocumentSchema.importer,
  documentNumber: baseDocumentSchema.documentNumber,
  issueDate: baseDocumentSchema.issueDate,
  packageCount: baseDocumentSchema.packageCount,
  netWeight: baseDocumentSchema.netWeight,
  grossWeight: baseDocumentSchema.grossWeight,
  lineItems: baseDocumentSchema.lineItems,
});

export type PackingListExtraction = z.infer<typeof PackingListExtractionSchema>;
