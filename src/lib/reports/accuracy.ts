import { normalizeSupplierName } from "@/lib/shipments";
import type { PrismaClient } from "@/generated/prisma/client";
import { parseExportDate } from "@/lib/export/profile";
import { parseStrictDecimal } from "@/lib/normalizers/decimal";

const NUMERIC_KEY_PATTERN = /weight|quantity|total|price|count|amount|charges|freight|insurance|tax|discount|value|volume|cbm/;

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
  supplierId?: string | null;
  supplierName?: string | null;
  shipmentId?: string;
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
  /** Reviewed as not present / not applicable on the document; outside every denominator. */
  notApplicable: number;
  /** Distinct shipments that contributed at least one evaluated field (the sample size). */
  shipmentsEvaluated: number;
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
    notApplicable: number;
    shipmentsEvaluated: number;
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
    display: `${percentage.toFixed(1)}% (${numerator} / ${denominator} ${unitLabel}, n = ${sampleSize} shipment${sampleSize === 1 ? "" : "s"})`,
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

  // 2. Dates: the same strict parser as the export (ISO, month names, unambiguous day-first).
  if (keyLower.includes("date")) {
    const parsed = parseExportDate(trimmed);
    if (parsed?.ok) return parsed.value;
  }

  // 3. Numbers / Weights / Quantities / Amounts: exact decimal comparison ("3,165.00" == "3165").
  if (NUMERIC_KEY_PATTERN.test(keyLower)) {
    const parsed = parseStrictDecimal(trimmed);
    if (parsed.ok) return parsed.value.toString();
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
  let notApplicable = 0;
  const evaluatedShipments = new Set<string>();

  for (const record of records) {
    const status = record.reviewStatus;

    // Rule 7: unreviewed values never enter a denominator; they are counted and shown.
    if (status === "PENDING" || status === "REQUIRES_REVIEW") {
      unreviewed++;
      continue;
    }

    // Reviewed as absent from the document: nothing to be right or wrong about.
    if (status === "NOT_PRESENT" || status === "NOT_APPLICABLE") {
      notApplicable++;
      continue;
    }

    const hasAiValue = record.modelValue !== null && record.modelValue.trim() !== "";

    // Rule 6: manually entered values (manual entry, or a value a person supplied where the AI
    // returned none) are counted separately and never as correct AI extraction.
    if (status === "MANUAL_ENTRY" || !hasAiValue) {
      manualEntries++;
      continue;
    }

    // Rule 1: evaluated = AI value present AND human-reviewed (confirmed or corrected).
    if (status !== "CONFIRMED" && status !== "CORRECTED") {
      unreviewed++;
      continue;
    }

    evaluated++;
    evaluatedShipments.add(record.shipmentId ?? record.shipmentReference ?? record.id);

    // Rule 2: correct-as-extracted when the normalized AI value equals the verified value,
    // whatever button was used ("3,165" confirmed as "3165" is correct; a confirmed value
    // that a person had changed earlier is a correction).
    if (areFieldValuesEquivalent(record.fieldKey, record.modelValue, record.currentValue)) {
      correctAsExtracted++;
    } else {
      // Rule 4: reviewer corrections counted separately.
      corrected++;
    }
  }

  // Rules 3, 5, 10: ratios carry numerator, denominator and sample size (distinct shipments).
  const sampleSize = evaluatedShipments.size;
  const accuracy = createMetricRatio(correctAsExtracted, evaluated, sampleSize, "evaluated fields");
  const correctionRate = createMetricRatio(corrected, evaluated, sampleSize, "evaluated fields");

  return {
    groupKey,
    groupLabel,
    totalFields: records.length,
    evaluated,
    correctAsExtracted,
    corrected,
    manualEntries,
    unreviewed,
    notApplicable,
    shipmentsEvaluated: sampleSize,
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
  // Suppliers are already de-duplicated by normalized name in the Supplier table, so the
  // supplier ID is the grouping key; name-only records fall back to a case-insensitive key.
  const fieldsBySupplier = new Map<string, { label: string; records: RawFieldRecord[] }>();
  for (const f of fields) {
    const rawSupplier = f.supplierName?.trim();
    const label = rawSupplier ? normalizeSupplierName(rawSupplier) : "Unassigned Supplier";
    const key = f.supplierId ?? (rawSupplier ? `name:${label.toLowerCase()}` : "unassigned");
    const group = fieldsBySupplier.get(key) ?? { label, records: [] };
    group.records.push(f);
    fieldsBySupplier.set(key, group);
  }

  const bySupplier: AccuracyGroupMetrics[] = Array.from(fieldsBySupplier.entries())
    .map(([key, group]) => aggregateGroupMetrics(key, group.label, group.records))
    .sort((a, b) => b.totalFields - a.totalFields || a.groupLabel.localeCompare(b.groupLabel));

  // Rule 11 & Rule 12: Synthetic demo vs labelled benchmark distinction & target disclaimer
  return {
    summary: {
      totalFields: summaryGroup.totalFields,
      evaluated: summaryGroup.evaluated,
      correctAsExtracted: summaryGroup.correctAsExtracted,
      corrected: summaryGroup.corrected,
      manualEntries: summaryGroup.manualEntries,
      unreviewed: summaryGroup.unreviewed,
      notApplicable: summaryGroup.notApplicable,
      shipmentsEvaluated: summaryGroup.shipmentsEvaluated,
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
              fields: { include: { _count: { select: { corrections: true } } } },
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
    const supplierId = shipment.supplier?.id ?? null;

    for (const document of shipment.documents) {
      const latestRun = document.extractionRuns[0];
      if (!latestRun) continue;

      for (const field of latestRun.fields) {
        rawFields.push({
          id: field.id,
          fieldKey: field.fieldKey,
          currentValue: field.currentValue,
          // A run created by the manual fallback has no AI values at all.
          modelValue: latestRun.provider === "manual" ? null : field.modelValue,
          reviewStatus: field.reviewStatus,
          correctionsCount: field._count.corrections,
          supplierId,
          supplierName,
          shipmentId: shipment.id,
          shipmentReference: shipment.reference,
          docType: document.docType,
        });
      }
    }
  }

  return calculateAccuracyReport(rawFields, options);
}
