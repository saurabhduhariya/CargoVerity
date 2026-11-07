import Decimal from "decimal.js";
import { normalizeItemDescription, compareItemDescriptions } from "@/lib/normalizers/item";
import { parseStrictDecimal } from "@/lib/normalizers/decimal";
import { DEFAULT_TOLERANCES } from "@/lib/normalizers/tolerances";

export type LineItemInput = {
  id?: string;
  lineNumber?: number;
  description: string | null;
  hsnCode?: string | null;
  sku?: string | null;
  quantity: string | number | null;
  quantityUnit?: string | null;
  unitPrice?: string | number | null;
  lineTotal?: string | number | null;
  currency?: string | null;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type ManualLineItemMapping = {
  mappingId?: string;
  invoiceLineId: string;
  packingListLineId: string;
  /** Actor user ID. */
  mappedBy?: string;
  /** Human-readable actor label (name or email) for display. */
  mappedByLabel?: string;
  reason?: string;
  /** ISO timestamp when the mapping was created (alias: timestamp). */
  createdAt?: string;
  timestamp?: string;
};

export type StaleManualMapping = {
  mappingId?: string;
  invoiceLineId: string;
  packingListLineId: string;
  reason: "LINE_NOT_IN_CURRENT_EXTRACTION" | "LINE_ALREADY_MAPPED";
};

export type LineItemMatchingInput = {
  invoiceLines: LineItemInput[];
  packingListLines: LineItemInput[];
  manualMappings?: ManualLineItemMapping[];
  tolerance?: Decimal | number;
};

export type LineItemMatchStatus =
  | "PASS"
  | "MISMATCH"
  | "INCOMPLETE"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "INCOMPATIBLE_UNITS";

export type MatchedLinePair = {
  invoiceLineNumber?: number;
  packingListLineNumber?: number;
  invoiceLineId?: string;
  packingListLineId?: string;
  invoiceDescription: string;
  packingListDescription: string;
  mappingMethod:
    | "MANUAL"
    | "EXACT_DESCRIPTION_AND_CODE"
    | "EXACT_DESCRIPTION"
    | "TOKEN_SIMILARITY";
  mappingConfidence: number;
  invoiceQuantity: string | null;
  packingListQuantity: string | null;
  invoiceUnit: string | null;
  packingListUnit: string | null;
  canonicalUnit: string | null;
  difference: string | null;
  status: LineItemMatchStatus;
  manualEvidence?: {
    mappingId?: string;
    mappedBy?: string;
    mappedByLabel?: string;
    mappedAt?: string;
    reason?: string;
    timestamp?: string;
  };
  note: string;
};

export type UnmatchedLineItem = {
  documentType: "INVOICE" | "PACKING_LIST";
  lineId?: string;
  lineNumber?: number;
  description: string;
  quantity: string | null;
  unit: string | null;
  reason: "NO_CANDIDATE" | "AMBIGUOUS_DUPLICATE_CANDIDATES" | "ALREADY_MAPPED";
  /** Competing candidate line IDs on the other document (sorted) when ambiguous. */
  candidateLineIds?: string[];
};

export type LineItemMatchingResult = {
  ruleKey: "invoice_quantity_vs_packing_list";
  ruleCode: "CHK_LINE_QUANTITY";
  status: "PASS" | "MISMATCH" | "INCOMPLETE";
  details: {
    totalInvoiceLines: number;
    totalPackingListLines: number;
    matchedPairsCount: number;
    unmatchedInvoiceLinesCount: number;
    unmatchedPackingListLinesCount: number;
    matchedPairs: MatchedLinePair[];
    unmatchedLines: UnmatchedLineItem[];
    manualMappingsApplied: number;
    staleManualMappings: StaleManualMapping[];
    unresolvedReason?: string;
    note: string;
    message: string;
  };
};

/**
 * Standard known quantity units and aliases for customs/freight cross-checks.
 * CRITICAL RULE: PCS, BOX, CARTON, SET are NOT interchangeable.
 */
const KNOWN_QUANTITY_UNITS: Record<string, string> = {
  // Pieces / Count
  pc: "PCS",
  pcs: "PCS",
  piece: "PCS",
  pieces: "PCS",
  ea: "PCS",
  each: "PCS",
  no: "PCS",
  nos: "PCS",
  unit: "PCS",
  units: "PCS",
  item: "PCS",
  items: "PCS",

  // Boxes
  box: "BOX",
  boxes: "BOX",
  bx: "BOX",
  bxs: "BOX",

  // Cartons
  carton: "CARTON",
  cartons: "CARTON",
  ctn: "CARTON",
  ctns: "CARTON",

  // Sets
  set: "SET",
  sets: "SET",

  // Weight
  kg: "KG",
  kgs: "KG",
  kilogram: "KG",
  kilograms: "KG",
  g: "G",
  gm: "G",
  gram: "G",
  grams: "G",
  t: "TONNE",
  ton: "TONNE",
  tons: "TONNE",
  tonne: "TONNE",
  tonnes: "TONNE",
  mt: "TONNE",

  // Length
  m: "METER",
  meter: "METER",
  meters: "METER",
  mtr: "METER",
  mtrs: "METER",

  // Volume
  l: "LITER",
  liter: "LITER",
  liters: "LITER",
  litre: "LITER",
  litres: "LITER",

  // Pairs
  pr: "PAIR",
  prs: "PAIR",
  pair: "PAIR",
  pairs: "PAIR",

  // Rolls
  roll: "ROLL",
  rolls: "ROLL",

  // Packages / Packs
  pkg: "PACKAGE",
  pkgs: "PACKAGE",
  pack: "PACKAGE",
  packs: "PACKAGE",
  package: "PACKAGE",
  packages: "PACKAGE",
};

export function normalizeQuantityUnit(
  unit: string | null | undefined,
): string | null {
  if (!unit || unit.trim().length === 0) return null;
  const cleaned = unit.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return KNOWN_QUANTITY_UNITS[cleaned] ?? cleaned.toUpperCase();
}

function normalizeCode(code: string | null | undefined): string | null {
  if (!code || code.trim().length === 0) return null;
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Week 4 Step 4: Implement Line-Item Matching (CHK_LINE_QUANTITY)
 *
 * 1. Normalizes whitespace, case, and punctuation in item descriptions.
 * 2. Prefers exact description plus HSN or supplier SKU when available.
 * 3. Rejects duplicate ambiguous matches as unresolved (never uses array index).
 * 4. Never uses array index as a silent fallback.
 * 5. Allows the Executive to map an Invoice line to a Packing List line manually.
 * 6. Requires strict one-to-one mapping before comparing quantities.
 * 7. Requires compatible units or an explicit configured conversion.
 * 8. Returns INCOMPLETE for unresolved mappings.
 * 9. Stores mapping evidence and actor if manually selected.
 */
export function matchLineItems(
  input: LineItemMatchingInput,
): LineItemMatchingResult {
  const tolerance =
    input.tolerance !== undefined
      ? typeof input.tolerance === "number"
        ? new Decimal(input.tolerance)
        : input.tolerance
      : DEFAULT_TOLERANCES.quantity;

  const totalInvoiceLines = input.invoiceLines.length;
  const totalPackingListLines = input.packingListLines.length;

  if (totalInvoiceLines === 0 || totalPackingListLines === 0) {
    const note = "Both Invoice and Packing List line items are required to perform line-item matching.";
    return {
      ruleKey: "invoice_quantity_vs_packing_list",
      ruleCode: "CHK_LINE_QUANTITY",
      status: "INCOMPLETE",
      details: {
        totalInvoiceLines,
        totalPackingListLines,
        matchedPairsCount: 0,
        unmatchedInvoiceLinesCount: totalInvoiceLines,
        unmatchedPackingListLinesCount: totalPackingListLines,
        matchedPairs: [],
        unmatchedLines: [
          ...input.invoiceLines.map((l, i) => ({
            documentType: "INVOICE" as const,
            lineId: l.id,
            lineNumber: l.lineNumber ?? i + 1,
            description: l.description ?? `Invoice item ${i + 1}`,
            quantity: l.quantity ? String(l.quantity) : null,
            unit: l.quantityUnit ?? null,
            reason: "NO_CANDIDATE" as const,
          })),
          ...input.packingListLines.map((l, i) => ({
            documentType: "PACKING_LIST" as const,
            lineId: l.id,
            lineNumber: l.lineNumber ?? i + 1,
            description: l.description ?? `Packing list item ${i + 1}`,
            quantity: l.quantity ? String(l.quantity) : null,
            unit: l.quantityUnit ?? null,
            reason: "NO_CANDIDATE" as const,
          })),
        ],
        manualMappingsApplied: 0,
        staleManualMappings: (input.manualMappings ?? []).map((mapping) => ({
          mappingId: mapping.mappingId,
          invoiceLineId: mapping.invoiceLineId,
          packingListLineId: mapping.packingListLineId,
          reason: "LINE_NOT_IN_CURRENT_EXTRACTION" as const,
        })),
        unresolvedReason: "LINE_ITEMS_MISSING",
        note,
        message: note,
      },
    };
  }

  // Pre-normalize descriptions and codes
  const invItems = input.invoiceLines.map((item, idx) => ({
    item,
    index: idx,
    normDesc: normalizeItemDescription(item.description),
    hsn: normalizeCode(item.hsnCode),
    sku: normalizeCode(item.sku),
    quantityUnit: normalizeQuantityUnit(item.quantityUnit),
  }));

  const plItems = input.packingListLines.map((item, idx) => ({
    item,
    index: idx,
    normDesc: normalizeItemDescription(item.description),
    hsn: normalizeCode(item.hsnCode),
    sku: normalizeCode(item.sku),
    quantityUnit: normalizeQuantityUnit(item.quantityUnit),
  }));

  const usedInv = new Set<number>();
  const usedPl = new Set<number>();
  const matchedPairs: MatchedLinePair[] = [];
  const staleManualMappings: StaleManualMapping[] = [];
  let manualMappingsApplied = 0;

  // Ambiguity evidence collected while matching (index -> competing candidate indices on the other side).
  const ambiguousInv = new Map<number, Set<number>>();
  const ambiguousPl = new Map<number, Set<number>>();
  const noteAmbiguity = (map: Map<number, Set<number>>, index: number, others: Iterable<number>) => {
    const set = map.get(index) ?? new Set<number>();
    for (const other of others) set.add(other);
    map.set(index, set);
  };

  const findLine = (items: typeof invItems, lineId: string) =>
    items.findIndex((entry) => entry.item.id === lineId || (entry.item.id === undefined && String(entry.item.lineNumber) === lineId));

  // 1. Manual mappings first (Executive-selected, with actor and timestamp evidence).
  //    Sorted by creation time then ID so the outcome does not depend on input order.
  const manualMappings = [...(input.manualMappings ?? [])].sort((a, b) => {
    const left = a.createdAt ?? a.timestamp ?? "";
    const right = b.createdAt ?? b.timestamp ?? "";
    if (left !== right) return left < right ? -1 : 1;
    return (a.mappingId ?? "").localeCompare(b.mappingId ?? "");
  });

  for (const mapping of manualMappings) {
    const invIdx = findLine(invItems, mapping.invoiceLineId);
    const plIdx = findLine(plItems, mapping.packingListLineId);

    if (invIdx === -1 || plIdx === -1) {
      staleManualMappings.push({
        mappingId: mapping.mappingId,
        invoiceLineId: mapping.invoiceLineId,
        packingListLineId: mapping.packingListLineId,
        reason: "LINE_NOT_IN_CURRENT_EXTRACTION",
      });
      continue;
    }
    if (usedInv.has(invIdx) || usedPl.has(plIdx)) {
      staleManualMappings.push({
        mappingId: mapping.mappingId,
        invoiceLineId: mapping.invoiceLineId,
        packingListLineId: mapping.packingListLineId,
        reason: "LINE_ALREADY_MAPPED",
      });
      continue;
    }

    usedInv.add(invIdx);
    usedPl.add(plIdx);
    manualMappingsApplied += 1;
    const mappedAt = mapping.createdAt ?? mapping.timestamp;
    matchedPairs.push(
      evaluateMatchedPair({
        inv: invItems[invIdx],
        pl: plItems[plIdx],
        mappingMethod: "MANUAL",
        mappingConfidence: 1.0,
        tolerance,
        manualEvidence: {
          mappingId: mapping.mappingId,
          mappedBy: mapping.mappedBy,
          mappedByLabel: mapping.mappedByLabel,
          mappedAt,
          reason: mapping.reason,
          timestamp: mappedAt,
        },
      }),
    );
  }

  /**
   * Symmetric tier matching. For the remaining (unused) lines, candidate sets are computed in
   * BOTH directions before any pairing. A pair is accepted only when each line is the other's
   * unique (binary tiers) or strictly best (similarity tier) candidate. Nothing is claimed
   * greedily, so permuting either input list cannot change the result, and there is never an
   * array-index fallback.
   */
  type Scored = { other: number; score: number };
  const runTier = (
    method: MatchedLinePair["mappingMethod"],
    scoreOf: (inv: (typeof invItems)[number], pl: (typeof plItems)[number]) => number | null,
    acceptBest: (sorted: Scored[]) => Scored | null,
  ) => {
    const invCandidates = new Map<number, Scored[]>();
    const plCandidates = new Map<number, Scored[]>();

    for (let i = 0; i < invItems.length; i += 1) {
      if (usedInv.has(i) || !invItems[i].normDesc.ok) continue;
      for (let p = 0; p < plItems.length; p += 1) {
        if (usedPl.has(p) || !plItems[p].normDesc.ok) continue;
        const score = scoreOf(invItems[i], plItems[p]);
        if (score === null) continue;
        (invCandidates.get(i) ?? invCandidates.set(i, []).get(i)!).push({ other: p, score });
        (plCandidates.get(p) ?? plCandidates.set(p, []).get(p)!).push({ other: i, score });
      }
    }

    const sortScored = (list: Scored[]) => [...list].sort((a, b) => b.score - a.score || a.other - b.other);
    const accepted: Array<{ i: number; p: number; score: number }> = [];

    for (const [i, list] of invCandidates) {
      const best = acceptBest(sortScored(list));
      if (!best) {
        if (list.length > 1) noteAmbiguity(ambiguousInv, i, list.map((entry) => entry.other));
        continue;
      }
      const reverse = plCandidates.get(best.other) ?? [];
      const reverseBest = acceptBest(sortScored(reverse));
      if (reverseBest && reverseBest.other === i) {
        accepted.push({ i, p: best.other, score: best.score });
      } else {
        // The packing-list line is contested by several invoice lines.
        noteAmbiguity(ambiguousInv, i, [best.other]);
        noteAmbiguity(ambiguousPl, best.other, reverse.map((entry) => entry.other));
      }
    }
    for (const [p, list] of plCandidates) {
      if (list.length > 1 && !acceptBest(sortScored(list))) {
        noteAmbiguity(ambiguousPl, p, list.map((entry) => entry.other));
      }
    }

    for (const { i, p, score } of accepted) {
      usedInv.add(i);
      usedPl.add(p);
      ambiguousInv.delete(i);
      ambiguousPl.delete(p);
      matchedPairs.push(
        evaluateMatchedPair({ inv: invItems[i], pl: plItems[p], mappingMethod: method, mappingConfidence: score, tolerance }),
      );
    }
  };

  const uniqueOnly = (sorted: Scored[]) => (sorted.length === 1 ? sorted[0] : null);

  // Tier 1: exact normalized description + matching HSN or SKU.
  runTier(
    "EXACT_DESCRIPTION_AND_CODE",
    (inv, pl) => {
      if (!inv.normDesc.ok || !pl.normDesc.ok) return null;
      const descMatches = inv.normDesc.normalized === pl.normDesc.normalized;
      const hsnMatches = Boolean(inv.hsn && pl.hsn && inv.hsn === pl.hsn);
      const skuMatches = Boolean(inv.sku && pl.sku && inv.sku === pl.sku);
      return descMatches && (hsnMatches || skuMatches) ? 1 : null;
    },
    uniqueOnly,
  );

  // Tier 2: exact normalized description.
  runTier(
    "EXACT_DESCRIPTION",
    (inv, pl) => (inv.normDesc.ok && pl.normDesc.ok && inv.normDesc.normalized === pl.normDesc.normalized ? 1 : null),
    uniqueOnly,
  );

  // Tier 3: token similarity; a sole candidate, or a strictly-best candidate scoring >= 0.85.
  runTier(
    "TOKEN_SIMILARITY",
    (inv, pl) => {
      const comparison = compareItemDescriptions(inv.item.description, pl.item.description);
      return comparison.isMatch ? comparison.similarityScore : null;
    },
    (sorted) => {
      if (sorted.length === 1) return sorted[0];
      if (sorted.length > 1 && sorted[0].score > sorted[1].score && sorted[0].score >= 0.85) return sorted[0];
      return null;
    },
  );

  matchedPairs.sort(
    (a, b) =>
      (a.invoiceLineNumber ?? 0) - (b.invoiceLineNumber ?? 0) ||
      String(a.invoiceLineId ?? "").localeCompare(String(b.invoiceLineId ?? "")),
  );

  // 5. Unmatched lines (never paired by position)
  const unmatchedLines: UnmatchedLineItem[] = [];
  const candidateIds = (items: typeof invItems, indices: Set<number> | undefined) =>
    indices
      ? [...indices]
          .map((index) => items[index].item.id ?? String(items[index].item.lineNumber ?? index + 1))
          .sort()
      : undefined;
  const quantityText = (value: LineItemInput["quantity"]) =>
    value !== null && value !== undefined && String(value).trim().length > 0 ? String(value) : null;

  for (let i = 0; i < invItems.length; i += 1) {
    if (usedInv.has(i)) continue;
    const inv = invItems[i];
    const ambiguous = ambiguousInv.get(i);
    unmatchedLines.push({
      documentType: "INVOICE",
      lineId: inv.item.id,
      lineNumber: inv.item.lineNumber ?? i + 1,
      description: inv.item.description ?? `Invoice item ${i + 1}`,
      quantity: quantityText(inv.item.quantity),
      unit: inv.item.quantityUnit ?? null,
      reason: ambiguous ? "AMBIGUOUS_DUPLICATE_CANDIDATES" : "NO_CANDIDATE",
      ...(ambiguous ? { candidateLineIds: candidateIds(plItems, ambiguous) } : {}),
    });
  }

  for (let p = 0; p < plItems.length; p += 1) {
    if (usedPl.has(p)) continue;
    const pl = plItems[p];
    const ambiguous = ambiguousPl.get(p);
    unmatchedLines.push({
      documentType: "PACKING_LIST",
      lineId: pl.item.id,
      lineNumber: pl.item.lineNumber ?? p + 1,
      description: pl.item.description ?? `Packing list item ${p + 1}`,
      quantity: quantityText(pl.item.quantity),
      unit: pl.item.quantityUnit ?? null,
      reason: ambiguous ? "AMBIGUOUS_DUPLICATE_CANDIDATES" : "NO_CANDIDATE",
      ...(ambiguous ? { candidateLineIds: candidateIds(invItems, ambiguous) } : {}),
    });
  }

  // 6. Overall Status Determination (Rules 7 & 8)
  const hasQuantityMismatch = matchedPairs.some((p) => p.status === "MISMATCH");
  const hasIncompatibleUnits = matchedPairs.some(
    (p) => p.status === "INCOMPATIBLE_UNITS",
  );
  const hasIncompletePair = matchedPairs.some(
    (p) => p.status === "INCOMPLETE",
  );
  const hasUnmatched = unmatchedLines.length > 0;

  let overallStatus: "PASS" | "MISMATCH" | "INCOMPLETE";
  let unresolvedReason: string | undefined;
  let message: string;

  if (hasQuantityMismatch) {
    overallStatus = "MISMATCH";
    const mismatchCount = matchedPairs.filter((p) => p.status === "MISMATCH").length;
    message = `Line-item quantity mismatch detected on ${mismatchCount} item(s).`;
  } else if (hasIncompatibleUnits) {
    overallStatus = "INCOMPLETE";
    unresolvedReason = "INCOMPATIBLE_LINE_UNITS";
    message = "One or more matched line items have incompatible units (e.g. PCS vs BOX).";
  } else if (hasUnmatched) {
    overallStatus = "INCOMPLETE";
    unresolvedReason = "UNRESOLVED_LINE_ITEM_MAPPING";
    const ambCount = unmatchedLines.filter(
      (u) => u.reason === "AMBIGUOUS_DUPLICATE_CANDIDATES",
    ).length;
    message =
      ambCount > 0
        ? `Ambiguous duplicate item matches detected (${ambCount} unresolved items). Human review required to map lines manually.`
        : `Unresolved line-item mapping: ${unmatchedLines.length} item(s) could not be mapped one-to-one.`;
  } else if (hasIncompletePair) {
    overallStatus = "INCOMPLETE";
    unresolvedReason = "MISSING_LINE_QUANTITIES";
    message = "One or more matched line items have missing or malformed quantities.";
  } else {
    overallStatus = "PASS";
    message = `All ${matchedPairs.length} line items mapped one-to-one and quantities match.`;
  }

  return {
    ruleKey: "invoice_quantity_vs_packing_list",
    ruleCode: "CHK_LINE_QUANTITY",
    status: overallStatus,
    details: {
      totalInvoiceLines,
      totalPackingListLines,
      matchedPairsCount: matchedPairs.length,
      unmatchedInvoiceLinesCount: unmatchedLines.filter((u) => u.documentType === "INVOICE").length,
      unmatchedPackingListLinesCount: unmatchedLines.filter((u) => u.documentType === "PACKING_LIST").length,
      matchedPairs,
      unmatchedLines,
      manualMappingsApplied,
      staleManualMappings,
      unresolvedReason,
      note: message,
      message,
    },
  };
}

/**
 * Helper to evaluate a matched pair's units, quantities, and differences.
 */
function evaluateMatchedPair(params: {
  inv: {
    item: LineItemInput;
    normDesc: { raw: string };
    quantityUnit: string | null;
  };
  pl: {
    item: LineItemInput;
    normDesc: { raw: string };
    quantityUnit: string | null;
  };
  mappingMethod: MatchedLinePair["mappingMethod"];
  mappingConfidence: number;
  tolerance: Decimal;
  manualEvidence?: MatchedLinePair["manualEvidence"];
}): MatchedLinePair {
  const { inv, pl, mappingMethod, mappingConfidence, tolerance, manualEvidence } = params;

  const invDesc = inv.item.description ?? "Invoice item";
  const plDesc = pl.item.description ?? "Packing list item";
  const invUnit = inv.item.quantityUnit ?? null;
  const plUnit = pl.item.quantityUnit ?? null;

  // Rule 7: Require compatible units
  // If both have units and normalized units conflict
  if (inv.quantityUnit && pl.quantityUnit && inv.quantityUnit !== pl.quantityUnit) {
    return {
      invoiceLineNumber: inv.item.lineNumber,
      packingListLineNumber: pl.item.lineNumber,
      invoiceLineId: inv.item.id,
      packingListLineId: pl.item.id,
      invoiceDescription: invDesc,
      packingListDescription: plDesc,
      mappingMethod,
      mappingConfidence,
      invoiceQuantity: inv.item.quantity ? String(inv.item.quantity) : null,
      packingListQuantity: pl.item.quantity ? String(pl.item.quantity) : null,
      invoiceUnit: invUnit,
      packingListUnit: plUnit,
      canonicalUnit: null,
      difference: null,
      status: "INCOMPATIBLE_UNITS",
      manualEvidence,
      note: `Incompatible units: Invoice specifies '${invUnit}', but Packing List specifies '${plUnit}'.`,
    };
  }

  const canonicalUnit = inv.quantityUnit ?? pl.quantityUnit ?? null;

  // Parse decimal quantities
  const parsedInvQty = parseStrictDecimal(inv.item.quantity);
  const parsedPlQty = parseStrictDecimal(pl.item.quantity);

  if (!parsedInvQty.ok || !parsedPlQty.ok) {
    return {
      invoiceLineNumber: inv.item.lineNumber,
      packingListLineNumber: pl.item.lineNumber,
      invoiceLineId: inv.item.id,
      packingListLineId: pl.item.id,
      invoiceDescription: invDesc,
      packingListDescription: plDesc,
      mappingMethod,
      mappingConfidence,
      invoiceQuantity: inv.item.quantity ? String(inv.item.quantity) : null,
      packingListQuantity: pl.item.quantity ? String(pl.item.quantity) : null,
      invoiceUnit: invUnit,
      packingListUnit: plUnit,
      canonicalUnit,
      difference: null,
      status: "INCOMPLETE",
      manualEvidence,
      note: "Missing or malformed quantity on line item.",
    };
  }

  const diff = parsedInvQty.value.minus(parsedPlQty.value).abs();
  const diffStr = diff.toString();
  const isMatch = diff.lessThanOrEqualTo(tolerance);

  const status: LineItemMatchStatus = isMatch ? "PASS" : "MISMATCH";
  const note = isMatch
    ? `Quantities match (${parsedInvQty.value.toString()} ${canonicalUnit ?? ""}).`
    : `Quantity mismatch: Invoice declares ${parsedInvQty.value.toString()}, but Packing List declares ${parsedPlQty.value.toString()} (diff: ${diffStr} ${canonicalUnit ?? ""}).`;

  return {
    invoiceLineNumber: inv.item.lineNumber,
    packingListLineNumber: pl.item.lineNumber,
    invoiceLineId: inv.item.id,
    packingListLineId: pl.item.id,
    invoiceDescription: invDesc,
    packingListDescription: plDesc,
    mappingMethod,
    mappingConfidence,
    invoiceQuantity: parsedInvQty.value.toString(),
    packingListQuantity: parsedPlQty.value.toString(),
    invoiceUnit: invUnit,
    packingListUnit: plUnit,
    canonicalUnit,
    difference: diffStr,
    status,
    manualEvidence,
    note,
  };
}

