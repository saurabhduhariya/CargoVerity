import { describe, expect, it } from "vitest";

import {
  ExtractedValueSchema,
  toCanonicalDecimalString,
  CANONICAL_DECIMAL_REGEX,
} from "@/lib/ai/schemas/common";
import { InvoiceExtractionSchema } from "@/lib/ai/schemas/invoice.schema";
import { PackingListExtractionSchema } from "@/lib/ai/schemas/packing-list.schema";
import { BillOfLadingExtractionSchema } from "@/lib/ai/schemas/bill-of-lading.schema";
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  extractionSystemPrompt,
  extractionUserPrompt,
} from "@/lib/ai/extraction-prompts";
import {
  validateAndNormalizeResponse,
  validateBusinessRules,
} from "@/lib/ai/response-validator";
import type {
  AiDocumentExtractor,
  ExtractionAdapterInput,
  ExtractionAdapterOutput,
} from "@/lib/ai/types";

describe("Extraction Contracts & Validation (Week 3 Step 1)", () => {
  describe("AiDocumentExtractor Interface & Types", () => {
    it("adheres to the AiDocumentExtractor interface contract", async () => {
      const mockExtractor: AiDocumentExtractor = {
        name: "groq",
        model: "qwen/qwen3.8-27b",
        async extractDocument(input: ExtractionAdapterInput): Promise<ExtractionAdapterOutput> {
          return {
            documentType: input.documentType,
            detectedType: "INVOICE",
            typeMismatch: false,
            pageReadability: [{ pageNumber: 1, isReadable: true }],
            provider: "groq",
            model: "qwen/qwen3.8-27b",
            fields: [
              {
                fieldKey: "invoiceTotal",
                value: "3120.00",
                unit: "USD",
                modelConfidence: 0.95,
                sourceQuote: "TOTAL: $3,120.00",
                pageNumber: 1,
                reviewStatus: "PENDING",
              },
            ],
            lineItems: [],
            usage: {
              promptTokens: 120,
              completionTokens: 80,
              totalTokens: 200,
              imageCount: 1,
              requestCount: 1,
            },
            providerMetadata: {
              provider: "groq",
              model: "qwen/qwen3.8-27b",
              promptVersion: input.promptVersion ?? PROMPT_VERSION,
              schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
              latencyMs: 350,
            },
            warnings: [],
          };
        },
      };

      const result = await mockExtractor.extractDocument({
        documentType: "INVOICE",
        storageReference: {
          shipmentId: "shipment-123",
          documentId: "doc-456",
          storageKey: "shipments/shipment-123/documents/doc-456/uuid.pdf",
          version: 1,
        },
        modelConfig: {
          provider: "groq",
          model: "qwen/qwen3.8-27b",
          timeoutMs: 30000,
          maxRetries: 1,
        },
        idempotencyKey: "idemp-789",
        pages: [{ pageNumber: 1, imageBase64: "base64data", mimeType: "image/jpeg" }],
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
      });

      expect(result.documentType).toBe("INVOICE");
      expect(result.detectedType).toBe("INVOICE");
      expect(result.typeMismatch).toBe(false);
      expect(result.fields[0]?.value).toBe("3120.00");
      expect(result.usage?.totalTokens).toBe(200);
      expect(result.providerMetadata?.promptVersion).toBe(PROMPT_VERSION);
    });
  });

  describe("Canonical Decimal Strings & ExtractedValueSchema", () => {
    it("converts formatted numeric strings and numbers to canonical decimal strings", () => {
      expect(toCanonicalDecimalString("3,120.00")).toBe("3120.00");
      expect(toCanonicalDecimalString("1,000,000.50")).toBe("1000000.50");
      expect(toCanonicalDecimalString(45)).toBe("45");
      expect(toCanonicalDecimalString(1234.56)).toBe("1234.56");
      expect(toCanonicalDecimalString("2400")).toBe("2400");
      expect(toCanonicalDecimalString(null)).toBeNull();
      expect(toCanonicalDecimalString(undefined)).toBeNull();
      expect(toCanonicalDecimalString("")).toBeNull();
      expect(CANONICAL_DECIMAL_REGEX.test("3120.00")).toBe(true);
      expect(CANONICAL_DECIMAL_REGEX.test("3,120.00")).toBe(false);
    });

    it("parses valid ExtractedValueSchema objects and preserves nullable values", () => {
      const valid = ExtractedValueSchema.parse({
        value: "3120.00",
        unit: "kg",
        confidence: 0.95,
        sourceQuote: "Gross Weight: 3,120 kg",
        pageNumber: 1,
      });
      expect(valid.value).toBe("3120.00");
      expect(valid.unit).toBe("kg");
      expect(valid.confidence).toBe(0.95);

      // Nullable field when value is absent in source
      const absent = ExtractedValueSchema.parse({
        value: null,
        unit: null,
        confidence: null,
        sourceQuote: null,
        pageNumber: null,
      });
      expect(absent.value).toBeNull();
    });

    it("allows explicit reviewReason when evidence is missing or calculated", () => {
      const withReason = ExtractedValueSchema.parse({
        value: "45.00",
        unit: "kg",
        confidence: 0.88,
        sourceQuote: null,
        pageNumber: null,
        reviewReason: "CALCULATED_FROM_LINE_ITEMS",
      });
      expect(withReason.reviewReason).toBe("CALCULATED_FROM_LINE_ITEMS");
    });

    it("rejects invalid confidence outside [0, 1]", () => {
      expect(() =>
        ExtractedValueSchema.parse({
          value: "100",
          confidence: 1.5,
        }),
      ).toThrow();

      expect(() =>
        ExtractedValueSchema.parse({
          value: "100",
          confidence: -0.1,
        }),
      ).toThrow();
    });
  });

  describe("Separate Document Schemas", () => {
    it("validates Commercial Invoice schema with invoice-specific fields", () => {
      const validInvoice = InvoiceExtractionSchema.parse({
        detectedDocumentType: "INVOICE",
        pageReadability: [{ pageNumber: 1, isReadable: true }],
        exporter: { value: "Company B Ltd", confidence: 0.99, sourceQuote: "Company B Ltd", pageNumber: 1 },
        importer: { value: "Importer Corp", confidence: 0.98, sourceQuote: "Importer Corp", pageNumber: 1 },
        documentNumber: { value: "INV-24811", confidence: 0.95, sourceQuote: "INV-24811", pageNumber: 1 },
        currency: { value: "USD", confidence: 0.99, sourceQuote: "USD", pageNumber: 1 },
        incoterm: { value: "FOB", confidence: 0.92, sourceQuote: "FOB Shanghai", pageNumber: 1 },
        invoiceTotal: { value: "36000.00", confidence: 0.95, sourceQuote: "Total: $36,000.00", pageNumber: 1 },
        grossWeight: { value: "3120.00", unit: "kg", confidence: 0.95, sourceQuote: "3,120 kg", pageNumber: 1 },
        lineItems: [
          {
            lineNumber: 1,
            description: "LED Panel Light 600x600",
            hsnCode: "9405.10",
            quantity: "2400",
            quantityUnit: "pcs",
            unitPrice: "15.00",
            currency: "USD",
            lineTotal: "36000.00",
            confidence: 0.95,
            sourceQuote: "LED Panel Light 2400 pcs $15.00 $36,000.00",
            pageNumber: 1,
          },
        ],
      });

      expect(validInvoice.detectedDocumentType).toBe("INVOICE");
      expect(validInvoice.invoiceTotal?.value).toBe("36000.00");
      expect(validInvoice.lineItems).toHaveLength(1);
    });

    it("rejects unknown fields in strict mode for Invoice schema", () => {
      expect(() =>
        InvoiceExtractionSchema.parse({
          unrecognizedRandomKey: "hallucinated",
        }),
      ).toThrow();
    });

    it("validates Packing List schema with package counts and weights", () => {
      const validPL = PackingListExtractionSchema.parse({
        detectedDocumentType: "PACKING_LIST",
        exporter: { value: "Company B Ltd", confidence: 0.98, sourceQuote: "Company B", pageNumber: 1 },
        documentNumber: { value: "PL-24811", confidence: 0.95, sourceQuote: "PL-24811", pageNumber: 1 },
        packageCount: { value: "400", unit: "ctn", confidence: 0.96, sourceQuote: "400 cartons", pageNumber: 1 },
        netWeight: { value: "2880.00", unit: "kg", confidence: 0.92, sourceQuote: "Net: 2,880 kg", pageNumber: 1 },
        grossWeight: { value: "3165.00", unit: "kg", confidence: 0.97, sourceQuote: "Gross: 3,165 kg", pageNumber: 1 },
        lineItems: [],
      });

      expect(validPL.detectedDocumentType).toBe("PACKING_LIST");
      expect(validPL.grossWeight?.value).toBe("3165.00");
    });

    it("validates Bill of Lading schema with transport and container fields", () => {
      const validBL = BillOfLadingExtractionSchema.parse({
        detectedDocumentType: "BILL_OF_LADING",
        containerNumber: { value: "MSKU1234567", confidence: 0.98, sourceQuote: "MSKU1234567", pageNumber: 1 },
        vessel: { value: "CMA CGM ANTOINE", confidence: 0.95, sourceQuote: "CMA CGM ANTOINE", pageNumber: 1 },
        portOfLoading: { value: "Shanghai", confidence: 0.96, sourceQuote: "Port of Loading: Shanghai", pageNumber: 1 },
        portOfDischarge: { value: "Rotterdam", confidence: 0.96, sourceQuote: "Port of Discharge: Rotterdam", pageNumber: 1 },
        grossWeight: { value: "3165.00", unit: "kg", confidence: 0.95, sourceQuote: "3,165 kg", pageNumber: 1 },
        lineItems: [],
      });

      expect(validBL.containerNumber?.value).toBe("MSKU1234567");
      expect(validBL.vessel?.value).toBe("CMA CGM ANTOINE");
    });
  });

  describe("Schema & Prompt Versions", () => {
    it("exports prompt and schema versions matching 2026.11 standard", () => {
      // Prompt text changed on 2026-11-07 (v2); the response JSON schema is unchanged (v1).
      expect(PROMPT_VERSION).toBe("2026.11-v2");
      expect(SCHEMA_VERSION).toBe("2026.11-v1");
      expect(extractionSystemPrompt("INVOICE")).toContain(PROMPT_VERSION);
      expect(extractionSystemPrompt("INVOICE")).toContain(SCHEMA_VERSION);
      expect(extractionUserPrompt("INVOICE", [1, 2])).toContain("Pages included: 1, 2");
    });
  });

  describe("Post-Parsing Zod Business Validation", () => {
    it("flags document type mismatch when detected type differs from expected type", () => {
      const result = validateAndNormalizeResponse({
        documentType: "INVOICE",
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        content: JSON.stringify({
          detectedDocumentType: "PACKING_LIST", // Wrong document type uploaded
          exporter: { value: "Exporter", confidence: 0.95, sourceQuote: "Exporter", pageNumber: 1 },
        }),
      });

      expect(result.typeMismatch).toBe(true);
      expect(result.detectedType).toBe("PACKING_LIST");
      expect(result.warnings.some((w) => w.includes("Document type mismatch"))).toBe(true);
    });

    it("flags unreadable pages reported in pageReadability", () => {
      const result = validateAndNormalizeResponse({
        documentType: "PACKING_LIST",
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        content: JSON.stringify({
          detectedDocumentType: "PACKING_LIST",
          pageReadability: [
            { pageNumber: 1, isReadable: true },
            { pageNumber: 2, isReadable: false, reviewNote: "Severe blur on lower half" },
          ],
        }),
      });

      expect(result.pageReadability).toHaveLength(2);
      expect(result.warnings.some((w) => w.includes("Page 2 reported unreadable"))).toBe(true);
    });

    it("flags missing source evidence when value is present without quote or page", () => {
      const result = validateAndNormalizeResponse({
        documentType: "INVOICE",
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        content: JSON.stringify({
          invoiceTotal: {
            value: "100.00",
            confidence: 0.95,
            sourceQuote: null, // missing quote
            pageNumber: null, // missing page
            // no reviewReason
          },
        }),
      });

      expect(result.warnings).toContain("Missing source evidence for invoiceTotal.");
    });

    it("permits missing source evidence without warning when reviewReason is supplied", () => {
      const result = validateAndNormalizeResponse({
        documentType: "INVOICE",
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        content: JSON.stringify({
          invoiceTotal: {
            value: "100.00",
            confidence: 0.95,
            sourceQuote: null,
            pageNumber: null,
            reviewReason: "CALCULATED_SUM_OF_LINE_ITEMS",
          },
        }),
      });

      expect(result.warnings.some((w) => w.includes("Missing source evidence for invoiceTotal"))).toBe(false);
    });

    it("flags non-canonical decimal representations in numeric fields", () => {
      const validation = validateBusinessRules({
        documentType: "INVOICE",
        detectedType: "INVOICE",
        typeMismatch: false,
        pageReadability: [],
        provider: "groq",
        model: "qwen",
        fields: [
          {
            fieldKey: "invoiceTotal",
            value: "100.5.5", // invalid decimal format
            unit: "USD",
            modelConfidence: 0.9,
            sourceQuote: "total",
            pageNumber: 1,
            reviewStatus: "PENDING",
          },
        ],
        lineItems: [],
        warnings: [],
      });

      expect(validation.valid).toBe(false);
      expect(validation.warnings.some((w) => w.includes("non-canonical numeric format"))).toBe(true);
    });
  });
});
