import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  checkGrossNetSanity,
  checkGrossWeight,
  checkPackageCount,
} from "@/lib/crosschecks/weight-package-checks";

describe("Gross Weight Cross-Check (Week 4 Step 3 - CHK_GROSS_WEIGHT)", () => {
  it("detects the SHP-24811 fixture 45 kg mismatch without fabricating an explanation", () => {
    // SHP-24811 brief fact: CI 3,120 kg vs PL 3,165 kg (45 kg difference)
    const result = checkGrossWeight({
      candidates: [
        { documentType: "INVOICE", fieldId: "inv-gross", value: "3120", unit: "kg", sourceQuote: "Gross: 3,120 kg" },
        { documentType: "PACKING_LIST", fieldId: "pl-gross", value: "3165", unit: "kg", sourceQuote: "G.W.: 3,165 kg" },
        { documentType: "BILL_OF_LADING", fieldId: "bl-gross", value: null, unit: null },
      ],
      requiredDocuments: ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"],
      toleranceKg: "0.00",
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.details.differenceKg).toBe("45.000");
    expect(result.details.missingDocuments).toContain("BILL_OF_LADING");
    expect(result.details.comparedValuesKg.INVOICE).toBe("3120.000");
    expect(result.details.comparedValuesKg.PACKING_LIST).toBe("3165.000");
    expect(result.details.sourceFieldIds.INVOICE).toBe("inv-gross");
    expect(result.details.sourceFieldIds.PACKING_LIST).toBe("pl-gross");

    // Must preserve cause as unstated rather than inventing reasons like packaging/loss
    expect(result.details.note).toContain("Available documents differ by 45.000 kg");
    expect(result.details.note).toContain("Cause is not stated in source documents");
  });

  it("passes when all documents match across compatible units (t, kg, g)", () => {
    const result = checkGrossWeight({
      candidates: [
        { documentType: "INVOICE", value: "3.12", unit: "t" }, // 3,120 kg
        { documentType: "PACKING_LIST", value: "3120", unit: "kg" }, // 3,120 kg
        { documentType: "BILL_OF_LADING", value: "3120000", unit: "g" }, // 3,120 kg
      ],
      requiredDocuments: ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.differenceKg).toBe("0.000");
    expect(result.details.comparedValuesKg.INVOICE).toBe("3120.000");
    expect(result.details.comparedValuesKg.PACKING_LIST).toBe("3120.000");
    expect(result.details.comparedValuesKg.BILL_OF_LADING).toBe("3120.000");
    expect(result.details.missingDocuments).toHaveLength(0);
  });

  it("does not claim a complete pass when BL is missing but required by policy", () => {
    const result = checkGrossWeight({
      candidates: [
        { documentType: "INVOICE", value: "3120", unit: "kg" },
        { documentType: "PACKING_LIST", value: "3120", unit: "kg" },
        { documentType: "BILL_OF_LADING", value: null, unit: null },
      ],
      requiredDocuments: ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"],
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.details.differenceKg).toBe("0.000");
    expect(result.details.missingDocuments).toEqual(["BILL_OF_LADING"]);
    expect(result.details.note).toContain("missing gross weight");
  });

  it("does not treat an absent optional Invoice weight as a mismatch when PL and BL match", () => {
    const result = checkGrossWeight({
      candidates: [
        { documentType: "INVOICE", value: null, unit: null }, // Optional
        { documentType: "PACKING_LIST", value: "2450.50", unit: "kg" },
        { documentType: "BILL_OF_LADING", value: "2450.50", unit: "kg" },
      ],
      requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"], // PL and BL required
    });

    expect(result.status).toBe("PASS");
    expect(result.details.differenceKg).toBe("0.000");
    expect(result.details.missingDocuments).toHaveLength(0);
  });

  it("respects configured weight tolerance", () => {
    const withinTolerance = checkGrossWeight({
      candidates: [
        { documentType: "PACKING_LIST", value: "1000.02", unit: "kg" },
        { documentType: "BILL_OF_LADING", value: "1000.00", unit: "kg" },
      ],
      toleranceKg: new Decimal("0.05"),
    });

    expect(withinTolerance.status).toBe("PASS");
    expect(withinTolerance.details.differenceKg).toBe("0.020");

    const exceedsTolerance = checkGrossWeight({
      candidates: [
        { documentType: "PACKING_LIST", value: "1000.08", unit: "kg" },
        { documentType: "BILL_OF_LADING", value: "1000.00", unit: "kg" },
      ],
      toleranceKg: new Decimal("0.05"),
    });

    expect(exceedsTolerance.status).toBe("MISMATCH");
    expect(exceedsTolerance.details.differenceKg).toBe("0.080");
  });

  it("returns INCOMPLETE when candidate has an unknown unit or negative weight", () => {
    const invalidUnit = checkGrossWeight({
      candidates: [
        { documentType: "PACKING_LIST", value: "1000", unit: "stones" }, // unknown unit
        { documentType: "BILL_OF_LADING", value: "1000", unit: "kg" },
      ],
    });

    expect(invalidUnit.status).toBe("INCOMPLETE");
    expect(invalidUnit.details.invalidDocuments).toHaveLength(1);
    expect(invalidUnit.details.invalidDocuments[0].error).toBe("UNKNOWN_WEIGHT_UNIT");
  });
});

describe("Gross vs Net Weight Sanity Check (Week 4 Step 3 - CHK_GROSS_NET_SANITY)", () => {
  it("passes when gross weight is greater than net weight and reports packaging tare", () => {
    const result = checkGrossNetSanity({
      grossWeight: { id: "gw-1", value: "3165", unit: "kg" },
      netWeight: { id: "nw-1", value: "3000", unit: "kg" },
      documentType: "PACKING_LIST",
    });

    expect(result.status).toBe("PASS");
    expect(result.details.grossWeightKg).toBe("3165.000");
    expect(result.details.netWeightKg).toBe("3000.000");
    expect(result.details.differenceKg).toBe("165.000"); // Tare weight
    expect(result.details.sourceFieldIds.grossWeightFieldId).toBe("gw-1");
    expect(result.details.sourceFieldIds.netWeightFieldId).toBe("nw-1");
    expect(result.details.message).toContain("Implied packaging/tare: 165.000 kg");
  });

  it("passes when gross weight equals net weight (e.g. bulk raw commodities)", () => {
    const result = checkGrossNetSanity({
      grossWeight: { value: "5000", unit: "kg" },
      netWeight: { value: "5000", unit: "kg" },
    });

    expect(result.status).toBe("PASS");
    expect(result.details.differenceKg).toBe("0.000");
  });

  it("compares gross and net across different compatible units (e.g. tonnes vs kilograms)", () => {
    const result = checkGrossNetSanity({
      grossWeight: { value: "5", unit: "t" }, // 5,000 kg
      netWeight: { value: "4800", unit: "kg" }, // 4,800 kg
    });

    expect(result.status).toBe("PASS");
    expect(result.details.differenceKg).toBe("200.000");
  });

  it("returns MISMATCH when gross weight is strictly less than net weight", () => {
    const result = checkGrossNetSanity({
      grossWeight: { value: "45", unit: "kg" },
      netWeight: { value: "50", unit: "kg" },
      documentType: "PACKING_LIST",
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.details.grossWeightKg).toBe("45.000");
    expect(result.details.netWeightKg).toBe("50.000");
    expect(result.details.differenceKg).toBe("5.000");
    expect(result.details.message).toContain("cannot be less than declared net weight");
  });

  it("returns INCOMPLETE when either gross or net weight is missing", () => {
    const missingNet = checkGrossNetSanity({
      grossWeight: { value: "1000", unit: "kg" },
      netWeight: null,
    });

    expect(missingNet.status).toBe("INCOMPLETE");
    expect(missingNet.details.unreconciledReason).toBe("MISSING_COMPARATIVE_WEIGHT");
  });
});

describe("Package Count Cross-Check (Week 4 Step 3 - CHK_PACKAGE_COUNT)", () => {
  it("passes when Packing List and Bill of Lading package counts and types match", () => {
    const result = checkPackageCount({
      candidates: [
        { documentType: "PACKING_LIST", fieldId: "pl-pkg", value: "120", packageType: "Cartons" },
        { documentType: "BILL_OF_LADING", fieldId: "bl-pkg", value: "120", packageType: "CTNS" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.countsMatch).toBe(true);
    expect(result.details.typesCompatible).toBe(true);
    expect(result.details.difference).toBe(0);
    expect(result.details.sourceFieldIds.PACKING_LIST).toBe("pl-pkg");
    expect(result.details.sourceFieldIds.BILL_OF_LADING).toBe("bl-pkg");
  });

  it("detects package count difference between Packing List and Bill of Lading", () => {
    const result = checkPackageCount({
      candidates: [
        { documentType: "PACKING_LIST", value: "120", packageType: "Cartons" },
        { documentType: "BILL_OF_LADING", value: "115", packageType: "Cartons" },
      ],
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.details.countsMatch).toBe(false);
    expect(result.details.difference).toBe(5);
    expect(result.details.note).toContain("differ across documents");
    expect(result.details.note).toContain("Cause is not stated in source documents");
  });

  it("rejects incompatible package types as MISMATCH (e.g. 120 Cartons != 120 Pallets)", () => {
    const result = checkPackageCount({
      candidates: [
        { documentType: "PACKING_LIST", value: "120", packageType: "Cartons" },
        { documentType: "BILL_OF_LADING", value: "120", packageType: "Pallets" },
      ],
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.details.typesCompatible).toBe(false);
    expect(result.details.unreconciledReason).toBe("INCOMPATIBLE_PACKAGE_TYPES");
    expect(result.details.note).toContain("Package types are incompatible across documents");
    expect(result.details.note).toContain("Count equivalence cannot be assumed without human review");
  });

  it("includes Invoice package count only when explicitly present and verifies consistency", () => {
    // 1. Invoice package count explicitly present and matches
    const matchingInvoice = checkPackageCount({
      candidates: [
        { documentType: "INVOICE", value: "120", packageType: "Cartons" },
        { documentType: "PACKING_LIST", value: "120", packageType: "Cartons" },
        { documentType: "BILL_OF_LADING", value: "120", packageType: "Cartons" },
      ],
    });
    expect(matchingInvoice.status).toBe("PASS");
    expect(matchingInvoice.details.values).toHaveLength(3);

    // 2. Invoice package count absent: does not cause mismatch or missing warning
    const absentInvoice = checkPackageCount({
      candidates: [
        { documentType: "INVOICE", value: null, packageType: null }, // Absent
        { documentType: "PACKING_LIST", value: "120", packageType: "Cartons" },
        { documentType: "BILL_OF_LADING", value: "120", packageType: "Cartons" },
      ],
    });
    expect(absentInvoice.status).toBe("PASS");
    expect(absentInvoice.details.values).toHaveLength(2);

    // 3. Invoice package count explicitly present and contradicts PL
    const contradictingInvoice = checkPackageCount({
      candidates: [
        { documentType: "INVOICE", value: "100", packageType: "Cartons" },
        { documentType: "PACKING_LIST", value: "120", packageType: "Cartons" },
        { documentType: "BILL_OF_LADING", value: "120", packageType: "Cartons" },
      ],
    });
    expect(contradictingInvoice.status).toBe("MISMATCH");
    expect(contradictingInvoice.details.difference).toBe(20);
  });

  it("returns INCOMPLETE when BL package count is missing", () => {
    const missingBL = checkPackageCount({
      candidates: [
        { documentType: "PACKING_LIST", value: "50", packageType: "Boxes" },
        { documentType: "BILL_OF_LADING", value: null },
      ],
    });

    expect(missingBL.status).toBe("INCOMPLETE");
    expect(missingBL.details.missingDocuments).toEqual(["BILL_OF_LADING"]);
    expect(missingBL.details.unreconciledReason).toBe("MISSING_REQUIRED_DOCUMENT_PACKAGE_COUNT");
  });

  it("returns INCOMPLETE when package count is fractional or malformed", () => {
    const fractional = checkPackageCount({
      candidates: [
        { documentType: "PACKING_LIST", value: "12.5", packageType: "Cartons" }, // fractional not allowed
        { documentType: "BILL_OF_LADING", value: "12", packageType: "Cartons" },
      ],
    });

    expect(fractional.status).toBe("INCOMPLETE");
    expect(fractional.details.invalidDocuments).toHaveLength(1);
    expect(fractional.details.invalidDocuments[0].error).toBe("FRACTIONAL_PACKAGE_COUNT_NOT_ALLOWED");
  });
});

