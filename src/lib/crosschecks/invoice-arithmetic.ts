import Decimal from "decimal.js";
import { parseStrictDecimal } from "@/lib/normalizers/decimal";
import { isIsoCurrencyCode, normalizeCurrencyCode } from "@/lib/normalizers/monetary";
import { DEFAULT_TOLERANCES } from "@/lib/normalizers/tolerances";
import { chargeSign, classifyChargeLine, type ChargeKind, type LineClassification } from "./charge-lines";

export type InvoiceFieldInput = {
  id?: string;
  value: string | number | null | undefined;
  unit?: string | null;
  currency?: string | null;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type InvoiceLineItemInput = {
  id?: string;
  lineNumber?: number;
  description?: string | null;
  hsnCode?: string | null;
  sku?: string | null;
  quantity?: string | number | null;
  quantityUnit?: string | null;
  unitPrice?: string | number | null;
  currency?: string | null;
  lineTotal?: string | number | null;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type InvoiceArithmeticInput = {
  invoiceTotal?: InvoiceFieldInput | null;
  currency?: InvoiceFieldInput | null;
  taxAmount?: InvoiceFieldInput | null;
  freightAmount?: InvoiceFieldInput | null;
  insuranceAmount?: InvoiceFieldInput | null;
  discountAmount?: InvoiceFieldInput | null;
  otherCharges?: InvoiceFieldInput | null;
  lineItems: InvoiceLineItemInput[];
  tolerance?: Decimal | number;
};

export type EvaluatedLineItem = {
  id?: string;
  lineNumber?: number;
  description: string;
  amount: string;
  currency: string;
  isDerived: boolean;
  calculationFormula?: string;
  sourceQuote?: string | null;
  classification: LineClassification;
  /** Signed contribution to the expected total (discount lines are negative). */
  signedAmount: string;
  /** True when a header charge field of the same kind is present and this line is not added again. */
  ignoredBecauseHeaderFieldPresent?: boolean;
};

export type ChargeDetails = {
  linesSubtotal: string;
  tax: string;
  freight: string;
  insurance: string;
  discount: string;
  otherCharges: string;
  reconciledTotal: string;
};

export type ComparedCharge = {
  kind: ChargeKind;
  sign: 1 | -1;
  amount: string;
  signedAmount: string;
  source: "HEADER_FIELD" | "LINE_ITEM";
  fieldId?: string;
  lineItemId?: string;
  lineNumber?: number;
};

export type InvoiceComparedValues = {
  goodsSubtotal: string | null;
  charges: ComparedCharge[];
  expectedTotal: string | null;
  invoiceTotal: string | null;
  currency: string | null;
};

export type DerivedMarker = {
  lineItemId?: string;
  lineNumber?: number;
  formula: string;
};

export type SourceFieldIds = {
  invoiceTotalFieldId?: string;
  currencyFieldId?: string;
  taxFieldId?: string;
  freightFieldId?: string;
  insuranceFieldId?: string;
  discountFieldId?: string;
  otherChargesFieldId?: string;
  lineItemIds: string[];
};

export type InvoiceArithmeticResult = {
  ruleKey: "invoice_line_total";
  status: "PASS" | "MISMATCH" | "INCOMPLETE";
  details: {
    invoiceTotal: string | null;
    calculatedTotal: string | null;
    difference: string | null;
    currency: string | null;
    toleranceUsed: string;
    isDerivedTotal: boolean;
    lineCount: number;
    goodsLineCount: number;
    chargeLineCount: number;
    derivedLineCount: number;
    lines: EvaluatedLineItem[];
    charges: ChargeDetails;
    compared: InvoiceComparedValues;
    derived: DerivedMarker[];
    sourceFieldIds: SourceFieldIds;
    /** Flat list of every field and line-item ID used by the check (for source links). */
    sourceFieldIdList: string[];
    unit: string | null;
    cause: "unknown";
    unreconciledReason?: string;
    message: string;
  };
};

const HEADER_CHARGE_KEYS: Array<{ kind: ChargeKind; key: keyof InvoiceArithmeticInput; idKey: keyof SourceFieldIds }> = [
  { kind: "TAX", key: "taxAmount", idKey: "taxFieldId" },
  { kind: "FREIGHT", key: "freightAmount", idKey: "freightFieldId" },
  { kind: "INSURANCE", key: "insuranceAmount", idKey: "insuranceFieldId" },
  { kind: "DISCOUNT", key: "discountAmount", idKey: "discountFieldId" },
  { kind: "OTHER", key: "otherCharges", idKey: "otherChargesFieldId" },
];

function present(value: unknown) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function symbolCurrency(raw: string) {
  if (raw.includes("$")) return "USD";
  if (raw.includes("€")) return "EUR";
  if (raw.includes("£")) return "GBP";
  if (raw.includes("₹")) return "INR";
  if (raw.includes("SEK") || /\bkr\b/.test(raw)) return "SEK";
  return null;
}

type CurrencyResolution =
  | { ok: true; currency: string }
  | { ok: false; reason: "MISSING_INVOICE_CURRENCY" | "INVALID_CURRENCY_CODE" | "CURRENCY_CONFLICT"; message: string };

/**
 * Header currency candidates in priority order: invoiceTotal.currency, invoiceTotal.unit (the
 * extraction pipeline stores the currency there), the `currency` field, and a symbol inside the
 * total string. Line currencies are only used when no header candidate exists. Every candidate is
 * validated against ISO 4217; two valid but different header candidates are a conflict.
 */
function resolveInvoiceCurrency(input: InvoiceArithmeticInput): CurrencyResolution {
  const rawCandidates = [
    input.invoiceTotal?.currency,
    input.invoiceTotal?.unit,
    input.currency?.value,
    present(input.invoiceTotal?.value) ? symbolCurrency(String(input.invoiceTotal?.value)) : null,
  ].filter(present).map((value) => String(value).trim());

  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const raw of rawCandidates) {
    const code = normalizeCurrencyCode(raw);
    if (code && isIsoCurrencyCode(code)) valid.add(code);
    else invalid.push(raw);
  }

  if (valid.size > 1) {
    return {
      ok: false,
      reason: "CURRENCY_CONFLICT",
      message: `Invoice currency sources disagree (${[...valid].sort().join(", ")}); cannot reconcile totals safely.`,
    };
  }
  if (valid.size === 1) return { ok: true, currency: [...valid][0] };
  if (invalid.length > 0) {
    return {
      ok: false,
      reason: "INVALID_CURRENCY_CODE",
      message: `Invoice currency "${invalid[0]}" is not a valid ISO 4217 code; cannot reconcile totals safely.`,
    };
  }

  const lineCurrencies = new Set(
    input.lineItems
      .map((item) => normalizeCurrencyCode(item.currency ?? null))
      .filter((code): code is string => Boolean(code && isIsoCurrencyCode(code))),
  );
  if (lineCurrencies.size === 1) return { ok: true, currency: [...lineCurrencies][0] };

  return {
    ok: false,
    reason: "MISSING_INVOICE_CURRENCY",
    message: "Invoice currency is missing or unverified; cannot reconcile totals safely.",
  };
}

/**
 * Week 4 Step 2: Invoice arithmetic.
 *
 * expected total = goods subtotal + tax + freight + insurance + other charges - discount
 * - Prefers the visible line total; otherwise quantity × unit price (marked derived).
 * - Charge lines (freight, insurance, tax, discount, handling) are classified conservatively and
 *   reconciled as charges; header charge fields win over same-kind lines, and a disagreement
 *   between the two is INCOMPLETE (CHARGE_SOURCE_CONFLICT) rather than a guess.
 * - PASS only when |expected - stated| <= tolerance (default ±0.01, inclusive).
 * - MISMATCH reports exact values, currency, difference and source field IDs; no cause is inferred.
 * - INCOMPLETE when values or currency are missing, malformed or conflicting.
 */
export function checkInvoiceArithmetic(input: InvoiceArithmeticInput): InvoiceArithmeticResult {
  const tolerance =
    input.tolerance !== undefined
      ? typeof input.tolerance === "number"
        ? new Decimal(input.tolerance)
        : input.tolerance
      : DEFAULT_TOLERANCES.monetary;

  const sourceFieldIds: SourceFieldIds = {
    invoiceTotalFieldId: input.invoiceTotal?.id,
    currencyFieldId: input.currency?.id,
    taxFieldId: input.taxAmount?.id,
    freightFieldId: input.freightAmount?.id,
    insuranceFieldId: input.insuranceAmount?.id,
    discountFieldId: input.discountAmount?.id,
    otherChargesFieldId: input.otherCharges?.id,
    lineItemIds: input.lineItems.map((item) => item.id).filter(Boolean) as string[],
  };
  const sourceFieldIdList = [
    sourceFieldIds.invoiceTotalFieldId,
    sourceFieldIds.currencyFieldId,
    sourceFieldIds.taxFieldId,
    sourceFieldIds.freightFieldId,
    sourceFieldIds.insuranceFieldId,
    sourceFieldIds.discountFieldId,
    sourceFieldIds.otherChargesFieldId,
    ...sourceFieldIds.lineItemIds,
  ].filter((id): id is string => typeof id === "string" && id.length > 0);

  const emptyCharges: ChargeDetails = {
    linesSubtotal: "0",
    tax: "0",
    freight: "0",
    insurance: "0",
    discount: "0",
    otherCharges: "0",
    reconciledTotal: "0",
  };

  const classifications = input.lineItems.map((item) => classifyChargeLine(item));
  const goodsLineCount = classifications.filter((value) => value === "GOODS").length;
  const chargeLineCount = classifications.length - goodsLineCount;

  const evaluatedLines: EvaluatedLineItem[] = [];
  const derived: DerivedMarker[] = [];
  const comparedCharges: ComparedCharge[] = [];
  let resolvedCurrency: string | null = null;
  let statedTotal: string | null = present(input.invoiceTotal?.value) ? String(input.invoiceTotal?.value) : null;

  const build = (
    status: InvoiceArithmeticResult["status"],
    values: {
      calculatedTotal?: string | null;
      difference?: string | null;
      goodsSubtotal?: string | null;
      charges?: ChargeDetails;
      unreconciledReason?: string;
      message: string;
    },
  ): InvoiceArithmeticResult => ({
    ruleKey: "invoice_line_total",
    status,
    details: {
      invoiceTotal: statedTotal,
      calculatedTotal: values.calculatedTotal ?? null,
      difference: values.difference ?? null,
      currency: resolvedCurrency,
      toleranceUsed: tolerance.toString(),
      isDerivedTotal: derived.length > 0,
      lineCount: input.lineItems.length,
      goodsLineCount,
      chargeLineCount,
      derivedLineCount: derived.length,
      lines: evaluatedLines,
      charges: values.charges ?? emptyCharges,
      compared: {
        goodsSubtotal: values.goodsSubtotal ?? null,
        charges: comparedCharges,
        expectedTotal: values.calculatedTotal ?? null,
        invoiceTotal: statedTotal,
        currency: resolvedCurrency,
      },
      derived,
      sourceFieldIds,
      sourceFieldIdList,
      unit: resolvedCurrency,
      cause: "unknown",
      ...(values.unreconciledReason ? { unreconciledReason: values.unreconciledReason } : {}),
      message: values.message,
    },
  });

  // 1. Currency
  const currency = resolveInvoiceCurrency(input);
  if (!currency.ok) {
    return build("INCOMPLETE", { unreconciledReason: currency.reason, message: currency.message });
  }
  resolvedCurrency = currency.currency;
  const docCurrency = currency.currency;

  // 2. Stated invoice total
  if (!input.invoiceTotal || !present(input.invoiceTotal.value)) {
    return build("INCOMPLETE", {
      unreconciledReason: "MISSING_INVOICE_TOTAL",
      message: "Invoice total is missing from the document.",
    });
  }
  const parsedTotal = parseStrictDecimal(input.invoiceTotal.value, input.invoiceTotal.sourceQuote);
  if (!parsedTotal.ok) {
    return build("INCOMPLETE", {
      unreconciledReason: "MALFORMED_INVOICE_TOTAL",
      message: `Invoice total "${input.invoiceTotal.value}" is malformed.`,
    });
  }
  const targetInvoiceTotal = parsedTotal.value;
  statedTotal = targetInvoiceTotal.toString();

  // 3. Lines
  if (input.lineItems.length === 0 || goodsLineCount === 0) {
    return build("INCOMPLETE", {
      unreconciledReason: "NO_LINE_ITEMS",
      message: "Invoice does not contain goods line items to reconcile.",
    });
  }

  let goodsSubtotal = new Decimal(0);
  const lineChargesByKind = new Map<ChargeKind, Array<{ amount: Decimal; item: InvoiceLineItemInput; index: number }>>();

  for (let i = 0; i < input.lineItems.length; i += 1) {
    const item = input.lineItems[i];
    const classification = classifications[i];
    const lineNum = item.lineNumber ?? i + 1;
    const desc = item.description?.trim() || `Line item ${lineNum}`;

    if (present(item.currency)) {
      const lineCurrency = normalizeCurrencyCode(item.currency);
      if (lineCurrency && lineCurrency !== docCurrency) {
        return build("INCOMPLETE", {
          unreconciledReason: "LINE_ITEM_CURRENCY_MISMATCH",
          message: `Line item ${lineNum} currency (${lineCurrency}) does not match invoice currency (${docCurrency}).`,
        });
      }
    }

    let lineAmount: Decimal;
    let isDerived = false;
    let calculationFormula: string | undefined;

    if (present(item.lineTotal)) {
      const parsedLineTotal = parseStrictDecimal(item.lineTotal, item.sourceQuote);
      if (!parsedLineTotal.ok) {
        return build("INCOMPLETE", {
          unreconciledReason: "MALFORMED_LINE_TOTAL",
          message: `Line item ${lineNum} has a malformed total: "${item.lineTotal}".`,
        });
      }
      lineAmount = parsedLineTotal.value;
    } else {
      if (!present(item.quantity) || !present(item.unitPrice)) {
        return build("INCOMPLETE", {
          unreconciledReason: "UNRESOLVED_LINE_TOTAL",
          message: `Line item ${lineNum} is missing line total and cannot be derived (quantity or unit price missing).`,
        });
      }
      const parsedQty = parseStrictDecimal(item.quantity);
      const parsedPrice = parseStrictDecimal(item.unitPrice);
      if (!parsedQty.ok || !parsedPrice.ok) {
        return build("INCOMPLETE", {
          unreconciledReason: "MALFORMED_LINE_CALCULATION_VALUES",
          message: `Line item ${lineNum} has malformed quantity ("${item.quantity}") or unit price ("${item.unitPrice}").`,
        });
      }
      lineAmount = parsedQty.value.times(parsedPrice.value);
      isDerived = true;
      calculationFormula = `${parsedQty.canonicalString} × ${parsedPrice.canonicalString} = ${lineAmount.toString()}`;
      derived.push({ lineItemId: item.id, lineNumber: lineNum, formula: calculationFormula });
    }

    let signedAmount = lineAmount;
    if (classification === "GOODS") {
      goodsSubtotal = goodsSubtotal.plus(lineAmount);
    } else {
      // Discount lines may be printed as "50.00" or "-50.00"; both reduce the total.
      const magnitude = lineAmount.abs();
      signedAmount = magnitude.times(chargeSign(classification));
      const list = lineChargesByKind.get(classification) ?? [];
      list.push({ amount: magnitude, item, index: evaluatedLines.length });
      lineChargesByKind.set(classification, list);
    }

    evaluatedLines.push({
      id: item.id,
      lineNumber: lineNum,
      description: desc,
      amount: lineAmount.toString(),
      currency: docCurrency,
      isDerived,
      calculationFormula,
      sourceQuote: item.sourceQuote,
      classification,
      signedAmount: signedAmount.toString(),
    });
  }

  // 4. Charges: header fields take precedence over same-kind charge lines.
  const totalsByKind: Record<ChargeKind, Decimal> = {
    TAX: new Decimal(0),
    FREIGHT: new Decimal(0),
    INSURANCE: new Decimal(0),
    DISCOUNT: new Decimal(0),
    OTHER: new Decimal(0),
  };

  for (const { kind, key } of HEADER_CHARGE_KEYS) {
    const headerField = input[key] as InvoiceFieldInput | null | undefined;
    const lineCharges = lineChargesByKind.get(kind) ?? [];
    const lineSum = lineCharges.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));

    if (headerField && present(headerField.value)) {
      const parsed = parseStrictDecimal(headerField.value, headerField.sourceQuote);
      if (!parsed.ok) {
        return build("INCOMPLETE", {
          unreconciledReason: "MALFORMED_CHARGE_VALUE",
          message: `Malformed charge value: ${headerField.value}`,
        });
      }
      const magnitude = parsed.value.abs();

      if (lineCharges.length > 0) {
        if (!lineSum.equals(magnitude)) {
          return build("INCOMPLETE", {
            unreconciledReason: "CHARGE_SOURCE_CONFLICT",
            message: `${kind} appears as a header field (${magnitude.toString()} ${docCurrency}) and as line items totalling ${lineSum.toString()} ${docCurrency}; the sources disagree.`,
          });
        }
        for (const entry of lineCharges) evaluatedLines[entry.index].ignoredBecauseHeaderFieldPresent = true;
      }

      totalsByKind[kind] = magnitude;
      comparedCharges.push({
        kind,
        sign: chargeSign(kind),
        amount: magnitude.toString(),
        signedAmount: magnitude.times(chargeSign(kind)).toString(),
        source: "HEADER_FIELD",
        fieldId: headerField.id,
      });
      continue;
    }

    for (const entry of lineCharges) {
      totalsByKind[kind] = totalsByKind[kind].plus(entry.amount);
      comparedCharges.push({
        kind,
        sign: chargeSign(kind),
        amount: entry.amount.toString(),
        signedAmount: entry.amount.times(chargeSign(kind)).toString(),
        source: "LINE_ITEM",
        lineItemId: entry.item.id,
        lineNumber: entry.item.lineNumber,
      });
    }
  }

  const reconciledTotal = goodsSubtotal
    .plus(totalsByKind.TAX)
    .plus(totalsByKind.FREIGHT)
    .plus(totalsByKind.INSURANCE)
    .minus(totalsByKind.DISCOUNT)
    .plus(totalsByKind.OTHER);

  const chargeDetails: ChargeDetails = {
    linesSubtotal: goodsSubtotal.toString(),
    tax: totalsByKind.TAX.toString(),
    freight: totalsByKind.FREIGHT.toString(),
    insurance: totalsByKind.INSURANCE.toString(),
    discount: totalsByKind.DISCOUNT.toString(),
    otherCharges: totalsByKind.OTHER.toString(),
    reconciledTotal: reconciledTotal.toString(),
  };

  // 5. Compare (inclusive tolerance)
  const diff = reconciledTotal.minus(targetInvoiceTotal).abs();
  const isMatch = diff.lessThanOrEqualTo(tolerance);

  return build(isMatch ? "PASS" : "MISMATCH", {
    calculatedTotal: reconciledTotal.toString(),
    difference: diff.toString(),
    goodsSubtotal: goodsSubtotal.toString(),
    charges: chargeDetails,
    message: isMatch
      ? `Invoice total reconciled (${reconciledTotal.toString()} ${docCurrency} vs stated ${targetInvoiceTotal.toString()} ${docCurrency}, tolerance ±${tolerance.toString()}).`
      : `Invoice arithmetic mismatch: expected ${reconciledTotal.toString()} ${docCurrency}, invoice states ${targetInvoiceTotal.toString()} ${docCurrency} (difference ${diff.toString()} ${docCurrency}, tolerance ±${tolerance.toString()}). Cause unknown.`,
  });
}
