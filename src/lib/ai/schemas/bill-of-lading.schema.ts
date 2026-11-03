import { z } from "zod";

import { baseDocumentSchema } from "@/lib/ai/schemas/common";

export const BillOfLadingExtractionSchema = z.object({
  exporter: baseDocumentSchema.exporter,
  importer: baseDocumentSchema.importer,
  documentNumber: baseDocumentSchema.documentNumber,
  issueDate: baseDocumentSchema.issueDate,
  packageCount: baseDocumentSchema.packageCount,
  netWeight: baseDocumentSchema.netWeight,
  grossWeight: baseDocumentSchema.grossWeight,
  containerNumber: baseDocumentSchema.containerNumber,
  vessel: baseDocumentSchema.vessel,
  portOfLoading: baseDocumentSchema.portOfLoading,
  portOfDischarge: baseDocumentSchema.portOfDischarge,
  lineItems: baseDocumentSchema.lineItems,
});

export type BillOfLadingExtraction = z.infer<typeof BillOfLadingExtractionSchema>;
