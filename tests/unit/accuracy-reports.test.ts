import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET } from "@/app/api/reports/accuracy/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import {
  calculateAccuracyReport,
  normalizeFieldValue,
  areFieldValuesEquivalent,
  aggregateGroupMetrics,
  RawFieldRecord,
} from "@/lib/reports/accuracy";

describe("Accuracy & Supplier Reports Engine (Week 5 Step 6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Value Normalization & Equivalence (Rule 2)", () => {
    it("normalizes currency codes, dates, numbers and spaces", () => {
      // Currencies
      expect(normalizeFieldValue("currency", " usd ")).toBe("USD");
      expect(normalizeFieldValue("currency", "eur")).toBe("EUR");

      // Dates
      expect(normalizeFieldValue("issueDate", "2026-11-04T00:00:00.000Z")).toBe("2026-11-04");
      expect(normalizeFieldValue("invoiceDate", "2026-11-02")).toBe("2026-11-02");

      // Numbers
      expect(normalizeFieldValue("grossWeight", " 3,165.000 ")).toBe("3165");
      expect(normalizeFieldValue("quantity", "10.50")).toBe("10.5");
      expect(normalizeFieldValue("unitPrice", "120.00")).toBe("120");

      // Strings
      expect(normalizeFieldValue("supplier", "  Apex   Global   Supplies ")).toBe("Apex Global Supplies");
    });

    it("evaluates canonical equivalence between AI and verified values", () => {
      expect(areFieldValuesEquivalent("currency", "usd", "USD")).toBe(true);
      expect(areFieldValuesEquivalent("issueDate", "2026-11-02T12:00:00Z", "2026-11-02")).toBe(true);
      expect(areFieldValuesEquivalent("grossWeight", "3165.000", "3165")).toBe(true);
      expect(areFieldValuesEquivalent("description", "Widget A", "Widget B")).toBe(false);
      expect(areFieldValuesEquivalent("hsnCode", "8471.30", "8471.40")).toBe(false);
    });
  });

  describe("Core Metrics Calculation (Rules 1 - 7, 10)", () => {
    it("satisfies Rule 1: evaluated = AI values present and human-reviewed", () => {
      const records: RawFieldRecord[] = [
        // AI present and reviewed -> EVALUATED
        { id: "1", fieldKey: "docNo", modelValue: "INV-1", currentValue: "INV-1", reviewStatus: "CONFIRMED" },
        { id: "2", fieldKey: "docNo", modelValue: "INV-2", currentValue: "INV-2-FIX", reviewStatus: "CORRECTED", correctionsCount: 1 },
        // Unreviewed -> NOT EVALUATED (Rule 7)
        { id: "3", fieldKey: "docNo", modelValue: "INV-3", currentValue: "INV-3", reviewStatus: "PENDING" },
        { id: "4", fieldKey: "docNo", modelValue: "INV-4", currentValue: "INV-4", reviewStatus: "REQUIRES_REVIEW" },
        // Manual entry -> NOT EVALUATED (Rule 6)
        { id: "5", fieldKey: "docNo", modelValue: null, currentValue: "INV-5", reviewStatus: "MANUAL_ENTRY" },
        // Blank AI value -> NOT EVALUATED
        { id: "6", fieldKey: "docNo", modelValue: "  ", currentValue: "INV-6", reviewStatus: "CONFIRMED" },
      ];

      const metrics = aggregateGroupMetrics("docNo", "Document Number", records);

      expect(metrics.totalFields).toBe(6);
      expect(metrics.evaluated).toBe(2); // Only items 1 and 2
      expect(metrics.unreviewed).toBe(3); // Items 3, 4, 6
      expect(metrics.manualEntries).toBe(1); // Item 5
    });

    it("satisfies Rule 2, 3, 4, 5: computes accuracy and correction rates over evaluated fields", () => {
      const records: RawFieldRecord[] = [
        // 3 correct
        { id: "1", fieldKey: "curr", modelValue: "usd", currentValue: "USD", reviewStatus: "CONFIRMED" },
        { id: "2", fieldKey: "curr", modelValue: "EUR", currentValue: "EUR", reviewStatus: "CONFIRMED" },
        { id: "3", fieldKey: "curr", modelValue: "GBP", currentValue: "GBP", reviewStatus: "VERIFIED" },
        // 1 corrected
        { id: "4", fieldKey: "curr", modelValue: "JPY", currentValue: "USD", reviewStatus: "CORRECTED", correctionsCount: 1 },
        // 1 unreviewed (must not dilute or inflate denominator)
        { id: "5", fieldKey: "curr", modelValue: "CAD", currentValue: "CAD", reviewStatus: "PENDING" },
      ];

      const metrics = aggregateGroupMetrics("curr", "Currency", records);

      expect(metrics.evaluated).toBe(4);
      expect(metrics.correctAsExtracted).toBe(3);
      expect(metrics.corrected).toBe(1);
      expect(metrics.unreviewed).toBe(1);

      // Rule 3: accuracy = 3 / 4 = 75.0%
      expect(metrics.accuracy.percentage).toBe(75);
      expect(metrics.accuracy.formattedPercentage).toBe("75.0%");
      expect(metrics.accuracy.numerator).toBe(3);
      expect(metrics.accuracy.denominator).toBe(4);

      // Rule 5: correctionRate = 1 / 4 = 25.0%
      expect(metrics.correctionRate.percentage).toBe(25);
      expect(metrics.correctionRate.formattedPercentage).toBe("25.0%");
      expect(metrics.correctionRate.numerator).toBe(1);
      expect(metrics.correctionRate.denominator).toBe(4);

      // Rule 10: Numerator, denominator and sample size beside percentage
      expect(metrics.accuracy.display).toBe("75.0% (3 / 4 evaluated fields, n = 4)");
      expect(metrics.correctionRate.display).toBe("25.0% (1 / 4 evaluated fields, n = 4)");
    });

    it("satisfies Rule 6: never counts manual entries as correct AI extraction", () => {
      const records: RawFieldRecord[] = [
        { id: "1", fieldKey: "port", modelValue: null, currentValue: "INBOM", reviewStatus: "MANUAL_ENTRY" },
        { id: "2", fieldKey: "port", modelValue: "", currentValue: "USLAX", reviewStatus: "MANUAL_ENTRY" },
      ];

      const metrics = aggregateGroupMetrics("port", "Port", records);

      expect(metrics.manualEntries).toBe(2);
      expect(metrics.evaluated).toBe(0);
      expect(metrics.correctAsExtracted).toBe(0);
      expect(metrics.accuracy.percentage).toBe(0);
      expect(metrics.accuracy.denominator).toBe(0);
    });

    it("satisfies Rule 7: excludes unreviewed fields from denominator and tracks count", () => {
      const records: RawFieldRecord[] = [
        { id: "1", fieldKey: "weight", modelValue: "100", currentValue: "100", reviewStatus: "CONFIRMED" },
        { id: "2", fieldKey: "weight", modelValue: "200", currentValue: "200", reviewStatus: "REQUIRES_REVIEW" },
        { id: "3", fieldKey: "weight", modelValue: "300", currentValue: "300", reviewStatus: "PENDING" },
      ];

      const metrics = aggregateGroupMetrics("weight", "Weight", records);

      // 1 evaluated (confirmed), 2 unreviewed
      expect(metrics.totalFields).toBe(3);
      expect(metrics.evaluated).toBe(1);
      expect(metrics.unreviewed).toBe(2);
      expect(metrics.correctAsExtracted).toBe(1);
      // Accuracy should be 1/1 = 100%, NOT 1/3 = 33%
      expect(metrics.accuracy.percentage).toBe(100);
      expect(metrics.accuracy.denominator).toBe(1);
    });
  });

  describe("Grouping & Breakdown Reports (Rules 8, 9, 11, 12)", () => {
    const testFields: RawFieldRecord[] = [
      // Supplier A
      { id: "1", fieldKey: "documentNumber", modelValue: "INV-100", currentValue: "INV-100", reviewStatus: "CONFIRMED", supplierName: "Apex Supplies Ltd" },
      { id: "2", fieldKey: "grossWeight", modelValue: "500 kg", currentValue: "500", reviewStatus: "CONFIRMED", supplierName: "Apex Supplies Ltd" },
      { id: "3", fieldKey: "currency", modelValue: "EUR", currentValue: "USD", reviewStatus: "CORRECTED", correctionsCount: 1, supplierName: "Apex Supplies Ltd" },

      // Supplier B (with whitespace variation to test normalization - Rule 9)
      { id: "4", fieldKey: "documentNumber", modelValue: "INV-200", currentValue: "INV-200", reviewStatus: "CONFIRMED", supplierName: "  Global   Logistics  Co  " },
      { id: "5", fieldKey: "grossWeight", modelValue: "1200", currentValue: "1300", reviewStatus: "CORRECTED", correctionsCount: 1, supplierName: "Global Logistics Co" },
      { id: "6", fieldKey: "currency", modelValue: null, currentValue: "USD", reviewStatus: "MANUAL_ENTRY", supplierName: "Global Logistics Co" },

      // Unassigned Supplier
      { id: "7", fieldKey: "documentNumber", modelValue: "INV-300", currentValue: "INV-300", reviewStatus: "REQUIRES_REVIEW", supplierName: null },
    ];

    it("satisfies Rule 8: groups results by field key with accurate ratios", () => {
      const report = calculateAccuracyReport(testFields);

      expect(report.byFieldKey).toHaveLength(3); // documentNumber, grossWeight, currency

      const docNumberGroup = report.byFieldKey.find((g) => g.groupKey === "documentNumber");
      expect(docNumberGroup).toBeDefined();
      expect(docNumberGroup?.totalFields).toBe(3);
      expect(docNumberGroup?.evaluated).toBe(2);
      expect(docNumberGroup?.correctAsExtracted).toBe(2);
      expect(docNumberGroup?.unreviewed).toBe(1);
      expect(docNumberGroup?.accuracy.percentage).toBe(100);

      const currencyGroup = report.byFieldKey.find((g) => g.groupKey === "currency");
      expect(currencyGroup).toBeDefined();
      expect(currencyGroup?.evaluated).toBe(1);
      expect(currencyGroup?.corrected).toBe(1);
      expect(currencyGroup?.manualEntries).toBe(1);
      expect(currencyGroup?.correctionRate.percentage).toBe(100);
    });

    it("satisfies Rule 9: groups results by normalized supplier", () => {
      const report = calculateAccuracyReport(testFields);

      // Suppliers: "Apex Supplies Ltd", "Global Logistics Co" (normalized from "  Global   Logistics  Co  "), "Unassigned Supplier"
      expect(report.bySupplier.map((s) => s.groupKey)).toEqual(
        expect.arrayContaining(["Apex Supplies Ltd", "Global Logistics Co", "Unassigned Supplier"]),
      );

      const globalSupplier = report.bySupplier.find((s) => s.groupKey === "Global Logistics Co");
      expect(globalSupplier).toBeDefined();
      expect(globalSupplier?.totalFields).toBe(3);
      expect(globalSupplier?.evaluated).toBe(2); // items 4 and 5
      expect(globalSupplier?.correctAsExtracted).toBe(1);
      expect(globalSupplier?.corrected).toBe(1);
      expect(globalSupplier?.manualEntries).toBe(1);
    });

    it("satisfies Rule 11: clearly labels synthetic demo data vs labelled benchmark", () => {
      const demoReport = calculateAccuracyReport(testFields, { isLabelledBenchmark: false });
      expect(demoReport.dataset.type).toBe("SYNTHETIC_DEMO");
      expect(demoReport.dataset.isLabelledBenchmark).toBe(false);
      expect(demoReport.dataset.watermark).toContain("SYNTHETIC DEMO DATA");

      const benchmarkReport = calculateAccuracyReport(testFields, { isLabelledBenchmark: true });
      expect(benchmarkReport.dataset.type).toBe("LABELLED_BENCHMARK");
      expect(benchmarkReport.dataset.isLabelledBenchmark).toBe(true);
      expect(benchmarkReport.dataset.watermark).toBe("CLIENT PRODUCTION BENCHMARK");
    });

    it("satisfies Rule 12: does NOT claim 95% target without the client 200-shipment labelled set", () => {
      const report = calculateAccuracyReport(testFields);

      expect(report.benchmarkTarget.targetPercentage).toBe(95);
      expect(report.benchmarkTarget.targetClaimed).toBe(false);
      expect(report.benchmarkTarget.disclaimer).toMatch(/200-shipment labelled evaluation set/i);
      expect(report.benchmarkTarget.disclaimer).toMatch(/Current metrics represent real evaluated synthetic demo shipments/i);
    });
  });

  describe("API Route Integration: GET /api/reports/accuracy", () => {
    const managerUser = {
      id: "manager-uuid",
      email: "manager@cargoverity.test",
      role: "MANAGER" as const,
    };

    it("fetches active shipment fields and returns complete accuracy and supplier metrics", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: managerUser as never,
        authUser: { id: managerUser.id, email: managerUser.email } as never,
      });

      const mockShipments = [
        {
          id: "shp-1",
          reference: "SHP-001",
          supplier: { name: "Apex Ltd" },
          documents: [
            {
              docType: "INVOICE",
              isCurrent: true,
              extractionRuns: [
                {
                  status: "COMPLETED",
                  fields: [
                    {
                      id: "f-1",
                      fieldKey: "documentNumber",
                      modelValue: "INV-101",
                      currentValue: "INV-101",
                      reviewStatus: "CONFIRMED",
                      corrections: [],
                    },
                    {
                      id: "f-2",
                      fieldKey: "grossWeight",
                      modelValue: "500",
                      currentValue: "550",
                      reviewStatus: "CORRECTED",
                      corrections: [{ id: "c-1", previousValue: "500", newValue: "550", reason: "Typo" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const mockPrisma = {
        shipment: { findMany: vi.fn().mockResolvedValue(mockShipments) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/reports/accuracy");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.summary.totalFields).toBe(2);
      expect(json.summary.evaluated).toBe(2);
      expect(json.summary.correctAsExtracted).toBe(1);
      expect(json.summary.corrected).toBe(1);
      expect(json.summary.accuracy.percentage).toBe(50);
      expect(json.summary.accuracy.display).toBe("50.0% (1 / 2 evaluated fields, n = 2)");

      expect(json.byFieldKey).toHaveLength(2);
      expect(json.bySupplier).toHaveLength(1);
      expect(json.bySupplier[0].groupKey).toBe("Apex Ltd");
      expect(json.dataset.type).toBe("SYNTHETIC_DEMO");
      expect(json.benchmarkTarget.targetClaimed).toBe(false);
    });
  });
});

