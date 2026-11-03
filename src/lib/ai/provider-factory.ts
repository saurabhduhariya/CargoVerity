import { requireAIConfig } from "@/lib/env";
import { GroqProvider } from "@/lib/ai/groq.provider";
import { OpenRouterProvider } from "@/lib/ai/openrouter.provider";
import type { AIProvider } from "@/lib/ai/types";

export function createAIProvider(): AIProvider {
  const config = requireAIConfig();

  if (config.provider === "openrouter") {
    return new OpenRouterProvider({ model: config.model });
  }

  return new GroqProvider({ model: config.model });
}
