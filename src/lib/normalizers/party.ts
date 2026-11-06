import { DEFAULT_TOLERANCES } from "./tolerances";

export type NormalizedPartyResult =
  | {
      ok: true;
      normalized: string;
      tokens: string[];
      raw: string;
    }
  | {
      ok: false;
      error: "EMPTY_NAME";
      raw: string;
    };

// Corporate designators to strip for textual comparison
const LEGAL_DESIGNATORS = new RegExp(
  "\\b(" +
    [
      "inc",
      "incorporated",
      "corp",
      "corporation",
      "llc",
      "ltd",
      "limited",
      "co",
      "company",
      "gmbh",
      "sa",
      "srl",
      "pvt ltd",
      "pvt",
      "private limited",
      "ag",
      "ab",
      "bv",
      "plc",
      "sro",
      "cie",
    ].join("|") +
    ")\\b",
  "gi",
);

/**
 * Normalizes a party/supplier/importer name for comparison.
 * CRITICAL RULE 9: Normalizes party names for comparison without claiming legal-name identity.
 */
export function normalizePartyName(rawInput: string | null | undefined): NormalizedPartyResult {
  if (!rawInput || rawInput.trim().length === 0) {
    return {
      ok: false,
      error: "EMPTY_NAME",
      raw: rawInput ?? "",
    };
  }

  const raw = rawInput.trim();

  // 1. Lowercase and replace ampersand with 'and'
  let text = raw.toLowerCase().replace(/&/g, " and ");

  // 2. Remove punctuation except alphanumeric and space
  text = text.replace(/[^a-z0-9 ]/g, " ");

  // 3. Remove known legal entity suffixes
  text = text.replace(LEGAL_DESIGNATORS, " ");

  // 4. Collapse multiple spaces and trim
  const normalized = text.replace(/\s+/g, " ").trim();
  const tokens = normalized.length > 0 ? normalized.split(" ") : [];

  return {
    ok: true,
    normalized,
    tokens,
    raw,
  };
}

export type PartyComparisonResult = {
  isMatch: boolean;
  similarityScore: number;
  leftOriginal: string;
  rightOriginal: string;
  leftNormalized: string;
  rightNormalized: string;
  legalIdentityClaimed: false;
  disclaimer: "Normalized for textual comparison only; does not claim legal-name identity.";
};

/**
 * Compares two party names using token overlap (Jaccard similarity).
 * Clearly conveys that this is a textual comparison and does NOT constitute a legal-entity identity proof.
 */
export function comparePartyNames(
  left: string | null | undefined,
  right: string | null | undefined,
  threshold: number = DEFAULT_TOLERANCES.partyNameSimilarityThreshold,
): PartyComparisonResult {
  const normLeft = normalizePartyName(left);
  const normRight = normalizePartyName(right);

  if (!normLeft.ok || !normRight.ok) {
    return {
      isMatch: false,
      similarityScore: 0,
      leftOriginal: normLeft.raw,
      rightOriginal: normRight.raw,
      leftNormalized: normLeft.ok ? normLeft.normalized : "",
      rightNormalized: normRight.ok ? normRight.normalized : "",
      legalIdentityClaimed: false,
      disclaimer: "Normalized for textual comparison only; does not claim legal-name identity.",
    };
  }

  // Exact match on normalized text
  if (normLeft.normalized === normRight.normalized) {
    return {
      isMatch: true,
      similarityScore: 1.0,
      leftOriginal: normLeft.raw,
      rightOriginal: normRight.raw,
      leftNormalized: normLeft.normalized,
      rightNormalized: normRight.normalized,
      legalIdentityClaimed: false,
      disclaimer: "Normalized for textual comparison only; does not claim legal-name identity.",
    };
  }

  // Token Jaccard index
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
      legalIdentityClaimed: false,
      disclaimer: "Normalized for textual comparison only; does not claim legal-name identity.",
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
    legalIdentityClaimed: false,
    disclaimer: "Normalized for textual comparison only; does not claim legal-name identity.",
  };
}
