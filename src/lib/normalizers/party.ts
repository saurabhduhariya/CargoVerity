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

// Single-token corporate designators stripped for textual comparison (never at the first token).
const LEGAL_DESIGNATORS = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "llc",
  "llp",
  "ltd",
  "limited",
  "co",
  "company",
  "gmbh",
  "sa",
  "srl",
  "spa",
  "pvt",
  "pte",
  "pty",
  "ag",
  "ab",
  "bv",
  "nv",
  "oy",
  "sdn",
  "bhd",
  "plc",
  "sro",
  "cie",
]);

// Multi-token designators matched as phrases (also never at the first token).
const LEGAL_DESIGNATOR_PHRASES: string[][] = [["private", "limited"]];

function stripDesignators(tokens: string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (index > 0) {
      const phrase = LEGAL_DESIGNATOR_PHRASES.find((words) =>
        words.every((word, offset) => tokens[index + offset] === word),
      );
      if (phrase) {
        index += phrase.length - 1;
        continue;
      }
      if (LEGAL_DESIGNATORS.has(tokens[index])) continue;
    }
    kept.push(tokens[index]);
  }
  return kept;
}

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

  // 2. Collapse dotted abbreviations (L.L.C. -> llc, S.A. -> sa, G.m.b.H. -> gmbh)
  text = text.replace(/\b(?:[a-z]\.){2,}/g, (match) => match.replace(/\./g, ""));

  // 3. Remove punctuation except alphanumeric and space
  text = text.replace(/[^a-z0-9 ]/g, " ");

  // 4. Tokenize and remove legal-form designators that are not the leading word
  //    ("SA Logistics" keeps "sa"; "Acme Pte Ltd" becomes "acme").
  const rawTokens = text.split(/\s+/).filter((token) => token.length > 0);
  const tokens = stripDesignators(rawTokens);
  const normalized = tokens.join(" ");

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
