import { describe, expect, it } from "vitest";

import { ExtractionService } from "@/lib/ai/extraction.service";
import { createGroqVisionContent } from "@/lib/ai/groq.provider";
import { createOpenRouterChatRequest } from "@/lib/ai/openrouter.provider";
import { validateAndNormalizeResponse } from "@/lib/ai/response-validator";
import type { AIProvider, ExtractionInput, ExtractionResult } from "@/lib/ai/types";

const page = (pageNumber: number) => ({
  pageNumber,
  imageBase64: "a".repeat(120),
  mimeType: "image/jpeg" as const,
});

describe("provider-independent extraction", () => {
  it("builds image requests for both provider adapters", () => {
    const input = { documentType: "INVOICE" as const, pages: [page(1)] };
    const groqContent = createGroqVisionContent(input);
    const openRouterRequest = createOpenRouterChatRequest(input, "openrouter/free");

    expect(groqContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + "a".repeat(120), detail: "auto" } }),
    ]));
    expect(openRouterRequest.model).toBe("openrouter/free");
    expect(openRouterRequest.messages[1]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url" }),
    ]));
  });

  it("validates and normalizes document-specific JSON", () => {
    const result = validateAndNormalizeResponse({
      documentType: "INVOICE",
      provider: "groq",
      model: "qwen/qwen3.8-27b",
      content: JSON.stringify({
        exporter: { value: "Exporter Ltd", confidence: 0.98, sourceQuote: "Exporter Ltd", pageNumber: 1 },
        currency: { value: "USD", confidence: 0.99, sourceQuote: "USD", pageNumber: 1 },
        invoiceTotal: { value: "100.00", confidence: 0.7, sourceQuote: "Total 100.00", pageNumber: 1 },
        lineItems: [{ lineNumber: 1, description: "Widget", quantity: "2", lineTotal: "100.00", sourceQuote: "Widget 2 100.00", pageNumber: 1 }],
      }),
    });

    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "exporter", value: "Exporter Ltd", reviewStatus: "PENDING" }),
    ]));
    expect(result.lineItems[0]?.description).toBe("Widget");
    expect(result.warnings).toContain("Low model confidence for invoiceTotal.");
  });

  it("normalizes common line-item aliases returned by vision models", () => {
    const result = validateAndNormalizeResponse({
      documentType: "PACKING_LIST",
      provider: "groq",
      model: "qwen/qwen3.8-27b",
      content: JSON.stringify({
        lineItems: [
          {
            lineNumber: "1",
            description: "Precision Sensor",
            hsCode: "9026.10",
            quantity: "10",
            unit: "pcs",
            sourceQuote: "Precision Sensor 10 pcs",
            pageNumber: 1,
          },
        ],
      }),
    });

    expect(result.lineItems[0]).toEqual(expect.objectContaining({
      lineNumber: 1,
      hsnCode: "9026.10",
      quantity: "10",
      quantityUnit: "pcs",
    }));
  });

  it("batches pages without changing the provider contract", async () => {
    const calls: ExtractionInput[] = [];
    const provider: AIProvider = {
      name: "groq",
      model: "qwen/qwen3.8-27b",
      async extractDocument(input) {
        calls.push(input);
        return {
          documentType: input.documentType,
          provider: "groq",
          model: "qwen/qwen3.8-27b",
          fields: [{ fieldKey: "documentNumber", value: `DOC-${input.pages[0]?.pageNumber}`, unit: null, modelConfidence: 0.9, sourceQuote: "DOC", pageNumber: input.pages[0]?.pageNumber ?? null, reviewStatus: "PENDING" }],
          lineItems: [{ lineNumber: 1, description: "Widget", hsnCode: null, quantity: "2", quantityUnit: "pcs", unitPrice: null, currency: null, lineTotal: "10", modelConfidence: 0.9, sourceQuote: "Widget", pageNumber: input.pages[0]?.pageNumber ?? null }],
          warnings: [],
        } satisfies ExtractionResult;
      },
    };

    const result = await new ExtractionService(provider).extract({ documentType: "INVOICE", pages: [page(1), page(2), page(3), page(4)] });

    expect(calls.map((call) => call.pages.length)).toEqual([3, 1]);
    expect(result.lineItems).toHaveLength(1);
    expect(result.fields[0]?.value).toBe("DOC-1");
  });
});
