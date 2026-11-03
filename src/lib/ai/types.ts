import type { z } from "zod";

export const documentTypes = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const;
export type DocumentType = (typeof documentTypes)[number];

export type PageImage = {
  pageNumber: number;
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png";
};

export type NormalizedField = {
  fieldKey: string;
  value: string | null;
  unit: string | null;
  modelConfidence: number | null;
  sourceQuote: string | null;
  pageNumber: number | null;
  reviewStatus: "PENDING";
};

export type NormalizedLineItem = {
  lineNumber: number;
  description: string | null;
  hsnCode: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  unitPrice: string | null;
  currency: string | null;
  lineTotal: string | null;
  modelConfidence: number | null;
  sourceQuote: string | null;
  pageNumber: number | null;
};

export type ExtractionResult = {
  documentType: DocumentType;
  provider: "groq" | "openrouter";
  model: string;
  fields: NormalizedField[];
  lineItems: NormalizedLineItem[];
  warnings: string[];
};

export type ExtractionInput = {
  documentType: DocumentType;
  pages: PageImage[];
};

export interface AIProvider {
  readonly name: "groq" | "openrouter";
  readonly model: string;
  extractDocument(input: ExtractionInput): Promise<ExtractionResult>;
}

export type ExtractionSchema = z.ZodType;
