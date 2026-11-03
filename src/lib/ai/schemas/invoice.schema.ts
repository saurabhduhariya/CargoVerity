import { z } from "zod";

import { baseDocumentSchema } from "@/lib/ai/schemas/common";

export const InvoiceExtractionSchema = z.object({
  ...baseDocumentSchema,
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
