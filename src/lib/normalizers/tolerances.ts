import Decimal from "decimal.js";

/**
 * Week 4 Step 1: Configuration for rule-specific tolerances.
 * Centralizes comparison thresholds across monetary arithmetic,
 * weights, quantities, and string similarity scoring.
 *
 * Weight tolerance is dynamic: max(weightKg floor, larger weight x weightPercent / 100).
 */
export type ToleranceConfig = {
  monetary: Decimal;
  /** Absolute weight tolerance floor in kg. */
  weightKg: Decimal;
  /** Relative weight tolerance as a percentage of the larger compared weight. */
  weightPercent: Decimal;
  quantity: Decimal;
  partyNameSimilarityThreshold: number;
  itemDescriptionSimilarityThreshold: number;
};

export const DEFAULT_TOLERANCES: ToleranceConfig = {
  monetary: new Decimal("0.01"), // ±0.01 currency units
  weightKg: new Decimal("0"), // absolute floor in kg (0 = percentage only)
  weightPercent: new Decimal("0.5"), // ±0.5% of the larger weight
  quantity: new Decimal("0.00"), // Exact item quantity comparison
  partyNameSimilarityThreshold: 0.85, // 85% token similarity for company/party names
  itemDescriptionSimilarityThreshold: 0.80, // 80% token similarity for item descriptions
};

function readNonNegative(raw: string | undefined, fallback: Decimal, max?: number): Decimal {
  if (raw === undefined || raw.trim() === "") return fallback;
  try {
    const parsed = new Decimal(raw.trim());
    if (!parsed.isFinite() || parsed.isNegative()) return fallback;
    if (max !== undefined && parsed.greaterThan(max)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

/**
 * Resolves tolerances from the server environment (CHECK_* variables), falling back to defaults.
 * Validation of env values is enforced by `getEnv()`; this helper stays tolerant so pure
 * engine code never throws while reading configuration.
 */
export function resolveTolerances(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): ToleranceConfig {
  return {
    ...DEFAULT_TOLERANCES,
    monetary: readNonNegative(env.CHECK_MONETARY_TOLERANCE, DEFAULT_TOLERANCES.monetary),
    weightKg: readNonNegative(env.CHECK_WEIGHT_TOLERANCE_KG, DEFAULT_TOLERANCES.weightKg),
    weightPercent: readNonNegative(env.CHECK_WEIGHT_TOLERANCE_PERCENT, DEFAULT_TOLERANCES.weightPercent, 100),
  };
}

/** Dynamic weight tolerance in kg: max(floor, basis x percent / 100). */
export function weightToleranceKg(
  basisKg: Decimal,
  config: Pick<ToleranceConfig, "weightKg" | "weightPercent"> = DEFAULT_TOLERANCES,
): Decimal {
  const relative = basisKg.abs().times(config.weightPercent).dividedBy(100);
  return Decimal.max(config.weightKg, relative);
}

/** Inclusive tolerance comparison. */
export function withinTolerance(difference: Decimal, tolerance: Decimal): boolean {
  return difference.abs().lessThanOrEqualTo(tolerance);
}

/** Serializable view of the tolerances used for a run (stored in snapshots and hashed). */
export function serializeTolerances(config: ToleranceConfig = DEFAULT_TOLERANCES) {
  return {
    monetary: config.monetary.toString(),
    weightKg: config.weightKg.toString(),
    weightPercent: config.weightPercent.toString(),
    quantity: config.quantity.toString(),
  };
}
