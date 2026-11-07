import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Week 3 Step 3 fixes: the Groq SDK's own retries are disabled, truncated or schema-invalid
 * output fails with a fixed message, OpenRouter reads error status before the body, and the
 * single application retry applies only to transient failures.
 */

const create = vi.fn();
const constructorOptions: unknown[] = [];
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create } };
    constructor(options: unknown) {
      constructorOptions.push(options);
    }
  },
}));

const { GroqProvider } = await import("@/lib/ai/groq.provider");
const { OpenRouterProvider } = await import("@/lib/ai/openrouter.provider");
const { ExtractionService } = await import("@/lib/ai/extraction.service");
const { ProviderError } = await import("@/lib/errors");
const { validateAndNormalizeResponse, normalizeProviderError } = await import("@/lib/ai/response-validator");

const page = (pageNumber: number) => ({ pageNumber, imageBase64: "dGVzdA==", mimeType: "image/jpeg" as const });
const validInvoice = JSON.stringify({
  detectedDocumentType: "INVOICE",
  pageReadability: [{ pageNumber: 1, isReadable: true }],
  invoiceTotal: { value: "16,320.00", unit: "USD", confidence: 0.95, sourceQuote: "TOTAL USD 16,320.00", pageNumber: 1, reviewReason: null },
  lineItems: [],
});

const original = { ...process.env };
beforeEach(() => {
  create.mockReset();
  constructorOptions.length = 0;
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "gsk_secret_value_123";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-secret";
  process.env.AI_MAX_COMPLETION_TOKENS = "1500";
});
afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
});

describe("GroqProvider", () => {
  it("disables SDK retries and sends JSON mode, temperature 0 and the configured token cap", async () => {
    create.mockResolvedValue({ id: "r1", model: "m", choices: [{ finish_reason: "stop", message: { content: validInvoice } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    const result = await new GroqProvider({ model: "qwen/qwen3.8-27b" }).extractDocument({ documentType: "INVOICE", pages: [page(1)] });

    expect(constructorOptions[0]).toMatchObject({ maxRetries: 0, apiKey: "gsk_secret_value_123" });
    expect(create.mock.calls[0][0]).toMatchObject({
      temperature: 0,
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
    });
    const content = create.mock.calls[0][0].messages[1].content;
    expect(content[1]).toMatchObject({ type: "image_url", image_url: { url: "data:image/jpeg;base64,dGVzdA==" } });
    expect(result.fields.find((f) => f.fieldKey === "invoiceTotal")?.value).toBe("16320.00");
    expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 5, totalTokens: 15, imageCount: 1, requestCount: 1 });
  });

  it("fails a response cut off at the token cap instead of trusting partial JSON", async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: "length", message: { content: validInvoice } }] });
    await expect(
      new GroqProvider({ model: "m" }).extractDocument({ documentType: "INVOICE", pages: [page(1)] }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: expect.stringMatching(/output token limit/) });
  });

  it("returns a fixed message for schema-invalid output, never the model text", async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: '{"invoiceTotal":{"value":"Customer: Jane Doe, +91 98765"},"leak":1}' } }],
    });
    const error = await new GroqProvider({ model: "m" })
      .extractDocument({ documentType: "INVOICE", pages: [page(1)] })
      .then(() => { throw new Error("expected failure"); }, (e: unknown) => e as Error);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect(error.message).toBe("Groq returned a response that does not match the extraction schema.");
    expect(error.message).not.toMatch(/Jane|98765|leak/);
  });

  it("maps HTTP statuses to safe codes without echoing keys", async () => {
    for (const [status, code] of [[401, "AUTHENTICATION"], [402, "QUOTA_EXCEEDED"], [429, "RATE_LIMIT"], [503, "UNAVAILABLE"], [504, "TIMEOUT"]] as const) {
      create.mockRejectedValueOnce(Object.assign(new Error("upstream said gsk_secret_value_123"), { status }));
      const error = await new GroqProvider({ model: "m" })
        .extractDocument({ documentType: "INVOICE", pages: [page(1)] })
        .then(() => { throw new Error("expected failure"); }, (e: unknown) => e as InstanceType<typeof ProviderError>);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain("gsk_");
    }
  });
});

describe("OpenRouterProvider", () => {
  it("reads the status before the body so a non-JSON error page maps to the right code", async () => {
    process.env.AI_PROVIDER = "openrouter";
    const json = vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json }));
    await expect(
      new OpenRouterProvider({ model: "openrouter/free" }).extractDocument({ documentType: "INVOICE", pages: [page(1)] }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503 });
    expect(json).not.toHaveBeenCalled();
  });

  it("maps schema-invalid output to INVALID_RESPONSE (not REQUEST_FAILED)", async () => {
    process.env.AI_PROVIDER = "openrouter";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }));
    await expect(
      new OpenRouterProvider({ model: "openrouter/free" }).extractDocument({ documentType: "INVOICE", pages: [page(1)] }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("retry policy", () => {
  const providerThatFails = (errors: Error[]) => {
    const extractDocument = vi.fn(async () => {
      const next = errors.shift();
      if (next) throw next;
      return { documentType: "INVOICE", provider: "groq", model: "m", fields: [], lineItems: [], warnings: [], usage: { imageCount: 1, requestCount: 1 } };
    });
    return { name: "groq" as const, model: "m", extractDocument };
  };

  it.each([
    ["429 rate limit", new ProviderError("rl", "RATE_LIMIT", 429)],
    ["504 timeout", new ProviderError("to", "TIMEOUT", 504)],
    ["503 outage", new ProviderError("down", "UNAVAILABLE", 503)],
  ])("retries a %s exactly once", async (_label, error) => {
    const provider = providerThatFails([error]);
    await new ExtractionService(provider as never, { retryDelayMs: 0 }).extract({ documentType: "INVOICE", pages: [page(1)] });
    expect(provider.extractDocument).toHaveBeenCalledTimes(2);

    const twice = providerThatFails([error, error]);
    await expect(
      new ExtractionService(twice as never, { retryDelayMs: 0 }).extract({ documentType: "INVOICE", pages: [page(1)] }),
    ).rejects.toBe(error);
    expect(twice.extractDocument).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["402 quota", new ProviderError("q", "QUOTA_EXCEEDED", 402)],
    ["provider not configured", new ProviderError("nc", "UNAVAILABLE")],
    ["auth", new ProviderError("a", "AUTHENTICATION", 401)],
    ["invalid output", new ProviderError("i", "INVALID_RESPONSE")],
  ])("does not retry %s", async (_label, error) => {
    const provider = providerThatFails([error]);
    await expect(
      new ExtractionService(provider as never, { retryDelayMs: 0 }).extract({ documentType: "INVOICE", pages: [page(1)] }),
    ).rejects.toBe(error);
    expect(provider.extractDocument).toHaveBeenCalledTimes(1);
  });

  it("splits pages into batches of at most 3", async () => {
    const provider = providerThatFails([]);
    await new ExtractionService(provider as never, { retryDelayMs: 0 }).extract({
      documentType: "INVOICE",
      pages: [1, 2, 3, 4, 5, 6, 7].map(page),
    });
    expect(provider.extractDocument.mock.calls.map((c) => (c as unknown as [{ pages: unknown[] }])[0].pages.length)).toEqual([3, 3, 1]);
  });
});

describe("response validation and normalization", () => {
  it("maps field-level aliases and keeps strict rejection of unknown keys", () => {
    const result = validateAndNormalizeResponse({
      documentType: "INVOICE",
      provider: "groq",
      model: "m",
      pageNumbers: [1],
      content: JSON.stringify({
        invoiceTotal: { value: "16,320.00", currency: "USD", confidence: "0.9", source_quote: "TOTAL 16,320.00", page_number: "1" },
        pageReadability: [{ page_number: 1, isReadable: false, review_note: "blurred" }],
        lineItems: [],
      }),
    });
    expect(result.fields[0]).toMatchObject({ value: "16320.00", unit: "USD", modelConfidence: 0.9, sourceQuote: "TOTAL 16,320.00", pageNumber: 1 });
    expect(result.pageReadability).toEqual([{ pageNumber: 1, isReadable: false, reviewNote: "blurred" }]);

    expect(() =>
      validateAndNormalizeResponse({ documentType: "INVOICE", provider: "groq", model: "m", content: JSON.stringify({ invoiceTotal: { value: "1", secret: "x" } }) }),
    ).toThrow(/schema validation/);
  });

  it("drops evidence that cites pages outside the batch and readability for pages not sent", () => {
    const result = validateAndNormalizeResponse({
      documentType: "INVOICE",
      provider: "groq",
      model: "m",
      pageNumbers: [4, 5, 6],
      content: JSON.stringify({
        invoiceTotal: { value: "10", unit: "USD", confidence: 0.99, sourceQuote: "10", pageNumber: 1 },
        pageReadability: [{ pageNumber: 1, isReadable: false }, { pageNumber: 5, isReadable: true }, { pageNumber: 5, isReadable: false }],
        lineItems: [{ description: "x", quantity: "1", pageNumber: 9, sourceQuote: "x" }],
      }),
    });
    expect(result.fields[0]).toMatchObject({ pageNumber: null, reviewReason: "OUTSIDE_PROVIDED_PAGES" });
    expect(result.lineItems[0]).toMatchObject({ pageNumber: null, reviewReason: "OUTSIDE_PROVIDED_PAGES" });
    expect(result.pageReadability).toEqual([{ pageNumber: 5, isReadable: true, reviewNote: null }]);
    expect(result.warnings.join(" ")).toMatch(/cited page 1/);
  });

  it("keeps non-numeric text in numeric fields as-is so the review policy flags it", () => {
    const result = validateAndNormalizeResponse({
      documentType: "PACKING_LIST",
      provider: "groq",
      model: "m",
      content: JSON.stringify({ grossWeight: { value: "approx 3,120 kg", unit: "kg", confidence: 0.9, sourceQuote: "x", pageNumber: 1 } }),
    });
    expect(result.fields[0].value).toBe("approx 3,120 kg");
    expect(result.warnings.join(" ")).toMatch(/non-canonical numeric format/);
  });

  it("passes only our own provider messages through as safe failure text", () => {
    expect(normalizeProviderError(new ProviderError("Groq rate limit reached.", "RATE_LIMIT", 429))).toBe("Groq rate limit reached.");
    expect(normalizeProviderError(new Error("duplicate key value violates unique constraint \"x\""))).toBe("Extraction failed.");
    expect(normalizeProviderError("boom")).toBe("Extraction failed.");
  });
});
