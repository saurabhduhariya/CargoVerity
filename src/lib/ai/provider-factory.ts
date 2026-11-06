import "server-only";

import { requireAIConfig } from "@/lib/env";
import { GroqProvider } from "@/lib/ai/groq.provider";
import { OpenRouterProvider } from "@/lib/ai/openrouter.provider";
import type { AIProvider } from "@/lib/ai/types";

export function createAIProvider(options?: {
  provider?: "groq" | "openrouter";
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}): AIProvider {
  const config = requireAIConfig();
  const selectedProvider = options?.provider || config.provider;
  const selectedModel = options?.model || config.model;

  if (selectedProvider === "openrouter") {
    return new OpenRouterProvider({
      model: selectedModel,
      apiKey: options?.apiKey,
      timeoutMs: options?.timeoutMs,
    });
  }

  return new GroqProvider({
    model: selectedModel,
    apiKey: options?.apiKey,
    timeoutMs: options?.timeoutMs,
  });
}
