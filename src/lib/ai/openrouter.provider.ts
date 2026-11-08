import "server-only";

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

function providerError(status: number | undefined): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("OpenRouter authentication failed. Check server credentials.", "AUTHENTICATION", status);
  }
  if (status === 402) {
    return new ProviderError(
      "OpenRouter rejected the request because no credit is available.",
      "QUOTA_EXCEEDED",
      status,
    );
  }
  if (status === 429) {
    return new ProviderError("OpenRouter rate limit reached. Please retry in a few moments.", "RATE_LIMIT", status);
  }
  if (status === 408 || status === 504) {
    return new ProviderError("OpenRouter request timed out.", "TIMEOUT", status);
  }
  if (status && status >= 500) {
    return new ProviderError("OpenRouter is temporarily unavailable.", "UNAVAILABLE", status);
  }
  return new ProviderError("OpenRouter extraction request failed.", "REQUEST_FAILED", status);
}

export function createOpenRouterChatRequest(
  input: ExtractionInput,
  model: string,
  maxTokens = getEnv().AI_MAX_COMPLETION_TOKENS,
) {
  return {
    model,
    messages: [
      { role: "system", content: extractionSystemPrompt(input.documentType) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: extractionUserPrompt(
              input.documentType,
              input.pages.map((page) => page.pageNumber),
            ),
          },
          ...input.pages.map((page) => ({
            type: "image_url",
            image_url: {
              url: `data:${page.mimeType};base64,${page.imageBase64}`,
              detail: "auto",
            },
          })),
        ],
      },
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };
}

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter" as const;

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
      throw new ProviderError("OpenRouter is not the configured AI provider.", "UNAVAILABLE");
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = Date.now();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.APP_URL,
          "X-OpenRouter-Title": "CargoVerity",
        },
        body: JSON.stringify(
          createOpenRouterChatRequest(input, input.modelConfig?.model || this.model),
        ),
      });

      const latencyMs = Date.now() - startTime;
      // Check the status before reading the body: error bodies may be HTML or plain text.
      if (!response.ok) throw providerError(response.status);

      let data: {
        id?: string;
        model?: string;
        choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      try {
        data = await response.json();
      } catch {
        throw new ProviderError("OpenRouter returned a response that is not JSON.", "INVALID_RESPONSE");
      }

      const choice = data.choices?.[0];
      // Only a reply that stops at the token cap AND fails validation is reported as cut off.
      const hitTokenLimit = choice?.finish_reason === "length";
      const content = choice?.message?.content;
      if (!content) {
        throw new ProviderError("OpenRouter returned an empty response.", "INVALID_RESPONSE");
      }

      const usage: ExtractionUsage = {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
        imageCount: input.pages.length,
        requestCount: 1,
      };

      try {
        return validateAndNormalizeResponse({
          documentType: input.documentType,
          content,
          provider: this.name,
          model: data.model || this.model,
          latencyMs,
          usage,
          rawRequestId: data.id,
          promptVersion: input.promptVersion ?? PROMPT_VERSION,
          schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
          pageNumbers: input.pages.map((page) => page.pageNumber),
          lowConfidenceThreshold: env.LOW_CONFIDENCE_THRESHOLD,
        });
      } catch {
        throw new ProviderError(
          hitTokenLimit
            ? "The AI response was cut off at the output token limit. Retry, or enter the values manually."
            : "OpenRouter returned a response that does not match the extraction schema.",
          "INVALID_RESPONSE",
        );
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError("OpenRouter extraction request timed out.", "TIMEOUT", 504);
      }
      // Network failure before any response: retryable like a 503.
      throw new ProviderError("OpenRouter could not be reached.", "UNAVAILABLE", 503);
    } finally {
      clearTimeout(timeout);
    }
  }
}
