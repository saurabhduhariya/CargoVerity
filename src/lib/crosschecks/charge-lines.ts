/**
 * Week 4 Step 2: Conservative charge-line classification for invoice line items.
 *
 * Invoices often list freight, insurance, tax, discounts and handling as extra "line items".
 * Those lines must be reconciled as charges (discount signed negative) and must never take part
 * in invoice-vs-packing-list goods matching.
 *
 * The classifier is deliberately conservative:
 * - A line with an HSN code or SKU is always goods.
 * - Every word in the description must belong to the charge vocabulary (charge keywords plus a
 *   small set of neutral modifiers and numbers). "Valves with special bulk discount" stays goods.
 * - A description naming more than one charge kind ("Freight & insurance") stays goods, because
 *   a single sign/kind cannot be assigned without guessing.
 */

export type ChargeKind = "TAX" | "FREIGHT" | "INSURANCE" | "DISCOUNT" | "OTHER";
export type LineClassification = "GOODS" | ChargeKind;

export type ClassifiableLine = {
  description?: string | null;
  hsnCode?: string | null;
  sku?: string | null;
};

const KIND_KEYWORDS: Record<ChargeKind, string[]> = {
  TAX: ["tax", "taxes", "gst", "igst", "cgst", "sgst", "utgst", "vat", "cess"],
  FREIGHT: ["freight", "shipping", "carriage", "postage"],
  INSURANCE: ["insurance"],
  DISCOUNT: ["discount", "discounts", "rebate", "rebates"],
  OTHER: ["handling", "packing", "packaging", "documentation", "surcharge", "surcharges"],
};

// Neutral words that may accompany a charge keyword without making the line goods.
const NEUTRAL_WORDS = new Set([
  "a", "an", "and", "the", "of", "on", "for", "at", "in", "to", "by", "with",
  "less", "add", "plus", "minus", "total", "amount", "amt", "value",
  "charge", "charges", "fee", "fees", "cost", "costs", "other", "misc", "miscellaneous",
  "ocean", "sea", "air", "inland", "local", "road", "rail", "courier", "express",
  "marine", "cargo", "transit",
  "trade", "special", "early", "payment", "volume", "promotional",
  "sales", "service", "services", "output", "input", "integrated", "central", "state", "goods", "and",
  "rate", "percent", "pct",
]);

const TOKEN_TO_KIND = new Map<string, ChargeKind>();
for (const [kind, words] of Object.entries(KIND_KEYWORDS) as Array<[ChargeKind, string[]]>) {
  for (const word of words) TOKEN_TO_KIND.set(word, kind);
}

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function tokenize(description: string) {
  return description
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.%]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 0);
}

function isNumericToken(token: string) {
  return /^\d+(?:\.\d+)?%?$/.test(token) || token === "%";
}

/** Classifies one invoice line as goods or a specific charge kind. */
export function classifyChargeLine(line: ClassifiableLine): LineClassification {
  if (hasText(line.hsnCode) || hasText(line.sku)) return "GOODS";
  if (!hasText(line.description)) return "GOODS";

  const tokens = tokenize(line.description as string);
  if (tokens.length === 0) return "GOODS";

  const kinds = new Set<ChargeKind>();
  for (const token of tokens) {
    const kind = TOKEN_TO_KIND.get(token);
    if (kind) {
      kinds.add(kind);
      continue;
    }
    if (NEUTRAL_WORDS.has(token) || isNumericToken(token)) continue;
    // Any other word (a product noun, brand, model number) means this is a goods line.
    return "GOODS";
  }

  if (kinds.size !== 1) return "GOODS";
  return [...kinds][0];
}

export function isChargeLine(line: ClassifiableLine): boolean {
  return classifyChargeLine(line) !== "GOODS";
}

/** Sign applied to a charge amount when reconciling the invoice total. */
export function chargeSign(kind: ChargeKind): 1 | -1 {
  return kind === "DISCOUNT" ? -1 : 1;
}

/** Splits line items into goods lines and charge lines, preserving input order. */
export function splitLines<T extends ClassifiableLine>(lines: T[]) {
  const goods: T[] = [];
  const charges: Array<{ line: T; kind: ChargeKind }> = [];
  for (const line of lines) {
    const classification = classifyChargeLine(line);
    if (classification === "GOODS") goods.push(line);
    else charges.push({ line, kind: classification });
  }
  return { goods, charges };
}
