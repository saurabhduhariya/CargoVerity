import { parseStrictDecimal } from "./decimal";

export type NormalizedPackageSuccess = {
  ok: true;
  count: number;
  packageType: string | null; // e.g. "CARTON", "PALLET", "DRUM", "BOX"
  canonicalString: string; // e.g. "24 CARTON"
  rawCount: string;
  rawType: string | null;
  raw: string;
  sourceQuote?: string | null;
};

export type NormalizedPackageFailure = {
  ok: false;
  error:
    | "EMPTY_VALUE"
    | "MALFORMED_PACKAGE_COUNT"
    | "NEGATIVE_PACKAGE_COUNT"
    | "FRACTIONAL_PACKAGE_COUNT_NOT_ALLOWED";
  raw: string;
  sourceQuote?: string | null;
};

export type NormalizedPackageResult =
  | NormalizedPackageSuccess
  | NormalizedPackageFailure;

const KNOWN_PACKAGE_TYPES: Record<string, string> = {
  carton: "CARTON",
  cartons: "CARTON",
  ctn: "CARTON",
  ctns: "CARTON",
  pallet: "PALLET",
  pallets: "PALLET",
  plt: "PALLET",
  plts: "PALLET",
  box: "BOX",
  boxes: "BOX",
  bx: "BOX",
  bxs: "BOX",
  drum: "DRUM",
  drums: "DRUM",
  container: "CONTAINER",
  containers: "CONTAINER",
  cntr: "CONTAINER",
  cntrs: "CONTAINER",
  crate: "CRATE",
  crates: "CRATE",
  crt: "CRATE",
  crts: "CRATE",
  bag: "BAG",
  bags: "BAG",
  package: "PACKAGE",
  packages: "PACKAGE",
  pkg: "PACKAGE",
  pkgs: "PACKAGE",
  piece: "PIECE",
  pieces: "PIECE",
  pc: "PIECE",
  pcs: "PIECE",
  case: "CASE",
  cases: "CASE",
  cs: "CASE",
  roll: "ROLL",
  rolls: "ROLL",
  bundle: "BUNDLE",
  bundles: "BUNDLE",
};

/**
 * Normalizes a raw package type string into canonical uppercase singular representation.
 */
export function normalizePackageType(rawType: string | null | undefined): string | null {
  if (!rawType || rawType.trim().length === 0) return null;
  const cleaned = rawType.toLowerCase().replace(/[^a-z]/g, "").trim();
  return KNOWN_PACKAGE_TYPES[cleaned] ?? cleaned.toUpperCase();
}

/**
 * Parses and normalizes package count and package type as separate values.
 * CRITICAL RULE 11: Keeps package count and package type as separate values.
 * Supports:
 * - Separate count & type inputs (e.g. count: 24, type: "Cartons")
 * - Combined strings (e.g. "24 CARTONS", "15 Pallets", "100 CTNS")
 */
export function normalizePackageDetails(params: {
  countInput?: string | number | null;
  typeInput?: string | null;
  combinedInput?: string | null;
  sourceQuote?: string | null;
}): NormalizedPackageResult {
  const { sourceQuote } = params;
  let rawCountStr = params.countInput !== null && params.countInput !== undefined ? String(params.countInput).trim() : "";
  let rawTypeStr = params.typeInput ? params.typeInput.trim() : "";
  const combined = params.combinedInput ? params.combinedInput.trim() : "";

  // If combined input supplied or countInput contains text
  if (combined && !rawCountStr) {
    // Capture the full numeric token (including grouping commas); the strict decimal grammar
    // below decides whether the grouping is valid ("1,200,000" ok, "1,2,3" rejected).
    const match = combined.match(/^([+-]?\d[\d,]*(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      rawCountStr = match[1];
      rawTypeStr = match[2].trim();
    } else {
      rawCountStr = combined;
    }
  } else if (rawCountStr && !rawTypeStr) {
    const match = rawCountStr.match(/^([+-]?\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]+.*)$/);
    if (match) {
      rawCountStr = match[1];
      rawTypeStr = match[2].trim();
    }
  }

  if (!rawCountStr) {
    return {
      ok: false,
      error: "EMPTY_VALUE",
      raw: combined || rawCountStr,
      sourceQuote,
    };
  }

  // Parse decimal count strictly
  const parsedDecimal = parseStrictDecimal(rawCountStr, sourceQuote);
  if (!parsedDecimal.ok) {
    return {
      ok: false,
      error: "MALFORMED_PACKAGE_COUNT",
      raw: rawCountStr,
      sourceQuote,
    };
  }

  if (parsedDecimal.value.isNegative()) {
    return {
      ok: false,
      error: "NEGATIVE_PACKAGE_COUNT",
      raw: rawCountStr,
      sourceQuote,
    };
  }

  // Enforce integer package counts
  if (!parsedDecimal.value.isInteger()) {
    return {
      ok: false,
      error: "FRACTIONAL_PACKAGE_COUNT_NOT_ALLOWED",
      raw: rawCountStr,
      sourceQuote,
    };
  }

  const count = parsedDecimal.value.toNumber();
  const packageType = normalizePackageType(rawTypeStr);
  const rawCombined = rawTypeStr ? `${rawCountStr} ${rawTypeStr}` : rawCountStr;

  return {
    ok: true,
    count,
    packageType,
    canonicalString: packageType ? `${count} ${packageType}` : `${count}`,
    rawCount: rawCountStr,
    rawType: rawTypeStr || null,
    raw: rawCombined,
    sourceQuote,
  };
}

export type PackageComparisonResult =
  | {
      comparable: true;
      isMatch: boolean;
      leftCount: number;
      rightCount: number;
      leftType: string | null;
      rightType: string | null;
      difference: number;
    }
  | {
      comparable: false;
      reason: "INCOMPATIBLE_PACKAGE_TYPES";
      leftType: string | null;
      rightType: string | null;
    };

/**
 * Compares two packages.
 * Requires package types to be compatible before comparing counts (unless one or both are unspecified).
 */
export function comparePackageDetails(
  left: NormalizedPackageSuccess,
  right: NormalizedPackageSuccess,
): PackageComparisonResult {
  // If both have explicit types and they conflict (e.g. CARTON vs PALLET)
  if (left.packageType && right.packageType && left.packageType !== right.packageType) {
    return {
      comparable: false,
      reason: "INCOMPATIBLE_PACKAGE_TYPES",
      leftType: left.packageType,
      rightType: right.packageType,
    };
  }

  const difference = Math.abs(left.count - right.count);
  const isMatch = difference === 0;

  return {
    comparable: true,
    isMatch,
    leftCount: left.count,
    rightCount: right.count,
    leftType: left.packageType,
    rightType: right.packageType,
    difference,
  };
}
