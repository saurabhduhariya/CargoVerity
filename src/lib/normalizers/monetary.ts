import Decimal from "decimal.js";
import { parseStrictDecimal } from "./decimal";
import { DEFAULT_TOLERANCES } from "./tolerances";

export type NormalizedMonetarySuccess = {
  ok: true;
  amount: Decimal;
  currency: string; // Canonical 3-letter ISO code (e.g. "USD", "EUR", "SEK")
  canonicalString: string;
  rawAmount: string;
  rawCurrency: string;
  sourceQuote?: string | null;
};

export type NormalizedMonetaryFailure = {
  ok: false;
  error:
    | "EMPTY_VALUE"
    | "MALFORMED_NUMERIC_STRING"
    | "MISSING_CURRENCY"
    | "INVALID_CURRENCY_CODE";
  rawAmount: string;
  rawCurrency?: string | null;
  sourceQuote?: string | null;
};

export type NormalizedMonetaryResult =
  | NormalizedMonetarySuccess
  | NormalizedMonetaryFailure;

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  kr: "SEK",
};

/**
 * Normalizes a currency string or symbol into a 3-letter ISO code.
 */
export function normalizeCurrencyCode(rawCurrency: string | null | undefined): string | null {
  if (!rawCurrency) return null;
  const cleaned = rawCurrency.trim();
  if (SYMBOL_TO_CURRENCY[cleaned]) return SYMBOL_TO_CURRENCY[cleaned];

  const upper = cleaned.toUpperCase().replace(/[^A-Z]/g, "");
  if (upper.length === 3) return upper;
  return null;
}

/**
 * Normalizes a monetary amount and ensures currency code remains bound to the value.
 * - Parses strict decimal amounts without coercing malformed inputs.
 * - Extracts currency codes/symbols from explicit fields or combined strings.
 * - Preserves raw values and source quotes.
 */
export function normalizeMonetaryAmount(params: {
  amount: string | number | null | undefined;
  currency?: string | null;
  sourceQuote?: string | null;
}): NormalizedMonetaryResult {
  const { sourceQuote } = params;
  let rawAmount = params.amount === null || params.amount === undefined ? "" : String(params.amount).trim();
  let rawCurrency = params.currency === null || params.currency === undefined ? "" : String(params.currency).trim();

  // If currency was not passed separately, check if embedded in amount string (e.g. "$1,200.00" or "1200 USD")
  if (!rawCurrency && rawAmount) {
    for (const [sym, code] of Object.entries(SYMBOL_TO_CURRENCY)) {
      if (rawAmount.includes(sym)) {
        rawCurrency = code;
        rawAmount = rawAmount.replace(sym, "").trim();
        break;
      }
    }

    if (!rawCurrency) {
      const match = rawAmount.match(/([A-Za-z]{3})/);
      if (match) {
        rawCurrency = match[1].toUpperCase();
        rawAmount = rawAmount.replace(match[1], "").trim();
      }
    }
  }

  const normalizedCurrency = normalizeCurrencyCode(rawCurrency);
  if (!normalizedCurrency) {
    return {
      ok: false,
      error: "MISSING_CURRENCY",
      rawAmount,
      rawCurrency,
      sourceQuote,
    };
  }

  const parsedDecimal = parseStrictDecimal(rawAmount, sourceQuote);
  if (!parsedDecimal.ok) {
    return {
      ok: false,
      error: parsedDecimal.error as "EMPTY_VALUE" | "MALFORMED_NUMERIC_STRING",
      rawAmount,
      rawCurrency,
      sourceQuote,
    };
  }

  return {
    ok: true,
    amount: parsedDecimal.value,
    currency: normalizedCurrency,
    canonicalString: parsedDecimal.value.toString(),
    rawAmount,
    rawCurrency,
    sourceQuote,
  };
}

export type MonetaryComparisonResult =
  | {
      comparable: true;
      isMatch: boolean;
      difference: Decimal;
      differenceString: string;
      tolerance: Decimal;
      currency: string;
      leftAmount: Decimal;
      rightAmount: Decimal;
    }
  | {
      comparable: false;
      reason: "CURRENCY_MISMATCH";
      leftCurrency: string;
      rightCurrency: string;
    };

/**
 * Compares two monetary amounts.
 * CRITICAL RULE 8: Never compares amounts from different currencies without an explicit conversion policy.
 */
export function compareMonetaryAmounts(
  left: NormalizedMonetarySuccess,
  right: NormalizedMonetarySuccess,
  tolerance: Decimal | number = DEFAULT_TOLERANCES.monetary,
): MonetaryComparisonResult {
  // Enforce currency matching strictly
  if (left.currency !== right.currency) {
    return {
      comparable: false,
      reason: "CURRENCY_MISMATCH",
      leftCurrency: left.currency,
      rightCurrency: right.currency,
    };
  }

  const tol = typeof tolerance === "number" ? new Decimal(tolerance) : tolerance;
  const diff = left.amount.minus(right.amount).abs();
  const isMatch = diff.lessThanOrEqualTo(tol);

  return {
    comparable: true,
    isMatch,
    difference: diff,
    differenceString: diff.toString(),
    tolerance: tol,
    currency: left.currency,
    leftAmount: left.amount,
    rightAmount: right.amount,
  };
}
