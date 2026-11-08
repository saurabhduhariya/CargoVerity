import { describe, expect, it } from "vitest";

import { groqRetryAfterMs } from "@/lib/ai/groq.provider";
import { PROMPT_VERSION, SCHEMA_VERSION } from "@/lib/ai/extraction-prompts";
import { validateAndNormalizeResponse } from "@/lib/ai/response-validator";
import { apiError } from "@/lib/api-response";
import { ProviderError } from "@/lib/errors";

const field = (value: string | null, unit: string | null = null) => ({
  value, unit, confidence: value === null ? 0 : 1, sourceQuote: value, pageNumber: value === null ? null : 1, reviewReason: null,
});

const body = {
  exporter: field("Company B (China)"),
  documentNumber: field("INV-24811"),
  invoiceTotal: field("16320.00", "USD"),
  grossWeight: field("3120.00", "kg"),
  lineItems: [{ lineNumber: "1", description: "LED panel light 40W", hsnCode: "9405.10", quantity: "2400", quantityUnit: "pcs", unitPrice: "6.80", currency: "USD", lineTotal: "16320.00", confidence: 1, sourceQuote: "1 LED panel light 40W", pageNumber: 1, reviewReason: null }],
};
const readability = [{ pageNumber: 1, isReadable: true, reviewNote: null }];

function validate(payload: unknown) {
  return validateAndNormalizeResponse({
    documentType: "INVOICE", content: JSON.stringify(payload), provider: "groq", model: "m",
    promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, pageNumbers: [1], lowConfidenceThreshold: 0.85,
  });
}

describe("model replies that nest the header items", () => {
  it("accepts detectedDocumentType and pageReadability inside a header object", () => {
    const output = validate({ header: { detectedDocumentType: "INVOICE", pageReadability: readability }, ...body });
    expect(output.fields.find((f) => f.fieldKey === "grossWeight")?.value).toBe("3120.00");
    expect(output.lineItems).toHaveLength(1);
    expect(output.pageReadability).toHaveLength(1);
  });

  it("still accepts the same items at the top level", () => {
    const output = validate({ detectedDocumentType: "INVOICE", pageReadability: readability, ...body });
    expect(output.fields.find((f) => f.fieldKey === "documentNumber")?.value).toBe("INV-24811");
  });

  it("keeps the strict schema: unknown keys inside header are still rejected", () => {
    expect(() => validate({ header: { detectedDocumentType: "INVOICE", invented: "x" }, ...body })).toThrow(/schema validation/);
  });
});

describe("rate-limit waiting", () => {
  it("reads the wait Groq asks for from its message", () => {
    expect(groqRetryAfterMs(new Error("Rate limit reached ... Please try again in 1.74s. Need more tokens?"))).toBe(1740);
    expect(groqRetryAfterMs(new Error("Please try again in 2m3.5s."))).toBe(123500);
    expect(groqRetryAfterMs(new Error("Please try again in 350ms."))).toBe(350);
    expect(groqRetryAfterMs(new Error("Something unrelated"))).toBeUndefined();
  });

  it("prefers the retry-after header when present", () => {
    expect(groqRetryAfterMs({ headers: new Headers({ "retry-after": "12" }), message: "x" })).toBe(12000);
  });

  it("returns the wait to the browser with the 429", async () => {
    const response = apiError(new ProviderError("Groq rate limit reached.", "RATE_LIMIT", 429, 56_000));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("56");
    expect(await response.json()).toMatchObject({ code: "RATE_LIMIT", retryAfterSeconds: 56 });
  });

  it("omits the wait when the provider gave none", async () => {
    const response = apiError(new ProviderError("Groq rate limit reached.", "RATE_LIMIT", 429));
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(await response.json()).not.toHaveProperty("retryAfterSeconds");
  });
});
