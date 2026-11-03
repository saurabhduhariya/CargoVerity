import type { DocumentType, ExtractionInput, ExtractionResult } from "@/lib/ai/types";

export type AIProviderName = "groq" | "openrouter";

export interface ProviderClient {
  readonly name: AIProviderName;
  readonly model: string;
  extractDocument(input: ExtractionInput): Promise<ExtractionResult>;
}

export type ProviderDocumentType = DocumentType;
