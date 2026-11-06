import { describe, expect, it, beforeEach } from "vitest";

import {
  ExtractionReviewPolicyService,
  DOCUMENT_FIELD_POLICIES,
} from "@/lib/ai/review-policy.service";
import type { ExtractionAdapterOutput, NormalizedField, NormalizedLineItem } from "@/lib/ai/types";

describe("Extraction Review Policy Service (Week 3 Step 4)", () => {
  let policyService: ExtractionReviewPolicyService;

  beforeEach(() => {
    // Default low confidence threshold is 0.85
    policyService = new ExtractionReviewPolicyService(0.85);
  });

  describe("Rule 1: Configuration & Threshold Loading", () => {
    it("loads default threshold of 0.85 and supports custom threshold", () => {
      expect(policyService.lowConfidenceThreshold).toBe(0.85);

      const customService = new ExtractionReviewPolicyService(0.92);
      expect(customService.lowConfidenceThreshold).toBe(0.92);
    });

    it("declares explicit field policy definitions for all 3 document slots", () => {
      expect(DOCUMENT_FIELD_POLICIES.INVOICE).toBeDefined();
      expect(DOCUMENT_FIELD_POLICIES.PACKING_LIST).toBeDefined();
      expect(DOCUMENT_FIELD_POLICIES.BILL_OF_LADING).toBeDefined();

      // Commercial Invoice mandatory fields
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.exporter.requirement).toBe("REQUIRED");
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.importer.requirement).toBe("REQUIRED");
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.invoiceTotal.requirement).toBe("REQUIRED");
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.currency.requirement).toBe("REQUIRED");

      // Commercial Invoice optional fields
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.incoterm.requirement).toBe("OPTIONAL");
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.packageCount.requirement).toBe("OPTIONAL");
      expect(DOCUMENT_FIELD_POLICIES.INVOICE.netWeight.requirement).toBe("OPTIONAL");
    });
  });

  describe("Rule 2: Low Model Confidence", () => {
    it("marks values below threshold as REQUIRES_REVIEW with LOW_MODEL_CONFIDENCE", () => {
      const evaluation = policyService.evaluateField("INVOICE", "invoiceTotal", {
        value: "5400.00",
        unit: "USD",
        modelConfidence: 0.75, // Below 0.85
        sourceQuote: "Total: $5,400.00",
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("LOW_MODEL_CONFIDENCE");
      expect(evaluation.isBlocker).toBe(true);
      expect(evaluation.confidenceLabel).toBe("model estimate");
    });

    it("marks values meeting or exceeding threshold as PENDING with no review reason", () => {
      const evaluation = policyService.evaluateField("INVOICE", "invoiceTotal", {
        value: "5400.00",
        unit: "USD",
        modelConfidence: 0.95, // Exceeds 0.85
        sourceQuote: "Total: $5,400.00",
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("PENDING");
      expect(evaluation.reviewReason).toBeNull();
      expect(evaluation.isBlocker).toBe(false);
      expect(evaluation.confidenceLabel).toBe("model estimate");
    });
  });

  describe("Rule 3: Missing Required Values", () => {
    it("marks missing required fields as REQUIRES_REVIEW with REQUIRED_FIELD_MISSING", () => {
      const evaluation = policyService.evaluateField("INVOICE", "exporter", {
        value: null,
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("REQUIRED_FIELD_MISSING");
      expect(evaluation.isBlocker).toBe(true);
      expect(evaluation.requirement).toBe("REQUIRED");
    });

    it("treats empty or whitespace strings as missing required values", () => {
      const evaluation = policyService.evaluateField("PACKING_LIST", "documentNumber", {
        value: "   ",
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("REQUIRED_FIELD_MISSING");
      expect(evaluation.isBlocker).toBe(true);
    });
  });

  describe("Rule 4: Missing Optional Values", () => {
    it("marks missing optional values as NOT_PRESENT without blocking review", () => {
      const incotermEval = policyService.evaluateField("INVOICE", "incoterm", {
        value: null,
      });

      expect(incotermEval.reviewStatus).toBe("NOT_PRESENT");
      expect(incotermEval.reviewReason).toBe("OPTIONAL_FIELD_NOT_PRESENT");
      expect(incotermEval.isBlocker).toBe(false);
      expect(incotermEval.requirement).toBe("OPTIONAL");

      const netWeightEval = policyService.evaluateField("INVOICE", "netWeight", {
        value: null,
      });

      expect(netWeightEval.reviewStatus).toBe("NOT_PRESENT");
      expect(netWeightEval.isBlocker).toBe(false);
    });
  });

  describe("Rule 5: Source Quote and Page Evidence", () => {
    it("marks present values without source quote as REQUIRES_REVIEW with MISSING_SOURCE_EVIDENCE", () => {
      const evaluation = policyService.evaluateField("INVOICE", "exporter", {
        value: "Apex Exports Ltd",
        modelConfidence: 0.98,
        sourceQuote: null, // Missing quote
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("MISSING_SOURCE_EVIDENCE");
      expect(evaluation.isBlocker).toBe(true);
    });

    it("marks present values with empty whitespace source quote as requiring review", () => {
      const evaluation = policyService.evaluateField("INVOICE", "exporter", {
        value: "Apex Exports Ltd",
        modelConfidence: 0.98,
        sourceQuote: "   ",
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("MISSING_SOURCE_EVIDENCE");
    });

    it("marks present values without valid page number as requiring review", () => {
      const evaluation = policyService.evaluateField("INVOICE", "exporter", {
        value: "Apex Exports Ltd",
        modelConfidence: 0.98,
        sourceQuote: "Apex Exports Ltd",
        pageNumber: null, // Missing page
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("MISSING_SOURCE_EVIDENCE");
      expect(evaluation.isBlocker).toBe(true);
    });
  });

  describe("Rule 6: Invalid Formats", () => {
    it("marks non-canonical decimal numeric values as INVALID_FORMAT", () => {
      const evaluation = policyService.evaluateField("INVOICE", "invoiceTotal", {
        value: "3,120.00", // Non-canonical (contains comma)
        modelConfidence: 0.99,
        sourceQuote: "Total: 3,120.00",
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("INVALID_FORMAT");
      expect(evaluation.isBlocker).toBe(true);
    });

    it("marks malformed date strings as INVALID_FORMAT", () => {
      const evaluation = policyService.evaluateField("INVOICE", "issueDate", {
        value: "not-a-real-date",
        modelConfidence: 0.95,
        sourceQuote: "Date: not-a-real-date",
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("REQUIRES_REVIEW");
      expect(evaluation.reviewReason).toBe("INVALID_FORMAT");
      expect(evaluation.isBlocker).toBe(true);
    });

    it("flags non-canonical decimal line items as requiring review", () => {
      const lineItem: NormalizedLineItem = {
        lineNumber: 1,
        description: "Widget",
        hsnCode: "8471.30",
        quantity: "1,000", // Comma format
        quantityUnit: "pcs",
        unitPrice: "10.00",
        currency: "USD",
        lineTotal: "10000.00",
        modelConfidence: 0.95,
        sourceQuote: "Widget 1,000 $10.00",
        pageNumber: 1,
      };

      const evalLine = policyService.evaluateLineItem(lineItem);
      expect(evalLine.requiresReview).toBe(true);
      expect(evalLine.reviewReason).toBe("INVALID_FORMAT");
      expect(evalLine.confidenceLabel).toBe("model estimate");
    });
  });

  describe("Rule 7: Document Type Mismatch Blocker", () => {
    it("treats wrong document type as a document-level blocker", () => {
      const mockResult: ExtractionAdapterOutput = {
        documentType: "INVOICE",
        detectedType: "PACKING_LIST",
        typeMismatch: true,
        pageReadability: [{ pageNumber: 1, isReadable: true }],
        provider: "groq",
        model: "qwen",
        fields: [],
        lineItems: [],
        warnings: [],
      };

      const docEval = policyService.evaluateDocumentExtraction({
        expectedDocumentType: "INVOICE",
        extractionResult: mockResult,
      });

      expect(docEval.typeMismatch).toBe(true);
      expect(docEval.isBlocked).toBe(true);
      expect(docEval.blockingReasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Wrong document type detected"),
        ]),
      );
      expect(docEval.readyForApproval).toBe(false);
    });
  });

  describe("Rule 8: Unreadable Pages Evidence Evaluation", () => {
    it("marks unreadable pages from readability evidence rather than average confidence", () => {
      const mockResult: ExtractionAdapterOutput = {
        documentType: "PACKING_LIST",
        detectedType: "PACKING_LIST",
        typeMismatch: false,
        pageReadability: [
          { pageNumber: 1, isReadable: true },
          { pageNumber: 2, isReadable: false, reviewNote: "Severe blur, torn corner" },
        ],
        provider: "groq",
        model: "qwen",
        fields: [
          {
            fieldKey: "exporter",
            value: "Exporter Ltd",
            unit: null,
            modelConfidence: 0.99, // High confidence on readable part
            sourceQuote: "Exporter Ltd",
            pageNumber: 1,
            reviewStatus: "PENDING",
          },
        ],
        lineItems: [],
        warnings: [],
      };

      const docEval = policyService.evaluateDocumentExtraction({
        expectedDocumentType: "PACKING_LIST",
        extractionResult: mockResult,
      });

      expect(docEval.hasUnreadablePages).toBe(true);
      expect(docEval.unreadablePages).toEqual([2]);
      expect(docEval.isBlocked).toBe(true);
      expect(docEval.blockingReasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Page 2 is unreadable and requires manual fallback"),
        ]),
      );
    });
  });

  describe("Rule 9: Confidence Labeling", () => {
    it("ensures confidence is labelled 'model estimate' on all evaluated fields and line items", () => {
      const fieldEval = policyService.evaluateField("INVOICE", "invoiceTotal", {
        value: "100.00",
        unit: "USD",
        modelConfidence: 0.95,
        sourceQuote: "Total $100.00",
        pageNumber: 1,
      });
      expect(fieldEval.confidenceLabel).toBe("model estimate");

      const lineEval = policyService.evaluateLineItem({
        lineNumber: 1,
        description: "Motor",
        hsnCode: null,
        quantity: "5",
        quantityUnit: "pcs",
        unitPrice: "20.00",
        currency: "USD",
        lineTotal: "100.00",
        modelConfidence: 0.92,
        sourceQuote: "Motor 5",
        pageNumber: 1,
      });
      expect(lineEval.confidenceLabel).toBe("model estimate");
    });
  });

  describe("Rule 10: Strict Cross-Document Isolation", () => {
    it("does not infer missing values from another document or external data", () => {
      // Commercial Invoice missing package count (optional on CI)
      const invoiceFields: NormalizedField[] = [
        {
          fieldKey: "exporter",
          value: "Acme Corp",
          unit: null,
          modelConfidence: 0.98,
          sourceQuote: "Acme Corp",
          pageNumber: 1,
          reviewStatus: "PENDING",
        },
        {
          fieldKey: "importer",
          value: "Global Buyers",
          unit: null,
          modelConfidence: 0.98,
          sourceQuote: "Global Buyers",
          pageNumber: 1,
          reviewStatus: "PENDING",
        },
        {
          fieldKey: "documentNumber",
          value: "INV-101",
          unit: null,
          modelConfidence: 0.97,
          sourceQuote: "INV-101",
          pageNumber: 1,
          reviewStatus: "PENDING",
        },
        {
          fieldKey: "issueDate",
          value: "2026-11-01",
          unit: null,
          modelConfidence: 0.97,
          sourceQuote: "2026-11-01",
          pageNumber: 1,
          reviewStatus: "PENDING",
        },
        {
          fieldKey: "currency",
          value: "USD",
          unit: null,
          modelConfidence: 0.99,
          sourceQuote: "USD",
          pageNumber: 1,
          reviewStatus: "PENDING",
        },
        {
          fieldKey: "invoiceTotal",
          value: "1000.00",
          unit: "USD",
          modelConfidence: 0.96,
          sourceQuote: "Total: 1000.00",
          pageNumber: 1,
          reviewStatus: "PENDING",
        },
      ];

      const docEval = policyService.evaluateDocumentExtraction({
        expectedDocumentType: "INVOICE",
        extractionResult: {
          documentType: "INVOICE",
          detectedType: "INVOICE",
          typeMismatch: false,
          pageReadability: [{ pageNumber: 1, isReadable: true }],
          provider: "groq",
          model: "qwen",
          fields: invoiceFields,
          lineItems: [],
          warnings: [],
        },
      });

      // Optional missing field remains NOT_PRESENT, never fabricated or cross-populated
      const packageCountEval = docEval.fields.find((f) => f.fieldKey === "packageCount");
      expect(packageCountEval?.reviewStatus).toBe("NOT_PRESENT");
      expect(packageCountEval?.value).toBeNull();
      expect(docEval.isBlocked).toBe(false);
      expect(docEval.readyForApproval).toBe(true);
    });
  });
});

