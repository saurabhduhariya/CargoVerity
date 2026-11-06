import { DEFAULT_TOLERANCES } from "./tolerances";

export type NormalizedItemResult =
  | {
      ok: true;
      normalized: string;
      tokens: string[];
      raw: string;
      sourceQuote?: string | null;
    }
  | {
      ok: false;
      error: "EMPTY_DESCRIPTION";
      raw: string;
      sourceQuote?: string | null;
    };

/**
 * Normalizes an item description for cross-document line-item matching.
 * CRITICAL RULE 10: Normalizes item descriptions without assuming unit equivalence.
 */
export function normalizeItemDescription(
  rawInput: string | null | undefined,
  sourceQuote?: string | null,
): NormalizedItemResult {
  if (!rawInput || rawInput.trim().length === 0) {
    return {
      ok: false,
      error: "EMPTY_DESCRIPTION",
      raw: rawInput ?? "",
      sourceQuote,
    };
  }

  const raw = rawInput.trim();

  // 1. Lowercase, normalize common separators
  let text = raw.toLowerCase().replace(/[/_\\-]/g, " ");

  // 2. Remove noise punctuation (quotes, asterisks, brackets, colons, hash)
  text = text.replace(/["'*()[\]:;,#]/g, " ");

  // 3. Collapse whitespace and trim
  const normalized = text.replace(/\s+/g, " ").trim();
  const tokens = normalized.length > 0 ? normalized.split(" ") : [];

  return {
    ok: true,
    normalized,
    tokens,
    raw,
    sourceQuote,
  };
}

export type ItemComparisonResult = {
  isMatch: boolean;
  similarityScore: number;
  leftOriginal: string;
  rightOriginal: string;
  leftNormalized: string;
  rightNormalized: string;
  unitEquivalenceAssumed: false;
  disclaimer: "Item description match does not imply unit or quantity equivalence.";
};

/**
 * Compares two item descriptions without assuming unit equivalence.
 */
export function compareItemDescriptions(
  left: string | null | undefined,
  right: string | null | undefined,
  threshold: number = DEFAULT_TOLERANCES.itemDescriptionSimilarityThreshold,
): ItemComparisonResult {
  const normLeft = normalizeItemDescription(left);
  const normRight = normalizeItemDescription(right);

  if (!normLeft.ok || !normRight.ok) {
    return {
      isMatch: false,
      similarityScore: 0,
      leftOriginal: normLeft.raw,
      rightOriginal: normRight.raw,
      leftNormalized: normLeft.ok ? normLeft.normalized : "",
      rightNormalized: normRight.ok ? normRight.normalized : "",
      unitEquivalenceAssumed: false,
      disclaimer: "Item description match does not imply unit or quantity equivalence.",
    };
  }

  // Exact normalized match
  if (normLeft.normalized === normRight.normalized) {
    return {
      isMatch: true,
      similarityScore: 1.0,
      leftOriginal: normLeft.raw,
      rightOriginal: normRight.raw,
      leftNormalized: normLeft.normalized,
      rightNormalized: normRight.normalized,
      unitEquivalenceAssumed: false,
      disclaimer: "Item description match does not imply unit or quantity equivalence.",
    };
  }

  const setA = new Set(normLeft.tokens);
  const setB = new Set(normRight.tokens);

  if (setA.size === 0 || setB.size === 0) {
    return {
      isMatch: false,
      similarityScore: 0,
      leftOriginal: normLeft.raw,
      rightOriginal: normRight.raw,
      leftNormalized: normLeft.normalized,
      rightNormalized: normRight.normalized,
      unitEquivalenceAssumed: false,
      disclaimer: "Item description match does not imply unit or quantity equivalence.",
    };
  }

  let intersectionCount = 0;
  for (const token of setA) {
    if (setB.has(token)) intersectionCount += 1;
  }

  const unionCount = new Set([...setA, ...setB]).size;
  const similarityScore = unionCount > 0 ? intersectionCount / unionCount : 0;
  const isMatch = similarityScore >= threshold;

  return {
    isMatch,
    similarityScore: Math.round(similarityScore * 100) / 100,
    leftOriginal: normLeft.raw,
    rightOriginal: normRight.raw,
    leftNormalized: normLeft.normalized,
    rightNormalized: normRight.normalized,
    unitEquivalenceAssumed: false,
    disclaimer: "Item description match does not imply unit or quantity equivalence.",
  };
}
