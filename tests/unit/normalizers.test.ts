import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";

import {
  parseStrictDecimal,
  parseStrictPositiveDecimal,
  normalizeWeight,
  compareWeights,
  normalizeMonetaryAmount,
  compareMonetaryAmounts,
  normalizeCurrencyCode,
  normalizePartyName,
  comparePartyNames,
  normalizeItemDescription,
  compareItemDescriptions,
  normalizePackageDetails,
  comparePackageDetails,
  DEFAULT_TOLERANCES,
} from "@/lib/normalizers";

describe("Safe Numeric & Text Normalizers (Week 4 Step 1)", () => {
  describe("1. Strict Decimal Parsing (Rules 1, 2, 3)", () => {
    it("parses valid integers, decimals, and comma-separated numeric strings", () => {
      const res1 = parseStrictDecimal("3120.00", "Total: 3120.00");
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.equals(new Decimal("3120.00"))).toBe(true);
        expect(res1.canonicalString).toBe("3120");
        expect(res1.raw).toBe("3120.00");
        expect(res1.sourceQuote).toBe("Total: 3120.00");
      }

      const res2 = parseStrictDecimal("1,234,567.89");
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.equals(new Decimal("1234567.89"))).toBe(true);
      }

      const res3 = parseStrictDecimal("3 120.50");
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.value.equals(new Decimal("3120.50"))).toBe(true);
      }
    });

    it("evaluates decimal precision exactly without IEEE 754 floating point artifacts", () => {
      const a = parseStrictDecimal("0.1");
      const b = parseStrictDecimal("0.2");
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        const sum = a.value.plus(b.value);
        expect(sum.equals(new Decimal("0.3"))).toBe(true);
        expect(sum.toString()).toBe("0.3");
      }
    });

    it("strictly rejects malformed numeric strings instead of coercing them to zero (Rule 2)", () => {
      const malformedInputs = [
        "abc",
        "12a.3",
        "12.34.56",
        "--5",
        "++5",
        "+-5",
        "1,2,3.4",
        ",120",
        "120,",
        "NaN",
        "Infinity",
        "-Infinity",
      ];

      for (const input of malformedInputs) {
        const res = parseStrictDecimal(input);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBe("MALFORMED_NUMERIC_STRING");
          expect(res.raw).toBe(input);
        }
      }
    });

    it("strictly rejects empty, null, and whitespace-only values", () => {
      expect(parseStrictDecimal(null).ok).toBe(false);
      expect(parseStrictDecimal(undefined).ok).toBe(false);
      expect(parseStrictDecimal("").ok).toBe(false);
      expect(parseStrictDecimal("   ").ok).toBe(false);
    });

    it("parseStrictPositiveDecimal rejects negative values", () => {
      const pos = parseStrictPositiveDecimal("45.5");
      expect(pos.ok).toBe(true);

      const zero = parseStrictPositiveDecimal("0");
      expect(zero.ok).toBe(true);

      const neg = parseStrictPositiveDecimal("-10.5");
      expect(neg.ok).toBe(false);
      if (!neg.ok) {
        expect(neg.error).toBe("NEGATIVE_VALUE_NOT_ALLOWED");
      }
    });
  });

  describe("2. Weight Normalization & Units (Rules 4, 5, 6)", () => {
    it("normalizes weight units only when the unit is explicit and known (Rule 4)", () => {
      const noUnit1 = normalizeWeight({ value: "3120", unit: null });
      expect(noUnit1.ok).toBe(false);
      if (!noUnit1.ok) {
        expect(noUnit1.error).toBe("MISSING_EXPLICIT_UNIT");
      }

      const noUnit2 = normalizeWeight({ value: "3120", unit: "" });
      expect(noUnit2.ok).toBe(false);
      if (!noUnit2.ok) {
        expect(noUnit2.error).toBe("MISSING_EXPLICIT_UNIT");
      }
    });

    it("supports kilograms, grams, metric tonnes, and pounds through named conversions (Rule 5)", () => {
      // Kilograms (factor 1)
      const kgRes = normalizeWeight({ value: "3120", unit: "kg" });
      expect(kgRes.ok).toBe(true);
      if (kgRes.ok) {
        expect(kgRes.weightInKg.equals(new Decimal("3120"))).toBe(true);
        expect(kgRes.unit).toBe("KG");
      }

      // Grams (divide by 1000)
      const gRes = normalizeWeight({ value: "500", unit: "g" });
      expect(gRes.ok).toBe(true);
      if (gRes.ok) {
        expect(gRes.weightInKg.equals(new Decimal("0.5"))).toBe(true);
      }

      const gmsRes = normalizeWeight({ value: "2500", unit: "grams" });
      expect(gmsRes.ok).toBe(true);
      if (gmsRes.ok) {
        expect(gmsRes.weightInKg.equals(new Decimal("2.5"))).toBe(true);
      }

      // Metric Tonnes (multiply by 1000)
      const tRes = normalizeWeight({ value: "3.165", unit: "t" });
      expect(tRes.ok).toBe(true);
      if (tRes.ok) {
        expect(tRes.weightInKg.equals(new Decimal("3165"))).toBe(true);
      }

      const mtRes = normalizeWeight({ value: "1.5", unit: "MT" });
      expect(mtRes.ok).toBe(true);
      if (mtRes.ok) {
        expect(mtRes.weightInKg.equals(new Decimal("1500"))).toBe(true);
      }

      // Pounds
      const lbRes = normalizeWeight({ value: "100", unit: "lbs" });
      expect(lbRes.ok).toBe(true);
      if (lbRes.ok) {
        expect(lbRes.weightInKg.equals(new Decimal("45.359237"))).toBe(true);
      }
    });

    it("rejects negative weights into review (Rule 6)", () => {
      const neg = normalizeWeight({ value: "-45", unit: "kg" });
      expect(neg.ok).toBe(false);
      if (!neg.ok) {
        expect(neg.error).toBe("NEGATIVE_WEIGHT");
      }
    });

    it("rejects unknown units into review (Rule 6)", () => {
      const unknownUnits = ["boxes", "liters", "meters", "xyz", "parcels"];
      for (const unit of unknownUnits) {
        const res = normalizeWeight({ value: "100", unit });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBe("UNKNOWN_WEIGHT_UNIT");
        }
      }
    });

    it("compares weights and correctly calculates SHP-24811 45 kg discrepancy without fabricating a cause", () => {
      const invoiceWeight = normalizeWeight({ value: "3120", unit: "kg" });
      const packingListWeight = normalizeWeight({ value: "3165", unit: "kg" });

      expect(invoiceWeight.ok && packingListWeight.ok).toBe(true);
      if (invoiceWeight.ok && packingListWeight.ok) {
        const comp = compareWeights(invoiceWeight, packingListWeight);
        expect(comp.isMatch).toBe(false);
        expect(comp.differenceKg.equals(new Decimal(45))).toBe(true);
        expect(comp.differenceString).toBe("45");
      }
    });
  });

  describe("3. Currency & Monetary Amounts (Rules 7, 8)", () => {
    it("keeps currency codes bound with money values (Rule 7)", () => {
      const res1 = normalizeMonetaryAmount({ amount: "12450.00", currency: "USD" });
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.amount.equals(new Decimal("12450.00"))).toBe(true);
        expect(res1.currency).toBe("USD");
        expect(res1.rawAmount).toBe("12450.00");
        expect(res1.rawCurrency).toBe("USD");
      }

      // Extracts currency from symbols
      const res2 = normalizeMonetaryAmount({ amount: "$ 5,000.50" });
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.amount.equals(new Decimal("5000.50"))).toBe(true);
        expect(res2.currency).toBe("USD");
      }

      const res3 = normalizeMonetaryAmount({ amount: "€ 420.00" });
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.amount.equals(new Decimal("420"))).toBe(true);
        expect(res3.currency).toBe("EUR");
      }
    });

    it("normalizes currency symbols and codes to canonical ISO 4217", () => {
      expect(normalizeCurrencyCode("$")).toBe("USD");
      expect(normalizeCurrencyCode("€")).toBe("EUR");
      expect(normalizeCurrencyCode("£")).toBe("GBP");
      expect(normalizeCurrencyCode("kr")).toBe("SEK");
      expect(normalizeCurrencyCode("usd")).toBe("USD");
      expect(normalizeCurrencyCode("EUR")).toBe("EUR");
      expect(normalizeCurrencyCode(null)).toBe(null);
    });

    it("rejects amounts missing a currency code (Rule 7)", () => {
      const res = normalizeMonetaryAmount({ amount: "5000.00", currency: null });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("MISSING_CURRENCY");
      }
    });

    it("never compares amounts from different currencies without an explicit conversion policy (Rule 8)", () => {
      const usdAmount = normalizeMonetaryAmount({ amount: "100.00", currency: "USD" });
      const eurAmount = normalizeMonetaryAmount({ amount: "100.00", currency: "EUR" });
      const sekAmount = normalizeMonetaryAmount({ amount: "100.00", currency: "SEK" });

      expect(usdAmount.ok && eurAmount.ok && sekAmount.ok).toBe(true);
      if (usdAmount.ok && eurAmount.ok) {
        const comp = compareMonetaryAmounts(usdAmount, eurAmount);
        expect(comp.comparable).toBe(false);
        if (!comp.comparable) {
          expect(comp.reason).toBe("CURRENCY_MISMATCH");
          expect(comp.leftCurrency).toBe("USD");
          expect(comp.rightCurrency).toBe("EUR");
        }
      }

      if (usdAmount.ok && sekAmount.ok) {
        const comp = compareMonetaryAmounts(usdAmount, sekAmount);
        expect(comp.comparable).toBe(false);
      }
    });

    it("compares identical currencies within monetary tolerance", () => {
      const a = normalizeMonetaryAmount({ amount: "100.00", currency: "USD" });
      const b = normalizeMonetaryAmount({ amount: "100.04", currency: "USD" });
      const c = normalizeMonetaryAmount({ amount: "100.10", currency: "USD" });

      expect(a.ok && b.ok && c.ok).toBe(true);
      if (a.ok && b.ok && c.ok) {
        // Difference 0.04 is within 0.05 default tolerance
        const comp1 = compareMonetaryAmounts(a, b);
        expect(comp1.comparable).toBe(true);
        if (comp1.comparable) {
          expect(comp1.isMatch).toBe(true);
          expect(comp1.difference.equals(new Decimal("0.04"))).toBe(true);
        }

        // Difference 0.10 exceeds 0.05 default tolerance
        const comp2 = compareMonetaryAmounts(a, c);
        expect(comp2.comparable).toBe(true);
        if (comp2.comparable) {
          expect(comp2.isMatch).toBe(false);
          expect(comp2.difference.equals(new Decimal("0.10"))).toBe(true);
        }
      }
    });
  });

  describe("4. Party Name Normalization (Rule 9)", () => {
    it("normalizes party names for comparison without claiming legal-name identity", () => {
      const res1 = normalizePartyName("Acme Global Logistics, Inc.");
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.normalized).toBe("acme global logistics");
        expect(res1.raw).toBe("Acme Global Logistics, Inc.");
      }

      const res2 = normalizePartyName("Nordic Valve Sweden AB");
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.normalized).toBe("nordic valve sweden");
      }
    });

    it("compares party names with similarity scoring and disclaimer", () => {
      const comp1 = comparePartyNames("Acme Logistics Ltd.", "ACME LOGISTICS LLC");
      expect(comp1.isMatch).toBe(true);
      expect(comp1.similarityScore).toBe(1.0);
      expect(comp1.legalIdentityClaimed).toBe(false);
      expect(comp1.disclaimer).toContain("does not claim legal-name identity");

      const comp2 = comparePartyNames("Shenzhen Electronics Co., Ltd.", "Guangzhou Electronics Corp");
      expect(comp2.isMatch).toBe(false);
    });

    it("rejects empty party names", () => {
      expect(normalizePartyName(null).ok).toBe(false);
      expect(normalizePartyName("   ").ok).toBe(false);
    });
  });

  describe("5. Item Description Normalization (Rule 10)", () => {
    it("normalizes item descriptions without assuming unit equivalence", () => {
      const res = normalizeItemDescription("LED Panel 600x600mm - Warm White (Model #LP-6060)");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.normalized).toContain("led panel 600x600mm warm white model lp 6060");
      }
    });

    it("compares item descriptions and flags unitEquivalenceAssumed as false", () => {
      const comp = compareItemDescriptions(
        "Industrial Ball Valve 2-inch Stainless Steel",
        "Industrial Ball Valve 2-inch (SS)",
      );
      expect(comp.unitEquivalenceAssumed).toBe(false);
      expect(comp.disclaimer).toContain("does not imply unit or quantity equivalence");
    });
  });

  describe("6. Package Count & Type Separation (Rule 11)", () => {
    it("keeps package count and package type as separate values from combined strings", () => {
      const res1 = normalizePackageDetails({ combinedInput: "24 CARTONS" });
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.count).toBe(24);
        expect(res1.packageType).toBe("CARTON");
        expect(res1.canonicalString).toBe("24 CARTON");
        expect(res1.rawCount).toBe("24");
        expect(res1.rawType).toBe("CARTONS");
      }

      const res2 = normalizePackageDetails({ combinedInput: "15 Pallets" });
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.count).toBe(15);
        expect(res2.packageType).toBe("PALLET");
      }

      const res3 = normalizePackageDetails({ countInput: 10, typeInput: "DRUMS" });
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.count).toBe(10);
        expect(res3.packageType).toBe("DRUM");
      }
    });

    it("rejects fractional or negative package counts", () => {
      const frac = normalizePackageDetails({ combinedInput: "2.5 CARTONS" });
      expect(frac.ok).toBe(false);
      if (!frac.ok) {
        expect(frac.error).toBe("FRACTIONAL_PACKAGE_COUNT_NOT_ALLOWED");
      }

      const neg = normalizePackageDetails({ combinedInput: "-5 BOXES" });
      expect(neg.ok).toBe(false);
      if (!neg.ok) {
        expect(neg.error).toBe("NEGATIVE_PACKAGE_COUNT");
      }
    });

    it("comparePackageDetails requires package types to be compatible before comparing counts", () => {
      const pkgA = normalizePackageDetails({ combinedInput: "24 CARTONS" });
      const pkgB = normalizePackageDetails({ combinedInput: "24 PALLETS" });
      const pkgC = normalizePackageDetails({ combinedInput: "24 CARTONS" });

      expect(pkgA.ok && pkgB.ok && pkgC.ok).toBe(true);
      if (pkgA.ok && pkgB.ok && pkgC.ok) {
        // Conflicting types (CARTON vs PALLET)
        const compMismatch = comparePackageDetails(pkgA, pkgB);
        expect(compMismatch.comparable).toBe(false);
        if (!compMismatch.comparable) {
          expect(compMismatch.reason).toBe("INCOMPATIBLE_PACKAGE_TYPES");
        }

        // Matching types (CARTON vs CARTON)
        const compMatch = comparePackageDetails(pkgA, pkgC);
        expect(compMatch.comparable).toBe(true);
        if (compMatch.comparable) {
          expect(compMatch.isMatch).toBe(true);
          expect(compMatch.difference).toBe(0);
        }
      }
    });
  });

  describe("7. Rule-Specific Tolerances Configuration (Rule 12)", () => {
    it("exposes configured default tolerances for monetary, weight, and similarity rules", () => {
      expect(DEFAULT_TOLERANCES.monetary.equals(new Decimal("0.05"))).toBe(true);
      expect(DEFAULT_TOLERANCES.weightKg.equals(new Decimal("0.00"))).toBe(true);
      expect(DEFAULT_TOLERANCES.quantity.equals(new Decimal("0.00"))).toBe(true);
      expect(DEFAULT_TOLERANCES.partyNameSimilarityThreshold).toBe(0.85);
      expect(DEFAULT_TOLERANCES.itemDescriptionSimilarityThreshold).toBe(0.80);
    });
  });
});
