import Decimal from "decimal.js";
import { normalizeWeight } from "@/lib/normalizers/weight";
import {
  comparePackageDetails,
  normalizePackageDetails,
} from "@/lib/normalizers/package";
import { DEFAULT_TOLERANCES } from "@/lib/normalizers/tolerances";

export type CrossCheckDocType = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";

export type WeightFieldCandidate = {
  documentType: CrossCheckDocType;
  fieldId?: string;
  value: string | number | null | undefined;
  unit: string | null | undefined;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type GrossWeightCheckInput = {
  candidates: WeightFieldCandidate[];
  requiredDocuments?: CrossCheckDocType[];
  toleranceKg?: Decimal | number | string;
};

export type GrossWeightComparedValue = {
  documentType: CrossCheckDocType;
  rawValue: string;
  rawUnit: string | null;
  normalizedKg: string;
  fieldId?: string;
  sourceQuote?: string | null;
};

export type GrossWeightInvalidValue = {
  documentType: CrossCheckDocType;
  fieldId?: string;
  error: string;
  rawValue: string;
  rawUnit: string | null;
  sourceQuote?: string | null;
};

export type GrossWeightCheckResult = {
  ruleKey: "gross_weight_comparison";
  ruleCode: "CHK_GROSS_WEIGHT";
  status: "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
  details: {
    comparedValuesKg: Partial<Record<CrossCheckDocType, string>>;
    values: GrossWeightComparedValue[];
    missingDocuments: CrossCheckDocType[];
    invalidDocuments: GrossWeightInvalidValue[];
    differenceKg: string | null;
    toleranceKg: string;
    sourceFieldIds: Partial<Record<CrossCheckDocType, string>>;
    note: string;
    message: string;
  };
};

/**
 * Week 4 Step 3: Implement Gross Weight Cross-Check (CHK_GROSS_WEIGHT)
 *
 * 1. Gathers all available gross-weight values by document (INVOICE, PACKING_LIST, BILL_OF_LADING).
 * 2. Normalizes compatible units to standard Kilograms (KG).
 * 3. Compares all available applicable values.
 * 4. Returns MISMATCH when available values differ beyond tolerance (e.g. SHP-24811: 45 kg diff).
 * 5. Returns INCOMPLETE when policy requires an unavailable mandatory value (and no mismatch detected).
 * 6. Does not treat an absent optional Invoice weight as a mismatch.
 * 7. Preserves source cause as unknown when documents do not explain it (never fabricates a cause).
 * 8. Retains source field IDs for UI provenance and review highlighting.
 */
export function checkGrossWeight(
  input: GrossWeightCheckInput,
): GrossWeightCheckResult {
  const tolerance =
    input.toleranceKg !== undefined
      ? typeof input.toleranceKg === "number"
        ? new Decimal(input.toleranceKg)
        : new Decimal(String(input.toleranceKg))
      : DEFAULT_TOLERANCES.weightKg;

  const requiredDocuments = input.requiredDocuments ?? ["PACKING_LIST", "BILL_OF_LADING"];

  const byType = new Map<CrossCheckDocType, WeightFieldCandidate>();
  for (const candidate of input.candidates) {
    byType.set(candidate.documentType, candidate);
  }

  const sourceFieldIds: Partial<Record<CrossCheckDocType, string>> = {};
  for (const candidate of input.candidates) {
    if (candidate.fieldId) {
      sourceFieldIds[candidate.documentType] = candidate.fieldId;
    }
  }

  const comparedValuesKg: Partial<Record<CrossCheckDocType, string>> = {};
  const values: GrossWeightComparedValue[] = [];
  const validWeights: Array<{
    documentType: CrossCheckDocType;
    kg: Decimal;
    candidate: WeightFieldCandidate;
  }> = [];
  const missingDocuments: CrossCheckDocType[] = [];
  const invalidDocuments: GrossWeightInvalidValue[] = [];

  // Check required documents for presence
  for (const reqDoc of requiredDocuments) {
    const candidate = byType.get(reqDoc);
    if (
      !candidate ||
      candidate.value === null ||
      candidate.value === undefined ||
      String(candidate.value).trim() === ""
    ) {
      missingDocuments.push(reqDoc);
    }
  }

  // Normalize all available candidates
  for (const candidate of input.candidates) {
    if (
      candidate.value === null ||
      candidate.value === undefined ||
      String(candidate.value).trim() === ""
    ) {
      continue;
    }

    const norm = normalizeWeight({
      value: candidate.value,
      unit: candidate.unit,
      sourceQuote: candidate.sourceQuote,
    });

    if (norm.ok) {
      const kgStr = norm.weightInKg.toFixed(3);
      comparedValuesKg[candidate.documentType] = kgStr;
      validWeights.push({
        documentType: candidate.documentType,
        kg: norm.weightInKg,
        candidate,
      });
      values.push({
        documentType: candidate.documentType,
        rawValue: norm.rawValue,
        rawUnit: norm.rawUnit,
        normalizedKg: kgStr,
        fieldId: candidate.fieldId,
        sourceQuote: candidate.sourceQuote,
      });
    } else {
      invalidDocuments.push({
        documentType: candidate.documentType,
        fieldId: candidate.fieldId,
        error: norm.error,
        rawValue: norm.rawValue,
        rawUnit: norm.rawUnit ?? null,
        sourceQuote: candidate.sourceQuote,
      });
    }
  }

  // Status Evaluation
  // Case A: 2 or more valid comparable weights
  if (validWeights.length >= 2) {
    const maxKg = Decimal.max(...validWeights.map((w) => w.kg));
    const minKg = Decimal.min(...validWeights.map((w) => w.kg));
    const diff = maxKg.minus(minKg);
    const diffKgStr = diff.toFixed(3);

    // Rule 4: Return known mismatch when available values differ beyond tolerance
    if (diff.greaterThan(tolerance)) {
      const breakdown = validWeights
        .map((w) => `${w.documentType}: ${w.kg.toFixed(3)} kg`)
        .join(", ");
      const note = `Available documents differ by ${diffKgStr} kg (${breakdown}). Cause is not stated in source documents.`;

      return {
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        status: "MISMATCH",
        details: {
          comparedValuesKg,
          values,
          missingDocuments,
          invalidDocuments,
          differenceKg: diffKgStr,
          toleranceKg: tolerance.toString(),
          sourceFieldIds,
          note,
          message: note,
        },
      };
    }

    // Available values agree within tolerance
    if (missingDocuments.length > 0) {
      const note = `Available gross weights match within tolerance (${diffKgStr} kg difference), but required document(s) (${missingDocuments.join(
        ", ",
      )}) are missing gross weight.`;
      return {
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        status: "INCOMPLETE",
        details: {
          comparedValuesKg,
          values,
          missingDocuments,
          invalidDocuments,
          differenceKg: diffKgStr,
          toleranceKg: tolerance.toString(),
          sourceFieldIds,
          note,
          message: note,
        },
      };
    }

    if (invalidDocuments.length > 0) {
      const note = `Available gross weights match, but document(s) (${invalidDocuments
        .map((d) => d.documentType)
        .join(", ")}) have invalid weight or unit.`;
      return {
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        status: "INCOMPLETE",
        details: {
          comparedValuesKg,
          values,
          missingDocuments,
          invalidDocuments,
          differenceKg: diffKgStr,
          toleranceKg: tolerance.toString(),
          sourceFieldIds,
          note,
          message: note,
        },
      };
    }

    const note = `All applicable gross-weight values match within configured tolerance (${diffKgStr} kg difference).`;
    return {
      ruleKey: "gross_weight_comparison",
      ruleCode: "CHK_GROSS_WEIGHT",
      status: "PASS",
      details: {
        comparedValuesKg,
        values,
        missingDocuments,
        invalidDocuments,
        differenceKg: diffKgStr,
        toleranceKg: tolerance.toString(),
        sourceFieldIds,
        note,
        message: note,
      },
    };
  }

  // Case B: Fewer than 2 valid comparable weights
  const providedCount = input.candidates.filter(
    (c) =>
      c.value !== null &&
      c.value !== undefined &&
      String(c.value).trim().length > 0,
  ).length;

  if (providedCount === 0) {
    const status = input.candidates.length === 0 ? "NOT_APPLICABLE" : "INCOMPLETE";
    const note = "Gross weight values are unavailable to compare.";
    return {
      ruleKey: "gross_weight_comparison",
      ruleCode: "CHK_GROSS_WEIGHT",
      status,
      details: {
        comparedValuesKg,
        values,
        missingDocuments,
        invalidDocuments,
        differenceKg: null,
        toleranceKg: tolerance.toString(),
        sourceFieldIds,
        note,
        message: note,
      },
    };
  }

  const note = "At least two comparable gross-weight values are required to reconcile gross weights.";
  return {
    ruleKey: "gross_weight_comparison",
    ruleCode: "CHK_GROSS_WEIGHT",
    status: "INCOMPLETE",
    details: {
      comparedValuesKg,
      values,
      missingDocuments,
      invalidDocuments,
      differenceKg: null,
      toleranceKg: tolerance.toString(),
      sourceFieldIds,
      note,
      message: note,
    },
  };
}

export type WeightFieldInput = {
  id?: string;
  value: string | number | null | undefined;
  unit: string | null | undefined;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type GrossNetSanityInput = {
  grossWeight?: WeightFieldInput | null;
  netWeight?: WeightFieldInput | null;
  documentType?: CrossCheckDocType;
};

export type GrossNetSanityResult = {
  ruleKey: "gross_weight_vs_net_weight";
  ruleCode: "CHK_GROSS_NET_SANITY";
  status: "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
  details: {
    documentType: CrossCheckDocType;
    grossWeight: string | null;
    netWeight: string | null;
    grossWeightKg: string | null;
    netWeightKg: string | null;
    differenceKg: string | null;
    sourceFieldIds: {
      grossWeightFieldId?: string;
      netWeightFieldId?: string;
    };
    unreconciledReason?: string;
    note: string;
    message: string;
  };
};

/**
 * Week 4 Step 3: Implement Gross vs Net Sanity Check (CHK_GROSS_NET_SANITY)
 *
 * 1. Verifies that Gross Weight >= Net Weight on the same document (default: PACKING_LIST).
 * 2. Normalizes both weights to standard kilograms (KG) before comparison.
 * 3. Returns INCOMPLETE if either weight is missing, malformed, or has an unknown unit.
 * 4. Returns MISMATCH if Gross Weight is strictly less than Net Weight.
 * 5. Returns PASS when Gross Weight >= Net Weight, reporting the tare/packaging weight.
 * 6. Preserves source field IDs for provenance and UI highlighting.
 */
export function checkGrossNetSanity(
  input: GrossNetSanityInput,
): GrossNetSanityResult {
  const documentType = input.documentType ?? "PACKING_LIST";
  const sourceFieldIds = {
    grossWeightFieldId: input.grossWeight?.id,
    netWeightFieldId: input.netWeight?.id,
  };

  const hasGross =
    input.grossWeight?.value !== null &&
    input.grossWeight?.value !== undefined &&
    String(input.grossWeight.value).trim().length > 0;

  const hasNet =
    input.netWeight?.value !== null &&
    input.netWeight?.value !== undefined &&
    String(input.netWeight.value).trim().length > 0;

  if (!hasGross && !hasNet) {
    const note = `Neither gross weight nor net weight is present on ${documentType}.`;
    return {
      ruleKey: "gross_weight_vs_net_weight",
      ruleCode: "CHK_GROSS_NET_SANITY",
      status: "INCOMPLETE",
      details: {
        documentType,
        grossWeight: null,
        netWeight: null,
        grossWeightKg: null,
        netWeightKg: null,
        differenceKg: null,
        sourceFieldIds,
        unreconciledReason: "MISSING_WEIGHT_VALUES",
        note,
        message: note,
      },
    };
  }

  if (!hasGross || !hasNet) {
    const missing = !hasGross ? "gross weight" : "net weight";
    const note = `Both gross weight and net weight are required on ${documentType} to verify sanity (gross ≥ net). Missing ${missing}.`;
    return {
      ruleKey: "gross_weight_vs_net_weight",
      ruleCode: "CHK_GROSS_NET_SANITY",
      status: "INCOMPLETE",
      details: {
        documentType,
        grossWeight: hasGross ? String(input.grossWeight?.value) : null,
        netWeight: hasNet ? String(input.netWeight?.value) : null,
        grossWeightKg: null,
        netWeightKg: null,
        differenceKg: null,
        sourceFieldIds,
        unreconciledReason: "MISSING_COMPARATIVE_WEIGHT",
        note,
        message: note,
      },
    };
  }

  // Normalize Gross Weight
  const normGross = normalizeWeight({
    value: input.grossWeight?.value,
    unit: input.grossWeight?.unit,
    sourceQuote: input.grossWeight?.sourceQuote,
  });

  // Normalize Net Weight
  const normNet = normalizeWeight({
    value: input.netWeight?.value,
    unit: input.netWeight?.unit,
    sourceQuote: input.netWeight?.sourceQuote,
  });

  if (!normGross.ok || !normNet.ok) {
    const failureReason = !normGross.ok
      ? `Gross weight: ${normGross.error}`
      : !normNet.ok
        ? `Net weight: ${normNet.error}`
        : "Weight normalization failed";
    const note = `Weight normalization failed on ${documentType} (${failureReason}).`;
    return {
      ruleKey: "gross_weight_vs_net_weight",
      ruleCode: "CHK_GROSS_NET_SANITY",
      status: "INCOMPLETE",
      details: {
        documentType,
        grossWeight: String(input.grossWeight?.value),
        netWeight: String(input.netWeight?.value),
        grossWeightKg: normGross.ok ? normGross.weightInKg.toFixed(3) : null,
        netWeightKg: normNet.ok ? normNet.weightInKg.toFixed(3) : null,
        differenceKg: null,
        sourceFieldIds,
        unreconciledReason: "INVALID_WEIGHT_UNIT_OR_VALUE",
        note,
        message: note,
      },
    };
  }

  const grossKg = normGross.weightInKg;
  const netKg = normNet.weightInKg;
  const grossKgStr = grossKg.toFixed(3);
  const netKgStr = netKg.toFixed(3);

  if (grossKg.greaterThanOrEqualTo(netKg)) {
    const tareKg = grossKg.minus(netKg).toFixed(3);
    const note = `Gross weight (${grossKgStr} kg) is greater than or equal to net weight (${netKgStr} kg) on ${documentType}. Implied packaging/tare: ${tareKg} kg.`;
    return {
      ruleKey: "gross_weight_vs_net_weight",
      ruleCode: "CHK_GROSS_NET_SANITY",
      status: "PASS",
      details: {
        documentType,
        grossWeight: String(input.grossWeight?.value),
        netWeight: String(input.netWeight?.value),
        grossWeightKg: grossKgStr,
        netWeightKg: netKgStr,
        differenceKg: tareKg,
        sourceFieldIds,
        note,
        message: note,
      },
    };
  }

  const deficitKg = netKg.minus(grossKg).toFixed(3);
  const note = `Weight sanity check failed on ${documentType}: Gross weight (${grossKgStr} kg) cannot be less than declared net weight (${netKgStr} kg) (deficiency: ${deficitKg} kg).`;
  return {
    ruleKey: "gross_weight_vs_net_weight",
    ruleCode: "CHK_GROSS_NET_SANITY",
    status: "MISMATCH",
    details: {
      documentType,
      grossWeight: String(input.grossWeight?.value),
      netWeight: String(input.netWeight?.value),
      grossWeightKg: grossKgStr,
      netWeightKg: netKgStr,
      differenceKg: deficitKg,
      sourceFieldIds,
      note,
      message: note,
    },
  };
}

export type PackageCandidate = {
  documentType: CrossCheckDocType;
  fieldId?: string;
  value: string | number | null | undefined;
  packageType?: string | null | undefined;
  unit?: string | null | undefined;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type PackageCountCheckInput = {
  candidates: PackageCandidate[];
  requiredDocuments?: CrossCheckDocType[];
};

export type PackageComparedValue = {
  documentType: CrossCheckDocType;
  count: number;
  packageType: string | null;
  canonicalString: string;
  rawCount: string;
  rawType: string | null;
  fieldId?: string;
  sourceQuote?: string | null;
};

export type PackageInvalidValue = {
  documentType: CrossCheckDocType;
  fieldId?: string;
  error: string;
  rawValue: string;
  sourceQuote?: string | null;
};

export type PackageCountCheckResult = {
  ruleKey: "package_count_comparison";
  ruleCode: "CHK_PACKAGE_COUNT";
  status: "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
  details: {
    values: PackageComparedValue[];
    missingDocuments: CrossCheckDocType[];
    invalidDocuments: PackageInvalidValue[];
    countsMatch: boolean;
    typesCompatible: boolean;
    difference: number | null;
    sourceFieldIds: Partial<Record<CrossCheckDocType, string>>;
    unreconciledReason?: string;
    note: string;
    message: string;
  };
};

/**
 * Week 4 Step 3: Implement Package Count Check (CHK_PACKAGE_COUNT)
 *
 * 1. Compares Packing List and Bill of Lading package counts.
 * 2. Includes Invoice package count only when explicitly present.
 * 3. Requires package types to be compatible before comparing counts (e.g. 120 Cartons != 120 Pallets).
 * 4. Returns explicit source values, units, missing documents, and difference.
 * 5. Preserves source cause as unknown when documents do not explain it.
 * 6. Retains source field IDs for UI provenance.
 */
export function checkPackageCount(
  input: PackageCountCheckInput,
): PackageCountCheckResult {
  const requiredDocuments = input.requiredDocuments ?? [
    "PACKING_LIST",
    "BILL_OF_LADING",
  ];

  const byType = new Map<CrossCheckDocType, PackageCandidate>();
  for (const candidate of input.candidates) {
    byType.set(candidate.documentType, candidate);
  }

  const sourceFieldIds: Partial<Record<CrossCheckDocType, string>> = {};
  for (const candidate of input.candidates) {
    if (candidate.fieldId) {
      sourceFieldIds[candidate.documentType] = candidate.fieldId;
    }
  }

  const missingDocuments: CrossCheckDocType[] = [];
  const invalidDocuments: PackageInvalidValue[] = [];
  const validCandidates: PackageComparedValue[] = [];

  // Check required documents for presence
  for (const reqDoc of requiredDocuments) {
    const candidate = byType.get(reqDoc);
    if (
      !candidate ||
      candidate.value === null ||
      candidate.value === undefined ||
      String(candidate.value).trim() === ""
    ) {
      missingDocuments.push(reqDoc);
    }
  }

  // Parse and normalize all available candidates
  for (const candidate of input.candidates) {
    if (
      candidate.value === null ||
      candidate.value === undefined ||
      String(candidate.value).trim() === ""
    ) {
      continue;
    }

    const norm = normalizePackageDetails({
      countInput: candidate.value,
      typeInput: candidate.packageType ?? candidate.unit,
      combinedInput: typeof candidate.value === "string" ? candidate.value : null,
      sourceQuote: candidate.sourceQuote,
    });

    if (norm.ok) {
      validCandidates.push({
        documentType: candidate.documentType,
        count: norm.count,
        packageType: norm.packageType,
        canonicalString: norm.canonicalString,
        rawCount: norm.rawCount,
        rawType: norm.rawType,
        fieldId: candidate.fieldId,
        sourceQuote: candidate.sourceQuote,
      });
    } else {
      invalidDocuments.push({
        documentType: candidate.documentType,
        fieldId: candidate.fieldId,
        error: norm.error,
        rawValue: norm.raw,
        sourceQuote: candidate.sourceQuote,
      });
    }
  }

  // Status Evaluation
  // Case A: At least 2 valid candidates
  if (validCandidates.length >= 2) {
    // Check package type compatibility across all candidate pairs
    let typesCompatible = true;
    let incompatiblePair: [PackageComparedValue, PackageComparedValue] | null =
      null;

    for (let i = 0; i < validCandidates.length; i += 1) {
      for (let j = i + 1; j < validCandidates.length; j += 1) {
        const leftSuccess = {
          ok: true as const,
          count: validCandidates[i].count,
          packageType: validCandidates[i].packageType,
          canonicalString: validCandidates[i].canonicalString,
          rawCount: validCandidates[i].rawCount,
          rawType: validCandidates[i].rawType,
          raw: validCandidates[i].canonicalString,
        };
        const rightSuccess = {
          ok: true as const,
          count: validCandidates[j].count,
          packageType: validCandidates[j].packageType,
          canonicalString: validCandidates[j].canonicalString,
          rawCount: validCandidates[j].rawCount,
          rawType: validCandidates[j].rawType,
          raw: validCandidates[j].canonicalString,
        };

        const comparison = comparePackageDetails(leftSuccess, rightSuccess);
        if (!comparison.comparable) {
          typesCompatible = false;
          incompatiblePair = [validCandidates[i], validCandidates[j]];
          break;
        }
      }
      if (!typesCompatible) break;
    }

    // Incompatible package types
    if (!typesCompatible && incompatiblePair) {
      const note = `Package types are incompatible across documents: ${incompatiblePair[0].documentType} states '${incompatiblePair[0].packageType}', but ${incompatiblePair[1].documentType} states '${incompatiblePair[1].packageType}'. Count equivalence cannot be assumed without human review.`;
      return {
        ruleKey: "package_count_comparison",
        ruleCode: "CHK_PACKAGE_COUNT",
        status: "MISMATCH",
        details: {
          values: validCandidates,
          missingDocuments,
          invalidDocuments,
          countsMatch: false,
          typesCompatible: false,
          difference: Math.abs(incompatiblePair[0].count - incompatiblePair[1].count),
          sourceFieldIds,
          unreconciledReason: "INCOMPATIBLE_PACKAGE_TYPES",
          note,
          message: note,
        },
      };
    }

    // Types are compatible; check counts
    const counts = validCandidates.map((c) => c.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const difference = maxCount - minCount;
    const countsMatch = difference === 0;

    if (!countsMatch) {
      const breakdown = validCandidates
        .map((c) => `${c.documentType}: ${c.canonicalString}`)
        .join(", ");
      const note = `Package counts differ across documents: ${breakdown} (difference: ${difference}). Cause is not stated in source documents.`;
      return {
        ruleKey: "package_count_comparison",
        ruleCode: "CHK_PACKAGE_COUNT",
        status: "MISMATCH",
        details: {
          values: validCandidates,
          missingDocuments,
          invalidDocuments,
          countsMatch: false,
          typesCompatible: true,
          difference,
          sourceFieldIds,
          note,
          message: note,
        },
      };
    }

    // Counts match
    if (missingDocuments.length > 0) {
      const note = `Available package counts match (${validCandidates[0].canonicalString}), but required document(s) (${missingDocuments.join(
        ", ",
      )}) are missing package count.`;
      return {
        ruleKey: "package_count_comparison",
        ruleCode: "CHK_PACKAGE_COUNT",
        status: "INCOMPLETE",
        details: {
          values: validCandidates,
          missingDocuments,
          invalidDocuments,
          countsMatch: true,
          typesCompatible: true,
          difference: 0,
          sourceFieldIds,
          unreconciledReason: "MISSING_REQUIRED_DOCUMENT_PACKAGE_COUNT",
          note,
          message: note,
        },
      };
    }

    if (invalidDocuments.length > 0) {
      const note = `Available package counts match, but document(s) (${invalidDocuments
        .map((d) => d.documentType)
        .join(", ")}) have invalid package counts.`;
      return {
        ruleKey: "package_count_comparison",
        ruleCode: "CHK_PACKAGE_COUNT",
        status: "INCOMPLETE",
        details: {
          values: validCandidates,
          missingDocuments,
          invalidDocuments,
          countsMatch: true,
          typesCompatible: true,
          difference: 0,
          sourceFieldIds,
          unreconciledReason: "INVALID_PACKAGE_COUNT",
          note,
          message: note,
        },
      };
    }

    const note = `All package counts and types match across applicable documents (${validCandidates
      .map((c) => `${c.documentType}: ${c.canonicalString}`)
      .join(", ")}).`;
    return {
      ruleKey: "package_count_comparison",
      ruleCode: "CHK_PACKAGE_COUNT",
      status: "PASS",
      details: {
        values: validCandidates,
        missingDocuments,
        invalidDocuments,
        countsMatch: true,
        typesCompatible: true,
        difference: 0,
        sourceFieldIds,
        note,
        message: note,
      },
    };
  }

  // Case B: Fewer than 2 valid candidates
  const providedCount = input.candidates.filter(
    (c) =>
      c.value !== null &&
      c.value !== undefined &&
      String(c.value).trim().length > 0,
  ).length;

  if (providedCount === 0) {
    const status = input.candidates.length === 0 ? "NOT_APPLICABLE" : "INCOMPLETE";
    const note = "Package count values are unavailable to compare.";
    return {
      ruleKey: "package_count_comparison",
      ruleCode: "CHK_PACKAGE_COUNT",
      status,
      details: {
        values: validCandidates,
        missingDocuments,
        invalidDocuments,
        countsMatch: false,
        typesCompatible: true,
        difference: null,
        sourceFieldIds,
        unreconciledReason: "NO_PACKAGE_COUNTS_AVAILABLE",
        note,
        message: note,
      },
    };
  }

  const unreconciledReason =
    missingDocuments.length > 0
      ? "MISSING_REQUIRED_DOCUMENT_PACKAGE_COUNT"
      : "INSUFFICIENT_PACKAGE_DOCUMENTS";

  const note =
    missingDocuments.length > 0
      ? `Required document(s) (${missingDocuments.join(
          ", ",
        )}) are missing package count.`
      : "At least two documents with package counts are required to perform package count comparison.";

  return {
    ruleKey: "package_count_comparison",
    ruleCode: "CHK_PACKAGE_COUNT",
    status: "INCOMPLETE",
    details: {
      values: validCandidates,
      missingDocuments,
      invalidDocuments,
      countsMatch: false,
      typesCompatible: true,
      difference: null,
      sourceFieldIds,
      unreconciledReason,
      note,
      message: note,
    },
  };
}
