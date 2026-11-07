import Decimal from "decimal.js";

export type StrictDecimalSuccess = {
  ok: true;
  value: Decimal;
  canonicalString: string;
  raw: string;
  sourceQuote?: string | null;
};

export type StrictDecimalFailure = {
  ok: false;
  error: "EMPTY_VALUE" | "MALFORMED_NUMERIC_STRING" | "NEGATIVE_VALUE_NOT_ALLOWED";
  raw: string;
  sourceQuote?: string | null;
};

export type StrictDecimalResult = StrictDecimalSuccess | StrictDecimalFailure;

// Accepted integer-part grammars, each followed by at most one optional fraction:
// - plain digits:                 3120
// - western thousands grouping:   3,120 / 1,200,000 (or single-space grouping 1 200 000)
// - Indian lakh/crore grouping:   12,34,567 / 1,23,45,678
const STRICT_NUMERIC_PATTERN =
  /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?: \d{3})+|\d+)(?:\.\d+)?$/;

/**
 * Week 4 Step 1: Strict decimal parsing helper.
 * - Rejects malformed strings instead of coercing them to zero.
 * - Preserves original raw input and source quote.
 * - Never returns NaN or Infinity.
 */
export function parseStrictDecimal(
  rawInput: string | number | null | undefined,
  sourceQuote?: string | null,
): StrictDecimalResult {
  if (rawInput === null || rawInput === undefined) {
    return {
      ok: false,
      error: "EMPTY_VALUE",
      raw: "",
      sourceQuote,
    };
  }

  const rawString = typeof rawInput === "number" ? rawInput.toString() : rawInput.trim();

  if (rawString.length === 0) {
    return {
      ok: false,
      error: "EMPTY_VALUE",
      raw: rawString,
      sourceQuote,
    };
  }

  // Reject explicit non-finite terms
  if (rawString === "NaN" || rawString === "Infinity" || rawString === "-Infinity") {
    return {
      ok: false,
      error: "MALFORMED_NUMERIC_STRING",
      raw: rawString,
      sourceQuote,
    };
  }

  if (!STRICT_NUMERIC_PATTERN.test(rawString)) {
    return {
      ok: false,
      error: "MALFORMED_NUMERIC_STRING",
      raw: rawString,
      sourceQuote,
    };
  }

  try {
    const cleaned = rawString.replace(/[, ]/g, "");
    const parsed = new Decimal(cleaned);

    if (!parsed.isFinite()) {
      return {
        ok: false,
        error: "MALFORMED_NUMERIC_STRING",
        raw: rawString,
        sourceQuote,
      };
    }

    return {
      ok: true,
      value: parsed,
      canonicalString: parsed.toString(),
      raw: rawString,
      sourceQuote,
    };
  } catch {
    return {
      ok: false,
      error: "MALFORMED_NUMERIC_STRING",
      raw: rawString,
      sourceQuote,
    };
  }
}

/**
 * Strict positive decimal parsing helper.
 * Rejects negative values (e.g. for weights, quantities, package counts).
 */
export function parseStrictPositiveDecimal(
  rawInput: string | number | null | undefined,
  sourceQuote?: string | null,
): StrictDecimalResult {
  const result = parseStrictDecimal(rawInput, sourceQuote);
  if (!result.ok) return result;

  if (result.value.isNegative()) {
    return {
      ok: false,
      error: "NEGATIVE_VALUE_NOT_ALLOWED",
      raw: result.raw,
      sourceQuote,
    };
  }

  return result;
}

