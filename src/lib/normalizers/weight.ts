import Decimal from "decimal.js";
import { parseStrictDecimal } from "./decimal";
import { DEFAULT_TOLERANCES } from "./tolerances";

export type NormalizedWeightSuccess = {
  ok: true;
  weightInKg: Decimal;
  canonicalString: string;
  unit: "KG";
  rawUnit: string;
  rawValue: string;
  sourceQuote?: string | null;
};

export type NormalizedWeightFailure = {
  ok: false;
  error:
    | "EMPTY_VALUE"
    | "MALFORMED_NUMERIC_STRING"
    | "MISSING_EXPLICIT_UNIT"
    | "UNKNOWN_WEIGHT_UNIT"
    | "NEGATIVE_WEIGHT";
  rawValue: string;
  rawUnit?: string | null;
  sourceQuote?: string | null;
};

export type NormalizedWeightResult = NormalizedWeightSuccess | NormalizedWeightFailure;

/**
 * Named weight conversion factors to base unit: Kilograms (KG).
 * Supports kilograms, grams, metric tonnes, and pounds.
 */
const KNOWN_WEIGHT_FACTORS: Record<string, Decimal> = {
  // Kilograms
  kg: new Decimal(1),
  kgs: new Decimal(1),
  kilo: new Decimal(1),
  kilos: new Decimal(1),
  kilogram: new Decimal(1),
  kilograms: new Decimal(1),

  // Grams (divide by 1000)
  g: new Decimal("0.001"),
  gm: new Decimal("0.001"),
  gms: new Decimal("0.001"),
  gram: new Decimal("0.001"),
  grams: new Decimal("0.001"),

  // Metric Tonnes (multiply by 1000)
  t: new Decimal(1000),
  mt: new Decimal(1000),
  ton: new Decimal(1000),
  tons: new Decimal(1000),
  tonne: new Decimal(1000),
  tonnes: new Decimal(1000),
  "metric ton": new Decimal(1000),
  "metric tons": new Decimal(1000),

  // Pounds (standard international trade conversion)
  lb: new Decimal("0.45359237"),
  lbs: new Decimal("0.45359237"),
  pound: new Decimal("0.45359237"),
  pounds: new Decimal("0.45359237"),
};

/**
 * Normalizes an explicit weight value and unit into standard Kilograms (KG).
 * - Requires explicit, known unit; never defaults to KG when unit is missing.
 * - Rejects negative weights and unknown units into review.
 * - Preserves raw value, raw unit, and source quote.
 */
export function normalizeWeight(params: {
  value: string | number | null | undefined;
  unit: string | null | undefined;
  sourceQuote?: string | null;
}): NormalizedWeightResult {
  const { value, unit, sourceQuote } = params;
  const rawValue = value === null || value === undefined ? "" : String(value).trim();
  const rawUnit = unit === null || unit === undefined ? null : String(unit).trim();

  // 1. Strict explicit unit validation
  if (!rawUnit || rawUnit.length === 0) {
    return {
      ok: false,
      error: "MISSING_EXPLICIT_UNIT",
      rawValue,
      rawUnit: null,
      sourceQuote,
    };
  }

  // 2. Strict decimal parsing of numeric value
  const parsedDecimal = parseStrictDecimal(value, sourceQuote);
  if (!parsedDecimal.ok) {
    return {
      ok: false,
      error: parsedDecimal.error as "EMPTY_VALUE" | "MALFORMED_NUMERIC_STRING",
      rawValue,
      rawUnit,
      sourceQuote,
    };
  }

  // 3. Reject negative weights
  if (parsedDecimal.value.isNegative()) {
    return {
      ok: false,
      error: "NEGATIVE_WEIGHT",
      rawValue,
      rawUnit,
      sourceQuote,
    };
  }

  // 4. Match against known unit conversions
  const normalizedKey = rawUnit.toLowerCase().replace(/[.]/g, "").trim();
  const factor = KNOWN_WEIGHT_FACTORS[normalizedKey];

  if (!factor) {
    return {
      ok: false,
      error: "UNKNOWN_WEIGHT_UNIT",
      rawValue,
      rawUnit,
      sourceQuote,
    };
  }

  const weightInKg = parsedDecimal.value.times(factor);

  return {
    ok: true,
    weightInKg,
    canonicalString: weightInKg.toString(),
    unit: "KG",
    rawUnit,
    rawValue,
    sourceQuote,
  };
}

export type WeightComparisonResult = {
  isMatch: boolean;
  differenceKg: Decimal;
  differenceString: string;
  toleranceKg: Decimal;
  leftKg: Decimal;
  rightKg: Decimal;
};

/**
 * Compares two normalized weights in kilograms within tolerance.
 * Does not fabricate reasons or assume undocumented discrepancies.
 */
export function compareWeights(
  left: NormalizedWeightSuccess,
  right: NormalizedWeightSuccess,
  toleranceKg: Decimal | number = DEFAULT_TOLERANCES.weightKg,
): WeightComparisonResult {
  const tolerance = typeof toleranceKg === "number" ? new Decimal(toleranceKg) : toleranceKg;
  const diff = left.weightInKg.minus(right.weightInKg).abs();
  const isMatch = diff.lessThanOrEqualTo(tolerance);

  return {
    isMatch,
    differenceKg: diff,
    differenceString: diff.toString(),
    toleranceKg: tolerance,
    leftKg: left.weightInKg,
    rightKg: right.weightInKg,
  };
}
