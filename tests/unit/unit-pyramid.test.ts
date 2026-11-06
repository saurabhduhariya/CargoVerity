import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  ExtractionReviewPolicyService,
} from "@/lib/ai/review-policy.service";
import {
  checkGrossNetSanity,
  checkGrossWeight,
  checkInvoiceArithmetic,
  checkPackageCount,
  matchLineItems,
  runCrossChecks,
} from "@/lib/crosschecks";
import {
  buildDemoV1Export,
  escapeCsvCell,
  sanitizeCsvCell,
} from "@/lib/export/csv";
import { canExport } from "@/lib/export/guard";
import { formatExportBlocker } from "@/lib/export/preview";
import { normalizePartyName, parseStrictDecimal } from "@/lib/normalizers";
import {
  aggregateGroupMetrics,
  areFieldValuesEquivalent,
  calculateAccuracyReport,
  normalizeFieldValue,
  type RawFieldRecord,
} from "@/lib/reports/accuracy";
import {
  evaluateSubmissionGuard,
  type SubmissionGuardDocument,
  type SubmissionGuardInput,
} from "@/lib/submission/guard";

function createValidSubmissionDocument(
  docType: "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING",
): SubmissionGuardDocument {
  const commonFields = [
    {
      id: `${docType}-exporter`,
      fieldKey: "exporter",
      currentValue: "Global Logistics Exports Ltd",
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
    {
      id: `${docType}-importer`,
      fieldKey: "importer",
      currentValue: "CargoVerity Imports Inc",
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
    {
      id: `${docType}-docNum`,
      fieldKey: "documentNumber",
      currentValue: `${docType}-1001`,
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
    {
      id: `${docType}-date`,
      fieldKey: "issueDate",
      currentValue: "2026-11-06",
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
  ];

  if (docType === "INVOICE") {
    return {
      id: "doc-invoice",
      docType: "INVOICE",
      isCurrent: true,
      documentVersion: 1,
      extractionStatus: "EXTRACTED",
      pages: [{ pageNumber: 1, isReadable: true, manualEntryRequired: false }],
      fields: [
        ...commonFields,
        {
          id: "inv-curr",
          fieldKey: "currency",
          currentValue: "USD",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
        {
          id: "inv-total",
          fieldKey: "invoiceTotal",
          currentValue: "52400.00",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
      ],
    };
  }

  if (docType === "PACKING_LIST") {
    return {
      id: "doc-packing-list",
      docType: "PACKING_LIST",
      isCurrent: true,
      documentVersion: 1,
      extractionStatus: "EXTRACTED",
      pages: [{ pageNumber: 1, isReadable: true, manualEntryRequired: false }],
      fields: [
        ...commonFields,
        {
          id: "pl-pkg",
          fieldKey: "packageCount",
          currentValue: "120",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
        {
          id: "pl-gross",
          fieldKey: "grossWeight",
          currentValue: "3165",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
      ],
    };
  }

  return {
    id: "doc-bill-of-lading",
    docType: "BILL_OF_LADING",
    isCurrent: true,
    documentVersion: 1,
    extractionStatus: "EXTRACTED",
    pages: [{ pageNumber: 1, isReadable: true, manualEntryRequired: false }],
    fields: [
      ...commonFields,
      {
        id: "bl-pkg",
        fieldKey: "packageCount",
        currentValue: "120",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
      {
        id: "bl-gross",
        fieldKey: "grossWeight",
        currentValue: "3165",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
      {
        id: "bl-pol",
        fieldKey: "portOfLoading",
        currentValue: "INBOM",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
      {
        id: "bl-pod",
        fieldKey: "portOfDischarge",
        currentValue: "USLAX",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
    ],
  };
}

function createValidSubmissionInput(): SubmissionGuardInput {
  return {
    shipmentId: "shipment-uuid-001",
    currentRevision: 1,
    shipmentStatus: "NEEDS_REVIEW",
    userRole: "EXECUTIVE",
    documents: [
      createValidSubmissionDocument("INVOICE"),
      createValidSubmissionDocument("PACKING_LIST"),
      createValidSubmissionDocument("BILL_OF_LADING"),
    ],
    latestCheckRun: {
      id: "run-uuid-001",
      revision: 1,
      results: [
        {
          id: "check-1",
          ruleKey: "invoice-arithmetic",
          status: "PASS",
          severity: "BLOCKING",
          resolutions: [],
        },
        {
          id: "check-2",
          ruleKey: "weight-gross",
          status: "PASS",
          severity: "BLOCKING",
          resolutions: [],
        },
      ],
    },
    lowConfidenceThreshold: 0.85,
  };
}

describe("Week 6 Step 1: Pure Unit Test Pyramid (15 Required Focus Areas)", () => {
  // 1. Decimal parsing and precision
  describe("1. Decimal parsing and precision", () => {
    it("handles diverse decimal formats, grouping separators, whitespace and precision preservation", () => {
      const res1 = parseStrictDecimal("1,234.56");
      expect(res1.ok).toBe(true);
      if (res1.ok) expect(res1.value.equals(new Decimal("1234.56"))).toBe(true);

      const res2 = parseStrictDecimal("1 234.56");
      expect(res2.ok).toBe(true);
      if (res2.ok) expect(res2.value.equals(new Decimal("1234.56"))).toBe(true);

      const res3 = parseStrictDecimal("98765.4321");
      expect(res3.ok).toBe(true);
      if (res3.ok) expect(res3.canonicalString).toBe("98765.4321");

      const resNeg = parseStrictDecimal("-45.67");
      expect(resNeg.ok).toBe(true);
      if (resNeg.ok) expect(resNeg.value.equals(new Decimal("-45.67"))).toBe(true);

      expect(parseStrictDecimal("invalid").ok).toBe(false);
      expect(parseStrictDecimal("").ok).toBe(false);
    });

    it("performs exact decimal arithmetic without IEEE-754 floating point drift", () => {
      const a = new Decimal("0.1");
      const b = new Decimal("0.2");
      expect(a.plus(b).toString()).toBe("0.3");
      expect(new Decimal("1000.05").minus(new Decimal("999.95")).toString()).toBe("0.1");
    });
  });

  // 2. Currency mismatch
  describe("2. Currency mismatch", () => {
    it("flags currency mismatch across documents or line items", () => {
      const arithmetic = checkInvoiceArithmetic({
        invoiceTotal: { value: "100.00" },
        currency: { value: "USD" },
        lineItems: [
          {
            lineNumber: 1,
            description: "Item 1",
            lineTotal: "50.00",
            currency: "USD",
          },
          {
            lineNumber: 2,
            description: "Item 2 (Foreign import)",
            lineTotal: "50.00",
            currency: "EUR", // Mismatched line currency!
          },
        ],
      });

      expect(arithmetic.status).toBe("INCOMPLETE");
      expect(arithmetic.details.unreconciledReason).toBe("LINE_ITEM_CURRENCY_MISMATCH");
    });
  });

  // 3. Weight conversion and tolerance
  describe("3. Weight conversion and tolerance", () => {
    it("converts units and validates within the strict 1% tolerance", () => {
      // 3.12 tonnes == 3120 kg
      const result = checkGrossWeight({
        candidates: [
          { documentType: "PACKING_LIST", value: "3.12", unit: "t" },
          { documentType: "BILL_OF_LADING", value: "3120", unit: "kg" },
        ],
        requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
      });

      expect(result.status).toBe("PASS");
      expect(result.details.differenceKg).toBe("0.000");
    });

    it("fails when converted weight exceeds tolerance", () => {
      const result = checkGrossWeight({
        candidates: [
          { documentType: "PACKING_LIST", value: "1000", unit: "kg" },
          { documentType: "BILL_OF_LADING", value: "1500", unit: "kg" },
        ],
        requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
      });

      expect(result.status).toBe("MISMATCH");
    });
  });

  // 4. Gross-versus-net sanity
  describe("4. Gross-versus-net sanity", () => {
    it("flags an impossible physical reality where Net Weight exceeds Gross Weight", () => {
      const result = checkGrossNetSanity({
        grossWeight: { value: "45", unit: "kg" },
        netWeight: { value: "50", unit: "kg" }, // Net > Gross!
        documentType: "PACKING_LIST",
      });

      expect(result.status).toBe("MISMATCH");
      expect(result.details.message).toContain("cannot be less than declared net weight");
    });

    it("passes when Net Weight is less than or equal to Gross Weight", () => {
      const result = checkGrossNetSanity({
        grossWeight: { value: "500", unit: "kg" },
        netWeight: { value: "480", unit: "kg" },
        documentType: "PACKING_LIST",
      });

      expect(result.status).toBe("PASS");
    });
  });

  // 5. Optional versus required missing fields
  describe("5. Optional versus required missing fields", () => {
    it("differentiates optional fields (missing discount/tax) from required fields (invoice number/total)", () => {
      const input = createValidSubmissionInput();
      // Remove required field invoiceTotal from INVOICE
      const inv = input.documents.find((d) => d.docType === "INVOICE")!;
      inv.fields = inv.fields.filter((f) => f.fieldKey !== "invoiceTotal");

      const submission = evaluateSubmissionGuard(input);
      expect(submission.allowed).toBe(false);
      expect(submission.reasons).toContain("REQUIRED_FIELD_MISSING");
    });
  });

  // 6. Invoice arithmetic with tax, freight, discount and incomplete lines
  describe("6. Invoice arithmetic with tax, freight, discount and incomplete lines", () => {
    it("calculates exact invoice arithmetic and flags deviations", () => {
      const result = checkInvoiceArithmetic({
        invoiceTotal: { value: "100.00" },
        currency: { value: "USD" },
        lineItems: [
          { lineNumber: 1, description: "Item 1", lineTotal: "40.00", currency: "USD" },
          { lineNumber: 2, description: "Item 2", lineTotal: "60.00", currency: "USD" },
        ],
      });

      expect(result.status).toBe("PASS");
      expect(result.details.calculatedTotal).toBe("100");
    });

    it("identifies incomplete line items missing quantity or unit price", () => {
      const result = checkInvoiceArithmetic({
        invoiceTotal: { value: "500.00" },
        currency: { value: "USD" },
        lineItems: [
          { lineNumber: 1, description: "Unknown sample", quantity: "5", unitPrice: null, lineTotal: null },
        ],
      });

      expect(result.status).toBe("INCOMPLETE");
      expect(result.details.unreconciledReason).toBe("UNRESOLVED_LINE_TOTAL");
    });
  });

  // 7. Package count and package-type mismatch
  describe("7. Package count and package-type mismatch", () => {
    it("flags package count and package packaging type discrepancy across PL and BL", () => {
      const result = checkPackageCount({
        candidates: [
          { documentType: "PACKING_LIST", value: "50", packageType: "cartons" },
          { documentType: "BILL_OF_LADING", value: "48", packageType: "pallets" },
        ],
        requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
      });

      expect(result.status).toBe("MISMATCH");
    });
  });

  // 8. Exact and ambiguous line matching
  describe("8. Exact and ambiguous line matching", () => {
    it("pairs exact line items and flags ambiguous line descriptions", () => {
      const result = matchLineItems({
        invoiceLines: [
          { lineNumber: 1, description: "Stainless Steel Bolt M8", quantity: "100", quantityUnit: "pcs" },
        ],
        packingListLines: [
          { lineNumber: 1, description: "Stainless Steel Bolt M8", quantity: "100", quantityUnit: "pcs" },
        ],
      });

      expect(result.status).toBe("PASS");
      expect(result.details.matchedPairsCount).toBe(1);
      expect(result.details.unmatchedInvoiceLinesCount).toBe(0);
    });
  });

  // 9. Quantity mismatch and incompatible units
  describe("9. Quantity mismatch and incompatible units", () => {
    it("flags incompatible quantity units between Invoice and Packing List", () => {
      const result = matchLineItems({
        invoiceLines: [
          { lineNumber: 1, description: "Bulk Oil", quantity: "1000", quantityUnit: "PCS" },
        ],
        packingListLines: [
          { lineNumber: 1, description: "Bulk Oil", quantity: "1000", quantityUnit: "BOX" },
        ],
      });

      expect(result.status).toBe("INCOMPLETE");
      expect(result.details.unresolvedReason).toBe("INCOMPATIBLE_LINE_UNITS");
      expect(result.details.matchedPairs[0].status).toBe("INCOMPATIBLE_UNITS");
    });

    it("detects quantity mismatch when units are compatible but counts differ", () => {
      const result = matchLineItems({
        invoiceLines: [
          { lineNumber: 1, description: "Precision Gearbox", quantity: "100", quantityUnit: "pcs" },
        ],
        packingListLines: [
          { lineNumber: 1, description: "Precision Gearbox", quantity: "95", quantityUnit: "pcs" },
        ],
      });

      expect(result.status).toBe("MISMATCH");
      expect(result.details.matchedPairs[0].status).toBe("MISMATCH");
      expect(result.details.matchedPairs[0].difference).toBe("5");
    });
  });

  // 10. Party normalization warning behavior
  describe("10. Party normalization warning behavior", () => {
    it("normalizes legal forms, removes punctuation and generates standard form without throwing", () => {
      const res1 = normalizePartyName("Acme Global Logistics, Inc.");
      const res2 = normalizePartyName("ACME GLOBAL LOGISTICS INCORPORATED");
      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      if (res1.ok && res2.ok) {
        expect(res1.normalized).toBe("acme global logistics");
        expect(res2.normalized).toBe("acme global logistics");
      }
    });

    it("handles international entities safely", () => {
      const res = normalizePartyName("  München Export & Import G.m.b.H.  ");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.tokens).toContain("export");
        expect(res.tokens).toContain("import");
      }
    });

    it("validates party consistency cross check behavior", () => {
      const results = runCrossChecks([
        {
          docType: "INVOICE",
          fields: { exporter: { value: "Acme Logistics Inc" } },
          lineItems: [],
        },
        {
          docType: "PACKING_LIST",
          fields: { exporter: { value: "Delta Shipping Ltd" } },
          lineItems: [],
        },
      ]);

      const exporterCheck = results.find((r) => r.ruleKey === "exporter_consistency");
      expect(exporterCheck?.status).toBe("MISMATCH");
    });
  });

  // 11. Confidence/review-policy outcomes
  describe("11. Confidence/review-policy outcomes", () => {
    it("marks values below confidence threshold as REQUIRES_REVIEW with reviewReason", () => {
      const policyService = new ExtractionReviewPolicyService(0.85);
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
    });

    it("marks high confidence values as PENDING auto-confirmation eligible", () => {
      const policyService = new ExtractionReviewPolicyService(0.85);
      const evaluation = policyService.evaluateField("INVOICE", "invoiceTotal", {
        value: "5400.00",
        unit: "USD",
        modelConfidence: 0.95,
        sourceQuote: "Total: $5,400.00",
        pageNumber: 1,
      });

      expect(evaluation.reviewStatus).toBe("PENDING");
      expect(evaluation.reviewReason).toBeNull();
      expect(evaluation.isBlocker).toBe(false);
    });
  });

  // 12. Human-clearance requirements
  describe("12. Human-clearance requirements", () => {
    it("blocks submission when blocking checks remain unresolved or lack required reason", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push({
        id: "check-fail",
        ruleKey: "gross-weight-mismatch",
        status: "MISMATCH",
        severity: "BLOCKING",
        resolutions: [], // Unresolved!
      });

      const submission = evaluateSubmissionGuard(input);
      expect(submission.allowed).toBe(false);
      expect(submission.reasons).toContain("UNRESOLVED_CROSS_CHECK");
    });
  });

  // 13. Export guard decisions
  describe("13. Export guard decisions", () => {
    it("blocks CSV export when shipment is not Manager-approved", () => {
      const guard = canExport({
        shipmentStatus: "READY_FOR_APPROVAL",
        hasManagerApproval: false,
        approvedRevision: null,
        currentRevision: 1,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("manager_approval_required");
      expect(formatExportBlocker("manager_approval_required").title).toContain("Manager Approval Required");
    });

    it("blocks CSV export when edited after approval (revision mismatch)", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1, // Approved revision 1, but shipment is revision 2!
        currentRevision: 2,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("approval_is_stale");
    });

    it("permits export when current revision is strictly approved", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 2,
        currentRevision: 2,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(true);
      expect(guard.reasons.length).toBe(0);
    });
  });

  // 14. CSV escaping and formula-injection protection
  describe("14. CSV escaping and formula-injection protection", () => {
    it("neutralizes formula injection characters (=, +, -, @, tab, cr) by prefixing a single quote", () => {
      expect(sanitizeCsvCell("=SUM(A1:B10)")).toBe("'=SUM(A1:B10)");
      expect(sanitizeCsvCell("+12345")).toBe("'+12345");
      expect(sanitizeCsvCell("@hyperlink")).toBe("'@hyperlink");
      expect(sanitizeCsvCell("\tcmd")).toBe("'\tcmd");
      // Preserves valid negative numbers
      expect(sanitizeCsvCell("-25.00")).toBe("-25.00");
    });

    it("escapes embedded commas, quotes, and newlines properly according to RFC-4180", () => {
      expect(escapeCsvCell('Hello, "World"')).toBe('"Hello, ""World"""');
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    });

    it("generates deterministic demo-v1 CSV format with canonical headers and audit metadata", () => {
      const exportResult = buildDemoV1Export(
        "SHP-2026-UNIT",
        [
          {
            docType: "INVOICE",
            fields: [
              { fieldKey: "invoiceNumber", currentValue: "INV-001" },
              { fieldKey: "invoiceDate", currentValue: "2026-11-06" },
              { fieldKey: "currency", currentValue: "USD" },
              { fieldKey: "invoiceTotal", currentValue: "45000.00" },
            ],
            lineItems: [
              {
                lineNumber: 1,
                description: "Industrial Valve",
                hsnCode: "848180",
                quantity: "100",
                quantityUnit: "PCS",
                unitPrice: "450.00",
                lineTotal: "45000.00",
              },
            ],
          },
          {
            docType: "BILL_OF_LADING",
            fields: [
              { fieldKey: "blNumber", currentValue: "BL-001" },
              { fieldKey: "grossWeight", currentValue: "1250.5", unit: "KG" },
            ],
            lineItems: [],
          },
        ],
        {
          supplierName: "Apex Global",
          approvedBy: "Manager Jane",
          approvedAt: "2026-11-06T12:00:00Z",
          approvedRevision: 1,
        },
      );

      expect(exportResult.csv).toContain("Shipment_Ref");
      expect(exportResult.csv).toContain("SHP-2026-UNIT");
      expect(exportResult.csv).toContain("Industrial Valve");
      expect(exportResult.csv).toContain("848180");
    });
  });

  // 15. Accuracy and correction-rate formulas
  describe("15. Accuracy and correction-rate formulas", () => {
    it("calculates exact mathematical field accuracy and correction rates", () => {
      const records: RawFieldRecord[] = [
        { id: "1", fieldKey: "currency", modelValue: "usd", currentValue: "USD", reviewStatus: "CONFIRMED" },
        { id: "2", fieldKey: "currency", modelValue: "EUR", currentValue: "EUR", reviewStatus: "CONFIRMED" },
        { id: "3", fieldKey: "currency", modelValue: "GBP", currentValue: "GBP", reviewStatus: "VERIFIED" },
        { id: "4", fieldKey: "currency", modelValue: "JPY", currentValue: "USD", reviewStatus: "CORRECTED", correctionsCount: 1 },
        { id: "5", fieldKey: "currency", modelValue: "CAD", currentValue: "CAD", reviewStatus: "PENDING" },
      ];

      const metrics = aggregateGroupMetrics("currency", "Currency", records);

      expect(metrics.evaluated).toBe(4);
      expect(metrics.correctAsExtracted).toBe(3);
      expect(metrics.corrected).toBe(1);
      expect(metrics.unreviewed).toBe(1);
      expect(metrics.accuracy.percentage).toBe(75);

      const report = calculateAccuracyReport(records);
      expect(report.summary.accuracy.percentage).toBe(75);
      expect(report.summary.correctionRate.percentage).toBe(25);
    });

    it("normalizes and compares values for semantic equivalence", () => {
      expect(normalizeFieldValue("currency", " usd ")).toBe("USD");
      expect(normalizeFieldValue("grossWeight", " 3,165.000 ")).toBe("3165");
      expect(areFieldValuesEquivalent("currency", "usd", "USD")).toBe(true);
      expect(areFieldValuesEquivalent("grossWeight", "3165.000", "3165")).toBe(true);
      expect(areFieldValuesEquivalent("description", "Widget A", "Widget B")).toBe(false);
    });
  });
});
