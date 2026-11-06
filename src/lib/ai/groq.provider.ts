import "server-only";

import Groq from "groq-sdk";

import { requireAIConfig } from "@/lib/env";
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
      throw new ProviderError("Groq is not the configured AI provider.", "UNAVAILABLE");
    }

    if (!input.pages || input.pages.length === 0) {
      throw new ProviderError("At least one page is required for extraction.", "REQUEST_FAILED");
    }
    if (input.pages.length > 3) {
      throw new ProviderError("Image batch exceeds maximum of 3 pages per request.", "REQUEST_FAILED");
    }

    const apiKey = this.options.apiKey || config.apiKey;
    const requestedTimeout = input.modelConfig?.timeoutMs ?? this.options.timeoutMs ?? 60_000;
    const timeoutMs = Math.max(5_000, Math.min(requestedTimeout, 120_000));

    const client = new Groq({ apiKey, timeout: timeoutMs });
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
        max_completion_tokens: 1_000,
        response_format: { type: "json_object" },
      });
      const latencyMs = Date.now() - startTime;
      const responseContent = response.choices[0]?.message?.content;

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
        });
      } catch (validationError) {
        throw new ProviderError(
          validationError instanceof Error
            ? `Groq returned an invalid extraction response: ${validationError.message}`
            : "Groq returned an invalid extraction response.",
          "INVALID_RESPONSE",
        );
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw providerError(error);
    }
  }
}
