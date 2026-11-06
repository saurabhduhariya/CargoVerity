import type { z } from "zod";

export const documentTypes = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const;
export type DocumentType = (typeof documentTypes)[number];

export type PageImage = {
  pageNumber: number;
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png";
};

export type PageReadability = {
  pageNumber: number;
  isReadable: boolean;
  reviewNote?: string | null;
};

export type NormalizedField = {
  fieldKey: string;
  value: string | null;
  unit: string | null;
  modelConfidence: number | null;
  sourceQuote: string | null;
  pageNumber: number | null;
  reviewStatus: "PENDING" | "CONFIRMED" | "CORRECTED" | "REQUIRES_REVIEW";
  reviewReason?: string | null;
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
  reviewReason?: string | null;
};

export type ExtractionUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  imageCount: number;
  requestCount: number;
};

export type ProviderMetadata = {
  provider: "groq" | "openrouter";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  latencyMs?: number;
  rawRequestId?: string;
};

export type StorageReference = {
  shipmentId: string;
  documentId: string;
  storageKey: string;
  version?: number;
};

export type ModelConfiguration = {
  provider: "groq" | "openrouter";
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
};

/**
 * Week 3 Step 1: Adapter input contract containing:
 * - documentType
 * - storageReference
 * - modelConfig
 * - idempotencyKey
 * - rendered page images
 * - promptVersion and schemaVersion
 */
export type ExtractionAdapterInput = {
  documentType: DocumentType;
  pages: PageImage[];
  storageReference?: StorageReference | string;
  modelConfig?: ModelConfiguration;
  idempotencyKey?: string;
  promptVersion?: string;
  schemaVersion?: string;
};

export type ExtractionInput = ExtractionAdapterInput;

/**
 * Week 3 Step 1: Adapter output contract containing:
 * - detectedType & typeMismatch
 * - pageReadability
 * - fields & lineItems
 * - usage & providerMetadata
 * - warnings
 */
export type ExtractionAdapterOutput = {
  documentType: DocumentType;
  detectedType?: DocumentType | null;
  typeMismatch?: boolean;
  pageReadability?: PageReadability[];
  provider: "groq" | "openrouter";
  model: string;
  fields: NormalizedField[];
  lineItems: NormalizedLineItem[];
  usage?: ExtractionUsage;
  providerMetadata?: ProviderMetadata;
  warnings: string[];
};

export type ExtractionResult = ExtractionAdapterOutput;

/**
 * Week 3 Step 1: AiDocumentExtractor interface contract
 */
export interface AiDocumentExtractor {
  readonly name: "groq" | "openrouter";
  readonly model: string;
  extractDocument(input: ExtractionAdapterInput): Promise<ExtractionAdapterOutput>;
}

export type AIProvider = AiDocumentExtractor;

export type ExtractionSchema = z.ZodType;
