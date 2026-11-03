import Groq from "groq-sdk";

import { requireAIConfig } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { extractionSystemPrompt, extractionUserPrompt } from "@/lib/ai/extraction-prompts";
import { validateAndNormalizeResponse } from "@/lib/ai/response-validator";
import type { AIProvider, ExtractionInput, ExtractionResult } from "@/lib/ai/types";
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
    return new ProviderError("Groq authentication failed.", "AUTHENTICATION", status);
  }
  if (status === 429) {
    return new ProviderError("Groq rate limit reached.", "RATE_LIMIT", status);
  }
  if (error instanceof Error && /timeout|timed out/i.test(error.message)) {
    return new ProviderError("Groq request timed out.", "TIMEOUT", status);
  }

  return new ProviderError(
    "Groq extraction request failed.",
    "REQUEST_FAILED",
    status,
  );
}

export class GroqProvider implements AIProvider {
  readonly name = "groq" as const;

  constructor(readonly options: { model: string }) {}

  get model() {
    return this.options.model;
  }

  async extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
    const config = requireAIConfig();
    if (config.provider !== this.name) {
      throw new ProviderError("Groq is not the configured AI provider.", "UNAVAILABLE");
    }

    const client = new Groq({ apiKey: config.apiKey, timeout: 60_000 });
    const content = createGroqVisionContent(input);

    try {
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: extractionSystemPrompt(input.documentType) },
          { role: "user", content },
        ],
        temperature: 0,
        max_completion_tokens: 6_000,
        response_format: { type: "json_object" },
      });
      const responseContent = response.choices[0]?.message?.content;

      if (!responseContent) {
        throw new ProviderError("Groq returned an empty response.", "INVALID_RESPONSE");
      }

      return validateAndNormalizeResponse({
        documentType: input.documentType,
        content: responseContent,
        provider: this.name,
        model: response.model || this.model,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw providerError(error);
    }
  }
}
