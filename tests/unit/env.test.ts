import { afterEach, describe, expect, it } from "vitest";

import { getEnv, requireDatabaseUrl } from "@/lib/env";
import { createAIProvider } from "@/lib/ai/provider-factory";

const managedKeys = [
  "AI_PROVIDER",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "DATABASE_URL",
  "CHECK_WEIGHT_TOLERANCE_PERCENT",
  "CHECK_WEIGHT_TOLERANCE_KG",
  "CHECK_MONETARY_TOLERANCE",
] as const;

const originalValues = Object.fromEntries(
  managedKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of managedKeys) {
    const original = originalValues[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("server environment validation", () => {
  it("selects Groq and requires only the Groq credential", () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GROQ_MODEL = "qwen/qwen3.8-27b";
    delete process.env.OPENROUTER_API_KEY;

    const provider = createAIProvider();

    expect(provider.name).toBe("groq");
    expect(provider.model).toBe("qwen/qwen3.8-27b");
  });

  it("selects OpenRouter when configured without requiring Groq", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_MODEL = "openrouter/free";
    delete process.env.GROQ_API_KEY;

    const provider = createAIProvider();

    expect(provider.name).toBe("openrouter");
    expect(provider.model).toBe("openrouter/free");
  });

  it("reports a readable error for a missing selected-provider key", () => {
    process.env.AI_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;

    expect(() => createAIProvider()).toThrow("GROQ_API_KEY is required");
  });

  it("rejects invalid provider and database configuration", () => {
    process.env.AI_PROVIDER = "other";
    expect(() => getEnv()).toThrow("AI_PROVIDER");

    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.DATABASE_URL = "not-a-postgres-url";
    expect(() => requireDatabaseUrl()).toThrow("DATABASE_URL");
  });
});

describe("cross-check tolerance environment (Week 4)", () => {
  it("defaults to 0.5% weight, 0 kg floor and 0.01 money", () => {
    delete process.env.CHECK_WEIGHT_TOLERANCE_PERCENT;
    delete process.env.CHECK_WEIGHT_TOLERANCE_KG;
    delete process.env.CHECK_MONETARY_TOLERANCE;
    const env = getEnv();
    expect(env.CHECK_WEIGHT_TOLERANCE_PERCENT).toBe(0.5);
    expect(env.CHECK_WEIGHT_TOLERANCE_KG).toBe(0);
    expect(env.CHECK_MONETARY_TOLERANCE).toBe(0.01);
  });

  it.each([
    ["CHECK_WEIGHT_TOLERANCE_PERCENT", "-1"],
    ["CHECK_WEIGHT_TOLERANCE_PERCENT", "101"],
    ["CHECK_WEIGHT_TOLERANCE_KG", "-0.5"],
    ["CHECK_MONETARY_TOLERANCE", "abc"],
  ] as const)("rejects %s=%s through the configuration-error path", (key, value) => {
    process.env[key] = value;
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });
});
