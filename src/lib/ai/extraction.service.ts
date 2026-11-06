import "server-only";

import { getEnv } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { createAIProvider } from "@/lib/ai/provider-factory";
import type {
  AIProvider,
  ExtractionInput,
  ExtractionResult,
  NormalizedField,
  NormalizedLineItem,
} from "@/lib/ai/types";

function chooseField(current: NormalizedField | undefined, next: NormalizedField) {
  if (!current || current.value === null) return next;
  if (next.value === null) return current;
  if ((next.modelConfidence ?? 0) > (current.modelConfidence ?? 0)) return next;
  return current;
}

function lineItemKey(item: NormalizedLineItem) {
  return [
    item.description?.trim().toLowerCase() ?? "",
    item.hsnCode ?? "",
    item.quantity ?? "",
    item.lineTotal ?? "",
  ].join("|");
}

function mergeResults(results: ExtractionResult[]): ExtractionResult {
  if (results.length === 0) {
    throw new ProviderError("No extraction results to merge.", "INVALID_RESPONSE");
  }

  const first = results[0];
  const fields = new Map<string, NormalizedField>();
  const lineItems = new Map<string, NormalizedLineItem>();

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let imageCount = 0;
  let requestCount = 0;
  let totalLatencyMs = 0;

  for (const result of results) {
    for (const field of result.fields) {
      fields.set(field.fieldKey, chooseField(fields.get(field.fieldKey), field));
    }
    for (const line of result.lineItems) {
      const key = lineItemKey(line);
      const existing = lineItems.get(key);
      if (!existing || (line.modelConfidence ?? 0) > (existing.modelConfidence ?? 0)) {
        lineItems.set(key, line);
      }
    }
    if (result.usage) {
      promptTokens += result.usage.promptTokens ?? 0;
      completionTokens += result.usage.completionTokens ?? 0;
      totalTokens += result.usage.totalTokens ?? 0;
      imageCount += result.usage.imageCount ?? 0;
      requestCount += result.usage.requestCount ?? 1;
    }
    if (result.providerMetadata?.latencyMs) {
      totalLatencyMs += result.providerMetadata.latencyMs;
    }
  }

  const allPages = results.flatMap((r) => r.pageReadability ?? []);
  const detectedType = results.find((r) => r.detectedType !== null)?.detectedType ?? null;
  const typeMismatch = results.some((r) => r.typeMismatch);

  return {
    ...first,
    detectedType,
    typeMismatch,
    pageReadability: allPages,
    fields: [...fields.values()],
    lineItems: [...lineItems.values()].sort((a, b) => a.lineNumber - b.lineNumber),
    usage: {
      promptTokens: promptTokens > 0 ? promptTokens : undefined,
      completionTokens: completionTokens > 0 ? completionTokens : undefined,
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
      imageCount: imageCount > 0 ? imageCount : allPages.length,
      requestCount: requestCount > 0 ? requestCount : results.length,
    },
    providerMetadata: first.providerMetadata
      ? {
          ...first.providerMetadata,
          latencyMs: totalLatencyMs > 0 ? totalLatencyMs : first.providerMetadata.latencyMs,
        }
      : undefined,
    warnings: [...new Set(results.flatMap((result) => result.warnings))],
  };
}

async function withRetry(provider: AIProvider, input: ExtractionInput) {
  const maxRetries = Math.min(input.modelConfig?.maxRetries ?? getEnv().MAX_AI_RETRIES, 1);
  let attempt = 0;

  while (true) {
    try {
      return await provider.extractDocument(input);
    } catch (error) {
      const retryable =
        error instanceof ProviderError &&
        ["RATE_LIMIT", "TIMEOUT", "UNAVAILABLE"].includes(error.code);

      if (!retryable || attempt >= maxRetries) throw error;

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export class ExtractionService {
  constructor(private readonly provider: AIProvider = createAIProvider()) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const maxImages = Math.min(getEnv().MAX_AI_IMAGES_PER_REQUEST, 3);

    if (!input.pages || input.pages.length === 0) {
      throw new ProviderError("At least one rendered page is required.", "REQUEST_FAILED");
    }

    const batches: ExtractionInput[] = [];
    for (let index = 0; index < input.pages.length; index += maxImages) {
      batches.push({
        ...input,
        pages: input.pages.slice(index, index + maxImages),
      });
    }

    const results: ExtractionResult[] = [];
    for (const batch of batches) {
      results.push(await withRetry(this.provider, batch));
    }

    return mergeResults(results);
  }
}
