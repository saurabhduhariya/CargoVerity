import { normalizeSupplierName } from "@/lib/shipments";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Week 5 Step 6: Accuracy and Supplier Reports Core Engine
 *
 * Requirements from plan/07-detailed-implementation-plan.md:
 * 1. Define evaluated = AI values present and human-reviewed.
 * 2. Define correctAsExtracted using normalized AI and verified values.
 * 3. Calculate accuracy = correctAsExtracted / evaluated.
 * 4. Count reviewer corrections separately.
 * 5. Calculate correctionRate = corrected / evaluated.
 * 6. Count manually entered values separately; do not count them as correct AI extraction.
 * 7. Exclude unreviewed fields from the denominator and display their count.
 * 8. Group results by field key.
 * 9. Group results by normalized supplier.
 * 10. Show numerator, denominator and sample size beside every percentage.
 * 11. Distinguish synthetic demo data from a labelled benchmark.
 * 12. Do not claim the 95% target without the client's 200-shipment labelled set.
 */

export type RawFieldRecord = {
  id: string;
  fieldKey: string;
  modelValue: string | null;
  currentValue: string | null;
  reviewStatus: string;
  correctionsCount?: number;
  supplierName?: string | null;
  shipmentReference?: string;
  docType?: string;
};

export type MetricRatio = {
  percentage: number;
  formattedPercentage: string;
  numerator: number;
  denominator: number;
  sampleSize: number;
  display: string;
};

export type AccuracyGroupMetrics = {
  groupKey: string;
  groupLabel: string;
  totalFields: number;
  evaluated: number;
  correctAsExtracted: number;
  corrected: number;
  manualEntries: number;
  unreviewed: number;
  accuracy: MetricRatio;
  correctionRate: MetricRatio;
};

export type AccuracyReport = {
  summary: {
    totalFields: number;
    evaluated: number;
    correctAsExtracted: number;
    corrected: number;
    manualEntries: number;
    unreviewed: number;
    accuracy: MetricRatio;
    correctionRate: MetricRatio;
  };
  byFieldKey: AccuracyGroupMetrics[];
  bySupplier: AccuracyGroupMetrics[];
  dataset: {
    type: "SYNTHETIC_DEMO" | "LABELLED_BENCHMARK";
    label: string;
    isLabelledBenchmark: boolean;
    watermark: string;
  };
  benchmarkTarget: {
    targetPercentage: number;
    targetClaimed: boolean;
    disclaimer: string;
  };
  generatedAt: string;
};

export function createMetricRatio(
  numerator: number,
  denominator: number,
  sampleSize: number,
  unitLabel = "evaluated fields",
): MetricRatio {
  const percentage =
    denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
  return {
    percentage,
    formattedPercentage: `${percentage.toFixed(1)}%`,
    numerator,
    denominator,
    sampleSize,
    display: `${percentage.toFixed(1)}% (${numerator} / ${denominator} ${unitLabel}, n = ${sampleSize})`,
  };
}

/**
 * Normalizes field values for equivalence comparison (Rule 2).
 */
export function normalizeFieldValue(
  fieldKey: string,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";

  const keyLower = fieldKey.toLowerCase();

  // 1. Currency code
  if (keyLower.includes("currency")) {
    return trimmed.toUpperCase();
  }

  // 2. Dates: normalize ISO date prefixes (e.g., 2026-11-02T00:00:00Z -> 2026-11-02)
  if (keyLower.includes("date")) {
    const isoDate = trimmed.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return isoDate;
    }
  }

  // 3. Numbers / Weights / Quantities / Amounts
  if (
    keyLower.includes("weight") ||
    keyLower.includes("quantity") ||
    keyLower.includes("total") ||
    keyLower.includes("price") ||
    keyLower.includes("count")
  ) {
    const cleaned = trimmed.replace(/,/g, "");
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      const num = Number(cleaned);
      if (!Number.isNaN(num)) {
        return String(num);
      }
    }
  }

  // 4. Default string: collapse internal whitespace
  return trimmed.replace(/\s+/g, " ");
}

export function areFieldValuesEquivalent(
  fieldKey: string,
  aiValue: string | null | undefined,
  verifiedValue: string | null | undefined,
): boolean {
  if (aiValue === null || aiValue === undefined || verifiedValue === null || verifiedValue === undefined) {
    return false;
  }
  const normAi = normalizeFieldValue(fieldKey, aiValue);
  const normVerified = normalizeFieldValue(fieldKey, verifiedValue);
  return normAi.toLowerCase() === normVerified.toLowerCase();
}

/**
 * Aggregates a slice of field records according to Week 5 Step 6 definitions.
 */
export function aggregateGroupMetrics(
  groupKey: string,
  groupLabel: string,
  records: RawFieldRecord[],
): AccuracyGroupMetrics {
  let evaluated = 0;
  let correctAsExtracted = 0;
  let corrected = 0;
  let manualEntries = 0;
  let unreviewed = 0;

  for (const record of records) {
    const isUnreviewed =
      record.reviewStatus === "PENDING" ||
      record.reviewStatus === "REQUIRES_REVIEW";

    // Rule 7: Exclude unreviewed fields from denominator
    if (isUnreviewed) {
      unreviewed++;
      continue;
    }

    const isManualEntry =
      record.reviewStatus === "MANUAL_ENTRY" ||
      (record.modelValue === null && record.currentValue !== null);

    // Rule 6: Count manually entered values separately; do not count them as correct AI extraction
    if (isManualEntry) {
      manualEntries++;
      continue;
    }

    // Rule 1: Define evaluated = AI values present and human-reviewed
    const hasAiValue =
      record.modelValue !== null && record.modelValue.trim() !== "";
    const isHumanReviewed =
      record.reviewStatus === "CONFIRMED" ||
      record.reviewStatus === "CORRECTED" ||
      record.reviewStatus === "VERIFIED";

    if (hasAiValue && isHumanReviewed) {
      evaluated++;

      // Rule 2: Define correctAsExtracted using normalized AI and verified values
      const isEquivalent = areFieldValuesEquivalent(
        record.fieldKey,
        record.modelValue,
        record.currentValue,
      );

      const corrections = record.correctionsCount ?? 0;

      if (
        record.reviewStatus === "CONFIRMED" ||
        record.reviewStatus === "VERIFIED" ||
        (isEquivalent && corrections === 0)
      ) {
        correctAsExtracted++;
      } else {
        // Rule 4: Count reviewer corrections separately
        corrected++;
      }
    } else {
      // Any other state without AI value or not human reviewed is unreviewed/uncounted in evaluated
      unreviewed++;
    }
  }

  // Rule 3: accuracy = correctAsExtracted / evaluated
  // Rule 10: Show numerator, denominator and sample size beside every percentage
  const accuracy = createMetricRatio(
    correctAsExtracted,
    evaluated,
    evaluated,
    "evaluated fields",
  );

  // Rule 5: correctionRate = corrected / evaluated
  const correctionRate = createMetricRatio(
    corrected,
    evaluated,
    evaluated,
    "evaluated fields",
  );

  return {
    groupKey,
    groupLabel,
    totalFields: records.length,
    evaluated,
    correctAsExtracted,
    corrected,
    manualEntries,
    unreviewed,
    accuracy,
    correctionRate,
  };
}

/**
 * Calculates full accuracy report including overall summary, field key breakdown,
 * and supplier breakdown.
 */
export function calculateAccuracyReport(
  fields: RawFieldRecord[],
  options?: {
    isLabelledBenchmark?: boolean;
    datasetLabel?: string;
  },
): AccuracyReport {
  const isLabelled = options?.isLabelledBenchmark === true;

  // 1. Overall Summary
  const summaryGroup = aggregateGroupMetrics("overall", "All Fields", fields);

  // 2. Group by Field Key (Rule 8)
  const fieldsByKey = new Map<string, RawFieldRecord[]>();
  for (const f of fields) {
    const list = fieldsByKey.get(f.fieldKey) ?? [];
    list.push(f);
    fieldsByKey.set(f.fieldKey, list);
  }

  const byFieldKey: AccuracyGroupMetrics[] = Array.from(fieldsByKey.entries())
    .map(([key, records]) =>
      aggregateGroupMetrics(
        key,
        key.replace(/([A-Z])/g, " $1").trim(),
        records,
      ),
    )
    .sort((a, b) => b.totalFields - a.totalFields);

  // 3. Group by Normalized Supplier (Rule 9)
  const fieldsBySupplier = new Map<string, RawFieldRecord[]>();
  for (const f of fields) {
    const rawSupplier = f.supplierName?.trim();
    const normalizedSupplier = rawSupplier
      ? normalizeSupplierName(rawSupplier)
      : "Unassigned Supplier";
    const list = fieldsBySupplier.get(normalizedSupplier) ?? [];
    list.push(f);
    fieldsBySupplier.set(normalizedSupplier, list);
  }

  const bySupplier: AccuracyGroupMetrics[] = Array.from(
    fieldsBySupplier.entries(),
  )
    .map(([supplier, records]) =>
      aggregateGroupMetrics(supplier, supplier, records),
    )
    .sort((a, b) => b.totalFields - a.totalFields);

  // Rule 11 & Rule 12: Synthetic demo vs labelled benchmark distinction & target disclaimer
  return {
    summary: {
      totalFields: summaryGroup.totalFields,
      evaluated: summaryGroup.evaluated,
      correctAsExtracted: summaryGroup.correctAsExtracted,
      corrected: summaryGroup.corrected,
      manualEntries: summaryGroup.manualEntries,
      unreviewed: summaryGroup.unreviewed,
      accuracy: summaryGroup.accuracy,
      correctionRate: summaryGroup.correctionRate,
    },
    byFieldKey,
    bySupplier,
    dataset: {
      type: isLabelled ? "LABELLED_BENCHMARK" : "SYNTHETIC_DEMO",
      label:
        options?.datasetLabel ??
        (isLabelled
          ? "Client Labelled Benchmark (200-Shipment Ground Truth)"
          : "Synthetic Demo Dataset (Development & Demonstration Set)"),
      isLabelledBenchmark: isLabelled,
      watermark: isLabelled
        ? "CLIENT PRODUCTION BENCHMARK"
        : "SYNTHETIC DEMO DATA — NOT CLIENT PRODUCTION BENCHMARK",
    },
    benchmarkTarget: {
      targetPercentage: 95,
      targetClaimed: false, // Rule 12: Do NOT claim 95% target without the client's 200-shipment labelled set
      disclaimer:
        "The 95% extraction accuracy target is a client benchmark KPI that can only be claimed against the official 200-shipment labelled evaluation set. Current metrics represent real evaluated synthetic demo shipments.",
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Loads current extraction fields from database and generates AccuracyReport.
 */
export async function getAccuracyReport(
  prisma: PrismaClient,
  appUser: { id: string; role: string },
  options?: {
    isLabelledBenchmark?: boolean;
    datasetLabel?: string;
  },
): Promise<AccuracyReport> {
  const shipments = await prisma.shipment.findMany({
    where: appUser.role === "MANAGER" ? {} : { createdById: appUser.id },
    include: {
      supplier: true,
      documents: {
        where: { isCurrent: true },
        include: {
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              fields: {
                include: {
                  corrections: {
                    orderBy: { createdAt: "desc" },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rawFields: RawFieldRecord[] = [];

  for (const shipment of shipments) {
    const supplierName = shipment.supplier?.name ?? null;

    for (const document of shipment.documents) {
      const latestRun = document.extractionRuns[0];
      if (!latestRun) continue;

      for (const field of latestRun.fields) {
        rawFields.push({
          id: field.id,
          fieldKey: field.fieldKey,
          modelValue: field.modelValue,
          currentValue: field.currentValue,
          reviewStatus: field.reviewStatus,
          correctionsCount: field.corrections.length,
          supplierName,
          shipmentReference: shipment.reference,
          docType: document.docType,
        });
      }
    }
  }

  return calculateAccuracyReport(rawFields, options);
}
