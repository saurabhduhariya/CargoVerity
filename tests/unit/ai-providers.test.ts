import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { GroqProvider } from "@/lib/ai/groq.provider";
import { OpenRouterProvider } from "@/lib/ai/openrouter.provider";
import { ExtractionService } from "@/lib/ai/extraction.service";
import { logExtractionAttempt } from "@/lib/ai/logger";
import { ProviderError } from "@/lib/errors";
import type { AIProvider, ExtractionInput, ExtractionResult } from "@/lib/ai/types";

const makePage = (pageNumber: number) => ({
  pageNumber,
  imageBase64: "dGVzdC1iYXNlNjQ=",
  mimeType: "image/jpeg" as const,
});

describe("AI Provider Adapters (Week 3 Step 3)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_groq_key_12345";
    process.env.GROQ_MODEL = "qwen/qwen3.8-27b";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test-openrouter-key";
    process.env.OPENROUTER_MODEL = "openrouter/free";
    process.env.APP_URL = "http://localhost:3000";
    process.env.MAX_AI_RETRIES = "1";
    process.env.MAX_AI_IMAGES_PER_REQUEST = "3";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("GroqProvider", () => {
    it("rejects empty pages with ProviderError REQUEST_FAILED", async () => {
      const provider = new GroqProvider({ model: "qwen/qwen3.8-27b" });
      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [] }),
      ).rejects.toThrow("At least one page is required for extraction.");
    });

    it("rejects batches exceeding 3 pages with ProviderError REQUEST_FAILED", async () => {
      const provider = new GroqProvider({ model: "qwen/qwen3.8-27b" });
      const pages = [makePage(1), makePage(2), makePage(3), makePage(4)];
      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages }),
      ).rejects.toThrow("Image batch exceeds maximum of 3 pages per request.");
    });

    it("throws UNAVAILABLE if Groq is not the configured AI_PROVIDER", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new GroqProvider({ model: "qwen/qwen3.8-27b" });
      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: expect.stringContaining("Groq is not the configured AI provider"),
      });
    });
  });

  describe("OpenRouterProvider", () => {
    it("rejects empty pages with ProviderError REQUEST_FAILED", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });
      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [] }),
      ).rejects.toThrow("At least one page is required for extraction.");
    });

    it("rejects batches exceeding 3 pages with ProviderError REQUEST_FAILED", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });
      const pages = [makePage(1), makePage(2), makePage(3), makePage(4)];
      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages }),
      ).rejects.toThrow("Image batch exceeds maximum of 3 pages per request.");
    });

    it("throws UNAVAILABLE if OpenRouter is not the configured AI_PROVIDER", async () => {
      process.env.AI_PROVIDER = "groq";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });
      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: expect.stringContaining("OpenRouter is not the configured AI provider"),
      });
    });

    it("handles successful response with usage tokens and metadata", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });

      const mockInvoiceJson = JSON.stringify({
        exporter: { value: "Apex Exports", confidence: 0.98, sourceQuote: "Apex Exports", pageNumber: 1 },
        importer: { value: "Verity Global", confidence: 0.95, sourceQuote: "Verity Global", pageNumber: 1 },
        documentNumber: { value: "INV-999", confidence: 0.99, sourceQuote: "INV-999", pageNumber: 1 },
        issueDate: { value: "2026-10-15", confidence: 0.97, sourceQuote: "2026-10-15", pageNumber: 1 },
        currency: { value: "USD", confidence: 0.99, sourceQuote: "USD", pageNumber: 1 },
        invoiceTotal: { value: "5400.00", confidence: 0.96, sourceQuote: "Total: 5400.00", pageNumber: 1 },
        lineItems: [
          {
            lineNumber: 1,
            description: "Industrial Roller",
            quantity: "10.000",
            unitPrice: "540.00",
            lineTotal: "5400.00",
            confidence: 0.95,
            sourceQuote: "Roller 10 540 5400",
            pageNumber: 1,
          },
        ],
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "gen-req-12345",
          model: "openrouter/free",
          choices: [
            {
              message: {
                content: mockInvoiceJson,
              },
            },
          ],
          usage: {
            prompt_tokens: 1500,
            completion_tokens: 350,
            total_tokens: 1850,
          },
        }),
      });

      global.fetch = mockFetch;

      const result = await provider.extractDocument({
        documentType: "INVOICE",
        pages: [makePage(1)],
      });

      expect(result.provider).toBe("openrouter");
      expect(result.usage).toEqual({
        promptTokens: 1500,
        completionTokens: 350,
        totalTokens: 1850,
        imageCount: 1,
        requestCount: 1,
      });
      expect(result.providerMetadata?.rawRequestId).toBe("gen-req-12345");
      expect(result.fields).toHaveLength(6);
      expect(result.lineItems).toHaveLength(1);

      // Verify headers passed to OpenRouter
      expect(mockFetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-or-v1-test-openrouter-key",
            "HTTP-Referer": "http://localhost:3000",
            "X-OpenRouter-Title": "CargoVerity",
          }),
        }),
      );
    });

    it("maps 401/403 status to safe AUTHENTICATION ProviderError without leaking keys", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Invalid API key" }),
      });

      try {
        await provider.extractDocument({ documentType: "INVOICE", pages: [makePage(1)] });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pErr = err as ProviderError;
        expect(pErr.code).toBe("AUTHENTICATION");
        expect(pErr.message).toBe("OpenRouter authentication failed. Check server credentials.");
        expect(pErr.message).not.toContain("sk-or-v1");
      }
    });

    it("maps 402 status to a non-retryable QUOTA_EXCEEDED ProviderError", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        json: async () => ({ error: "Payment required" }),
      });

      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "QUOTA_EXCEEDED",
        retryable: false,
        message: "OpenRouter rejected the request because no credit is available.",
      });
    });

    it("maps 429 status to safe RATE_LIMIT ProviderError", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "Rate limit exceeded" }),
      });

      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "RATE_LIMIT",
        message: "OpenRouter rate limit reached. Please retry in a few moments.",
      });
    });

    it("maps 503 status to safe UNAVAILABLE ProviderError", async () => {
      process.env.AI_PROVIDER = "openrouter";
      const provider = new OpenRouterProvider({ model: "openrouter/free" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Service unavailable" }),
      });

      await expect(
        provider.extractDocument({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: "OpenRouter is temporarily unavailable.",
      });
    });
  });

  describe("Retry Policy (Week 3 Step 3 Rule 8)", () => {
    it("retries transient RATE_LIMIT error exactly once then throws", async () => {
      let callCount = 0;
      const mockProvider: AIProvider = {
        name: "groq",
        model: "qwen/qwen3.8-27b",
        async extractDocument() {
          callCount++;
          throw new ProviderError("Rate limit exceeded", "RATE_LIMIT", 429);
        },
      };

      const service = new ExtractionService(mockProvider);
      await expect(
        service.extract({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "RATE_LIMIT",
      });

      expect(callCount).toBe(2); // 1 initial + 1 retry
    });

    it("retries transient UNAVAILABLE error exactly once then succeeds", async () => {
      let callCount = 0;
      const mockSuccessResult: ExtractionResult = {
        documentType: "INVOICE",
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        fields: [],
        lineItems: [],
        warnings: [],
      };

      const mockProvider: AIProvider = {
        name: "groq",
        model: "qwen/qwen3.8-27b",
        async extractDocument() {
          callCount++;
          if (callCount === 1) {
            throw new ProviderError("Server unavailable", "UNAVAILABLE", 503);
          }
          return mockSuccessResult;
        },
      };

      const service = new ExtractionService(mockProvider);
      const result = await service.extract({ documentType: "INVOICE", pages: [makePage(1)] });

      expect(callCount).toBe(2);
      expect(result.documentType).toBe("INVOICE");
    });

    it("does NOT retry non-transient AUTHENTICATION error", async () => {
      let callCount = 0;
      const mockProvider: AIProvider = {
        name: "groq",
        model: "qwen/qwen3.8-27b",
        async extractDocument() {
          callCount++;
          throw new ProviderError("Auth failed", "AUTHENTICATION", 401);
        },
      };

      const service = new ExtractionService(mockProvider);
      await expect(
        service.extract({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "AUTHENTICATION",
      });

      expect(callCount).toBe(1); // No retry!
    });

    it("does NOT retry non-transient INVALID_RESPONSE error", async () => {
      let callCount = 0;
      const mockProvider: AIProvider = {
        name: "groq",
        model: "qwen/qwen3.8-27b",
        async extractDocument() {
          callCount++;
          throw new ProviderError("Invalid JSON", "INVALID_RESPONSE");
        },
      };

      const service = new ExtractionService(mockProvider);
      await expect(
        service.extract({ documentType: "INVOICE", pages: [makePage(1)] }),
      ).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });

      expect(callCount).toBe(1); // No retry!
    });
  });

  describe("Usage Aggregation across multi-batch requests", () => {
    it("aggregates token usage and request counts across batches", async () => {
      const mockProvider: AIProvider = {
        name: "groq",
        model: "qwen/qwen3.8-27b",
        async extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
          const batchPageNum = input.pages[0]?.pageNumber ?? 1;
          return {
            documentType: "PACKING_LIST",
            provider: "groq",
            model: "qwen/qwen3.8-27b",
            fields: [
              {
                fieldKey: "packageCount",
                value: "100",
                unit: "pkgs",
                modelConfidence: 0.95,
                sourceQuote: "100 pkgs",
                pageNumber: batchPageNum,
                reviewStatus: "PENDING",
              },
            ],
            lineItems: [],
            usage: {
              promptTokens: 1000,
              completionTokens: 200,
              totalTokens: 1200,
              imageCount: input.pages.length,
              requestCount: 1,
            },
            providerMetadata: {
              provider: "groq",
              model: "qwen/qwen3.8-27b",
              promptVersion: "2026.11-v1",
              schemaVersion: "2026.11-v1",
              latencyMs: 350,
            },
            warnings: [],
          };
        },
      };

      const service = new ExtractionService(mockProvider);
      // 5 pages -> 2 batches (3 + 2)
      const pages = [makePage(1), makePage(2), makePage(3), makePage(4), makePage(5)];
      const result = await service.extract({ documentType: "PACKING_LIST", pages });

      expect(result.usage).toEqual({
        promptTokens: 2000,
        completionTokens: 400,
        totalTokens: 2400,
        imageCount: 5,
        requestCount: 2,
      });
      expect(result.providerMetadata?.latencyMs).toBe(700);
    });
  });

  describe("Safe Extraction Logging (Week 3 Step 3 Rule 11)", () => {
    it("logs only run ID, shipment ID, model ID, prompt version, latency and safe error code", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      logExtractionAttempt({
        runId: "run-uuid-111",
        shipmentId: "shipment-uuid-222",
        modelId: "qwen/qwen3.8-27b",
        promptVersion: "2026.11-v1",
        latencyMs: 1420,
        errorCode: "RATE_LIMIT",
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0] as string);

      expect(loggedJson).toEqual({
        event: "ai_extraction",
        runId: "run-uuid-111",
        shipmentId: "shipment-uuid-222",
        modelId: "qwen/qwen3.8-27b",
        promptVersion: "2026.11-v1",
        latencyMs: 1420,
        errorCode: "RATE_LIMIT",
      });

      // Strict negative assertions: no sensitive keys, no prompt text, no images
      expect(loggedJson).not.toHaveProperty("prompt");
      expect(loggedJson).not.toHaveProperty("apiKey");
      expect(loggedJson).not.toHaveProperty("imageBase64");
      expect(loggedJson).not.toHaveProperty("authorization");
    });
  });
});

