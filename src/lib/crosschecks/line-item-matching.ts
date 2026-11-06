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
  invoiceLineId: string;
  packingListLineId: string;
  mappedBy?: string;
  reason?: string;
  timestamp?: string;
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
    mappedBy?: string;
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
  let manualMappingsApplied = 0;

  // 1. Process Manual Mappings (Rule 5 & 9)
  if (input.manualMappings && input.manualMappings.length > 0) {
    for (const mapping of input.manualMappings) {
      const invIdx = invItems.findIndex(
        (i) => i.item.id === mapping.invoiceLineId || String(i.item.lineNumber) === mapping.invoiceLineId,
      );
      const plIdx = plItems.findIndex(
        (p) => p.item.id === mapping.packingListLineId || String(p.item.lineNumber) === mapping.packingListLineId,
      );

      if (invIdx !== -1 && plIdx !== -1 && !usedInv.has(invIdx) && !usedPl.has(plIdx)) {
        usedInv.add(invIdx);
        usedPl.add(plIdx);
        manualMappingsApplied += 1;

        const inv = invItems[invIdx];
        const pl = plItems[plIdx];

        // Evaluate pair
        const pair = evaluateMatchedPair({
          inv,
          pl,
          mappingMethod: "MANUAL",
          mappingConfidence: 1.0,
          tolerance,
          manualEvidence: {
            mappedBy: mapping.mappedBy,
            reason: mapping.reason,
            timestamp: mapping.timestamp,
          },
        });
        matchedPairs.push(pair);
      }
    }
  }

  // 2. Automated Matching: Priority 1 (Exact Description + HSN/SKU) (Rule 2)
  for (let i = 0; i < invItems.length; i += 1) {
    if (usedInv.has(i)) continue;
    const inv = invItems[i];
    if (!inv.normDesc.ok) continue;

    // Check PL items that have matching HSN or SKU AND matching normalized description
    const candidates: number[] = [];
    for (let p = 0; p < plItems.length; p += 1) {
      if (usedPl.has(p)) continue;
      const pl = plItems[p];
      if (!pl.normDesc.ok) continue;

      const descMatches = inv.normDesc.normalized === pl.normDesc.normalized;
      const hsnMatches = inv.hsn && pl.hsn && inv.hsn === pl.hsn;
      const skuMatches = inv.sku && pl.sku && inv.sku === pl.sku;

      if (descMatches && (hsnMatches || skuMatches)) {
        candidates.push(p);
      }
    }

    if (candidates.length === 1) {
      const plIdx = candidates[0];
      usedInv.add(i);
      usedPl.add(plIdx);
      matchedPairs.push(
        evaluateMatchedPair({
          inv,
          pl: plItems[plIdx],
          mappingMethod: "EXACT_DESCRIPTION_AND_CODE",
          mappingConfidence: 1.0,
          tolerance,
        }),
      );
    }
  }

  // 3. Automated Matching: Priority 2 (Exact Normalized Description) (Rule 1 & 2)
  for (let i = 0; i < invItems.length; i += 1) {
    if (usedInv.has(i)) continue;
    const inv = invItems[i];
    if (!inv.normDesc.ok) continue;

    const candidates: number[] = [];
    for (let p = 0; p < plItems.length; p += 1) {
      if (usedPl.has(p)) continue;
      const pl = plItems[p];
      if (!pl.normDesc.ok) continue;

      if (inv.normDesc.normalized === pl.normDesc.normalized) {
        candidates.push(p);
      }
    }

    // Rule 3: Reject duplicate ambiguous matches as unresolved
    if (candidates.length === 1) {
      const plIdx = candidates[0];
      usedInv.add(i);
      usedPl.add(plIdx);
      matchedPairs.push(
        evaluateMatchedPair({
          inv,
          pl: plItems[plIdx],
          mappingMethod: "EXACT_DESCRIPTION",
          mappingConfidence: 1.0,
          tolerance,
        }),
      );
    }
  }

  // 4. Automated Matching: Priority 3 (Token Similarity Scoring)
  for (let i = 0; i < invItems.length; i += 1) {
    if (usedInv.has(i)) continue;
    const inv = invItems[i];
    if (!inv.normDesc.ok) continue;

    const scoredCandidates: Array<{ plIdx: number; score: number }> = [];
    for (let p = 0; p < plItems.length; p += 1) {
      if (usedPl.has(p)) continue;
      const pl = plItems[p];
      if (!pl.normDesc.ok) continue;

      const comp = compareItemDescriptions(
        inv.item.description,
        pl.item.description,
      );
      if (comp.isMatch) {
        scoredCandidates.push({ plIdx: p, score: comp.similarityScore });
      }
    }

    // Sort descending by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Only match if top candidate exists and is unambiguous (not tied with second place)
    if (
      scoredCandidates.length === 1 ||
      (scoredCandidates.length > 1 &&
        scoredCandidates[0].score > scoredCandidates[1].score &&
        scoredCandidates[0].score >= 0.85)
    ) {
      const top = scoredCandidates[0];
      const plIdx = top.plIdx;
      usedInv.add(i);
      usedPl.add(plIdx);
      matchedPairs.push(
        evaluateMatchedPair({
          inv,
          pl: plItems[plIdx],
          mappingMethod: "TOKEN_SIMILARITY",
          mappingConfidence: top.score,
          tolerance,
        }),
      );
    }
  }

  // 5. Gather Unmatched Items (Rules 3, 4, 8)
  const unmatchedLines: UnmatchedLineItem[] = [];

  for (let i = 0; i < invItems.length; i += 1) {
    if (!usedInv.has(i)) {
      const inv = invItems[i];
      // Check if it was ambiguous (multiple candidates matched description)
      const duplicateCandidates = plItems.filter(
        (p) =>
          inv.normDesc.ok &&
          p.normDesc.ok &&
          inv.normDesc.normalized === p.normDesc.normalized,
      );
      const reason =
        duplicateCandidates.length > 1
          ? "AMBIGUOUS_DUPLICATE_CANDIDATES"
          : "NO_CANDIDATE";

      unmatchedLines.push({
        documentType: "INVOICE",
        lineId: inv.item.id,
        lineNumber: inv.item.lineNumber ?? i + 1,
        description: inv.item.description ?? `Invoice item ${i + 1}`,
        quantity: inv.item.quantity ? String(inv.item.quantity) : null,
        unit: inv.item.quantityUnit ?? null,
        reason,
      });
    }
  }

  for (let p = 0; p < plItems.length; p += 1) {
    if (!usedPl.has(p)) {
      const pl = plItems[p];
      unmatchedLines.push({
        documentType: "PACKING_LIST",
        lineId: pl.item.id,
        lineNumber: pl.item.lineNumber ?? p + 1,
        description: pl.item.description ?? `Packing list item ${p + 1}`,
        quantity: pl.quantityUnit ? String(pl.item.quantity) : null,
        unit: pl.item.quantityUnit ?? null,
        reason: "NO_CANDIDATE",
      });
    }
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

