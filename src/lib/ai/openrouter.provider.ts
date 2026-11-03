import { getEnv, requireAIConfig } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { extractionSystemPrompt, extractionUserPrompt } from "@/lib/ai/extraction-prompts";
import { validateAndNormalizeResponse } from "@/lib/ai/response-validator";
import type { AIProvider, ExtractionInput, ExtractionResult } from "@/lib/ai/types";

function providerError(status: number | undefined): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("OpenRouter authentication failed.", "AUTHENTICATION", status);
  }
  if (status === 402) {
    return new ProviderError(
      "OpenRouter rejected the request because no free credit is available.",
      "UNAVAILABLE",
      status,
    );
  }
  if (status === 429) {
    return new ProviderError("OpenRouter free-model rate limit reached.", "RATE_LIMIT", status);
  }
  if (status && status >= 500) {
    return new ProviderError("OpenRouter is temporarily unavailable.", "UNAVAILABLE", status);
  }
  return new ProviderError("OpenRouter extraction request failed.", "REQUEST_FAILED", status);
}

export function createOpenRouterChatRequest(input: ExtractionInput, model: string) {
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
    max_tokens: 6_000,
    response_format: { type: "json_object" },
  };
}

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter" as const;

  constructor(readonly options: { model: string }) {}

  get model() {
    return this.options.model;
  }

  async extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
    const config = requireAIConfig();
    if (config.provider !== this.name) {
      throw new ProviderError("OpenRouter is not the configured AI provider.", "UNAVAILABLE");
    }

    const env = getEnv();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.APP_URL,
          "X-OpenRouter-Title": "CargoVerity",
        },
        body: JSON.stringify(createOpenRouterChatRequest(input, this.model)),
      });

      const data = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
      };

      if (!response.ok) throw providerError(response.status);

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new ProviderError("OpenRouter returned an empty response.", "INVALID_RESPONSE");
      }

      return validateAndNormalizeResponse({
        documentType: input.documentType,
        content,
        provider: this.name,
        model: data.model || this.model,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProviderError("OpenRouter request timed out.", "TIMEOUT");
      }
      throw providerError(undefined);
    } finally {
      clearTimeout(timeout);
    }
  }
}
