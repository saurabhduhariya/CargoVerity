import "server-only";

import Groq from "groq-sdk";

import { getEnv, requireAIConfig } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import {
  extractionSystemPrompt,
  extractionUserPrompt,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from "@/lib/ai/extraction-prompts";
import { validateAndNormalizeResponse } from "@/lib/ai/response-validator";
import type { AIProvider, ExtractionInput, ExtractionResult, ExtractionUsage } from "@/lib/ai/types";
import type { ChatCompletionContentPart } from "groq-sdk/resources/chat/completions";

function toDataUrl(page: ExtractionInput["pages"][number]) {
  return `data:${page.mimeType};base64,${page.imageBase64}`;
}

export function createGroqVisionContent(input: ExtractionInput): ChatCompletionContentPart[] {
  return [
    {
      type: "text",
      text: extractionUserPrompt(
        input.documentType,
        input.pages.map((page) => page.pageNumber),
      ),
    },
    ...input.pages.map((page) => ({
      type: "image_url" as const,
      image_url: { url: toDataUrl(page), detail: "auto" as const },
    })),
  ];
}

function providerError(error: unknown): ProviderError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : undefined;

  if (status === 401 || status === 403) {
    return new ProviderError("Groq authentication failed. Check server credentials.", "AUTHENTICATION", status);
  }
  if (status === 402) {
    return new ProviderError("Groq rejected the request because the account quota is exhausted.", "QUOTA_EXCEEDED", status);
  }
  if (status === 429) {
    return new ProviderError("Groq rate limit reached. Please retry in a few moments.", "RATE_LIMIT", status);
  }
  if (
    status === 408 ||
    status === 504 ||
    (error instanceof Error && /timeout|timed out|abort/i.test(error.message))
  ) {
    return new ProviderError("Groq extraction request timed out.", "TIMEOUT", status ?? 504);
  }
  if (status && status >= 500) {
    return new ProviderError("Groq service is temporarily unavailable.", "UNAVAILABLE", status);
  }
  if (error instanceof Error && error.name === "APIConnectionError") {
    // Network failure before a response: treat like a 503 so it gets the single retry.
    return new ProviderError("Groq could not be reached.", "UNAVAILABLE", 503);
  }

  return new ProviderError(
    "Groq extraction request failed.",
    "REQUEST_FAILED",
    status,
  );
}

export class GroqProvider implements AIProvider {
  readonly name = "groq" as const;

  constructor(
    readonly options: {
      model: string;
      apiKey?: string;
      timeoutMs?: number;
    },
  ) {}

  get model() {
    return this.options.model;
  }

  async extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
    const config = requireAIConfig();
    if (config.provider !== this.name) {
      // No status: permanent configuration problem, never retried.
      throw new ProviderError("Groq is not the configured AI provider.", "UNAVAILABLE");
    }

    if (!input.pages || input.pages.length === 0) {
      throw new ProviderError("At least one page is required for extraction.", "REQUEST_FAILED");
    }
    if (input.pages.length > 3) {
      throw new ProviderError("Image batch exceeds maximum of 3 pages per request.", "REQUEST_FAILED");
    }

    const env = getEnv();
    const apiKey = this.options.apiKey || config.apiKey;
    const requestedTimeout = input.modelConfig?.timeoutMs ?? this.options.timeoutMs ?? env.AI_REQUEST_TIMEOUT_MS;
    const timeoutMs = Math.max(5_000, Math.min(requestedTimeout, 120_000));

    // maxRetries: 0 — the SDK would otherwise retry twice on its own, on top of the
    // application's single bounded retry in ExtractionService (up to 6 metered calls per batch).
    const client = new Groq({ apiKey, timeout: timeoutMs, maxRetries: 0 });
    const content = createGroqVisionContent(input);

    const startTime = Date.now();
    try {
      const response = await client.chat.completions.create({
        model: input.modelConfig?.model || this.model,
        messages: [
          { role: "system", content: extractionSystemPrompt(input.documentType) },
          { role: "user", content },
        ],
        temperature: 0,
        max_completion_tokens: env.AI_MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
      });
      const latencyMs = Date.now() - startTime;
      const choice = response.choices[0];
      const responseContent = choice?.message?.content;

      if (choice?.finish_reason === "length") {
        throw new ProviderError(
          "The AI response was cut off at the output token limit. Retry, or enter the values manually.",
          "INVALID_RESPONSE",
        );
      }
      if (!responseContent) {
        throw new ProviderError("Groq returned an empty response.", "INVALID_RESPONSE");
      }

      const usage: ExtractionUsage = {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        imageCount: input.pages.length,
        requestCount: 1,
      };

      try {
        return validateAndNormalizeResponse({
          documentType: input.documentType,
          content: responseContent,
          provider: this.name,
          model: response.model || this.model,
          latencyMs,
          usage,
          rawRequestId: response.id,
          promptVersion: input.promptVersion ?? PROMPT_VERSION,
          schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
          pageNumbers: input.pages.map((page) => page.pageNumber),
          lowConfidenceThreshold: env.LOW_CONFIDENCE_THRESHOLD,
        });
      } catch {
        // Fixed message: validation details can echo document content from the model output.
        throw new ProviderError(
          "Groq returned a response that does not match the extraction schema.",
          "INVALID_RESPONSE",
        );
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw providerError(error);
    }
  }
}
