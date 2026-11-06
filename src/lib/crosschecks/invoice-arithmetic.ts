import Decimal from "decimal.js";
import { parseStrictDecimal } from "@/lib/normalizers/decimal";
import { normalizeCurrencyCode } from "@/lib/normalizers/monetary";
import { DEFAULT_TOLERANCES } from "@/lib/normalizers/tolerances";

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
    derivedLineCount: number;
    lines: EvaluatedLineItem[];
    charges: ChargeDetails;
    sourceFieldIds: SourceFieldIds;
    unreconciledReason?: string;
    message: string;
  };
};

/**
 * Week 4 Step 2: Implement invoice arithmetic.
 *
 * Reconciles invoice line items against invoice total:
 * 1. Reads the invoice total and all line items.
 * 2. Prefers a visible line total when present.
 * 3. If line total is absent, calculates quantity × unit price with decimal arithmetic.
 * 4. Marks calculated line totals as derived.
 * 5. Includes currency in the comparison and prevents cross-currency mixing.
 * 6. Accounts for explicit tax, freight, insurance, discount, and charge lines.
 * 7. Returns INCOMPLETE when lines, total, or currencies cannot be reconciled.
 * 8. Returns PASS only within the configured monetary tolerance (default: 0.05).
 * 9. Returns MISMATCH with compared values and difference when arithmetic fails.
 * 10. Preserves all source field IDs in the result.
 */
export function checkInvoiceArithmetic(
  input: InvoiceArithmeticInput,
): InvoiceArithmeticResult {
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

  const emptyCharges: ChargeDetails = {
    linesSubtotal: "0",
    tax: "0",
    freight: "0",
    insurance: "0",
    discount: "0",
    otherCharges: "0",
    reconciledTotal: "0",
  };

  // 1. Resolve Document Currency
  let rawDocCurrency = input.currency?.value ?? input.invoiceTotal?.currency;
  if (!rawDocCurrency && input.invoiceTotal?.value) {
    const totalStr = String(input.invoiceTotal.value);
    if (totalStr.includes("$")) rawDocCurrency = "USD";
    else if (totalStr.includes("€")) rawDocCurrency = "EUR";
    else if (totalStr.includes("£")) rawDocCurrency = "GBP";
    else if (totalStr.includes("SEK") || totalStr.includes("kr")) rawDocCurrency = "SEK";
  }

  const docCurrency = normalizeCurrencyCode(
    rawDocCurrency ? String(rawDocCurrency) : null,
  );

  if (!docCurrency) {
    return {
      ruleKey: "invoice_line_total",
      status: "INCOMPLETE",
      details: {
        invoiceTotal: input.invoiceTotal?.value ? String(input.invoiceTotal.value) : null,
        calculatedTotal: null,
        difference: null,
        currency: null,
        toleranceUsed: tolerance.toString(),
        isDerivedTotal: false,
        lineCount: input.lineItems.length,
        derivedLineCount: 0,
        lines: [],
        charges: emptyCharges,
        sourceFieldIds,
        unreconciledReason: "MISSING_INVOICE_CURRENCY",
        message: "Invoice currency is missing or unverified; cannot reconcile totals safely.",
      },
    };
  }

  // 2. Resolve & Validate Invoice Total
  if (!input.invoiceTotal || input.invoiceTotal.value === null || input.invoiceTotal.value === undefined || String(input.invoiceTotal.value).trim() === "") {
    return {
      ruleKey: "invoice_line_total",
      status: "INCOMPLETE",
      details: {
        invoiceTotal: null,
        calculatedTotal: null,
        difference: null,
        currency: docCurrency,
        toleranceUsed: tolerance.toString(),
        isDerivedTotal: false,
        lineCount: input.lineItems.length,
        derivedLineCount: 0,
        lines: [],
        charges: emptyCharges,
        sourceFieldIds,
        unreconciledReason: "MISSING_INVOICE_TOTAL",
        message: "Invoice total is missing from the document.",
      },
    };
  }

  const parsedTotal = parseStrictDecimal(
    input.invoiceTotal.value,
    input.invoiceTotal.sourceQuote,
  );

  if (!parsedTotal.ok) {
    return {
      ruleKey: "invoice_line_total",
      status: "INCOMPLETE",
      details: {
        invoiceTotal: String(input.invoiceTotal.value),
        calculatedTotal: null,
        difference: null,
        currency: docCurrency,
        toleranceUsed: tolerance.toString(),
        isDerivedTotal: false,
        lineCount: input.lineItems.length,
        derivedLineCount: 0,
        lines: [],
        charges: emptyCharges,
        sourceFieldIds,
        unreconciledReason: "MALFORMED_INVOICE_TOTAL",
        message: `Invoice total "${input.invoiceTotal.value}" is malformed.`,
      },
    };
  }

  const targetInvoiceTotal = parsedTotal.value;

  // 3. Process Line Items
  if (input.lineItems.length === 0) {
    return {
      ruleKey: "invoice_line_total",
      status: "INCOMPLETE",
      details: {
        invoiceTotal: targetInvoiceTotal.toString(),
        calculatedTotal: null,
        difference: null,
        currency: docCurrency,
        toleranceUsed: tolerance.toString(),
        isDerivedTotal: false,
        lineCount: 0,
        derivedLineCount: 0,
        lines: [],
        charges: emptyCharges,
        sourceFieldIds,
        unreconciledReason: "NO_LINE_ITEMS",
        message: "Invoice does not contain line items to reconcile.",
      },
    };
  }

  const evaluatedLines: EvaluatedLineItem[] = [];
  let linesSubtotal = new Decimal(0);
  let derivedLineCount = 0;

  for (let i = 0; i < input.lineItems.length; i += 1) {
    const item = input.lineItems[i];
    const lineNum = item.lineNumber ?? i + 1;
    const desc = item.description?.trim() || `Line item ${lineNum}`;

    // Verify line currency if present
    if (item.currency) {
      const lineCurrency = normalizeCurrencyCode(item.currency);
      if (lineCurrency && lineCurrency !== docCurrency) {
        return {
          ruleKey: "invoice_line_total",
          status: "INCOMPLETE",
          details: {
            invoiceTotal: targetInvoiceTotal.toString(),
            calculatedTotal: null,
            difference: null,
            currency: docCurrency,
            toleranceUsed: tolerance.toString(),
            isDerivedTotal: false,
            lineCount: input.lineItems.length,
            derivedLineCount,
            lines: evaluatedLines,
            charges: emptyCharges,
            sourceFieldIds,
            unreconciledReason: "LINE_ITEM_CURRENCY_MISMATCH",
            message: `Line item ${lineNum} currency (${lineCurrency}) does not match invoice currency (${docCurrency}).`,
          },
        };
      }
    }

    // Rule 2 & 3: Prefer visible line total when present; otherwise calculate qty × unitPrice
    const hasExplicitLineTotal =
      item.lineTotal !== null &&
      item.lineTotal !== undefined &&
      String(item.lineTotal).trim().length > 0;

    let lineAmount: Decimal;
    let isDerived = false;
    let calculationFormula: string | undefined;

    if (hasExplicitLineTotal) {
      const parsedLineTotal = parseStrictDecimal(item.lineTotal, item.sourceQuote);
      if (!parsedLineTotal.ok) {
        return {
          ruleKey: "invoice_line_total",
          status: "INCOMPLETE",
          details: {
            invoiceTotal: targetInvoiceTotal.toString(),
            calculatedTotal: null,
            difference: null,
            currency: docCurrency,
            toleranceUsed: tolerance.toString(),
            isDerivedTotal: false,
            lineCount: input.lineItems.length,
            derivedLineCount,
            lines: evaluatedLines,
            charges: emptyCharges,
            sourceFieldIds,
            unreconciledReason: "MALFORMED_LINE_TOTAL",
            message: `Line item ${lineNum} has a malformed total: "${item.lineTotal}".`,
          },
        };
      }
      lineAmount = parsedLineTotal.value;
    } else {
      // Rule 3: Calculate quantity × unit price with decimal arithmetic
      const hasQty = item.quantity !== null && item.quantity !== undefined && String(item.quantity).trim().length > 0;
      const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined && String(item.unitPrice).trim().length > 0;

      if (!hasQty || !hasPrice) {
        return {
          ruleKey: "invoice_line_total",
          status: "INCOMPLETE",
          details: {
            invoiceTotal: targetInvoiceTotal.toString(),
            calculatedTotal: null,
            difference: null,
            currency: docCurrency,
            toleranceUsed: tolerance.toString(),
            isDerivedTotal: false,
            lineCount: input.lineItems.length,
            derivedLineCount,
            lines: evaluatedLines,
            charges: emptyCharges,
            sourceFieldIds,
            unreconciledReason: "UNRESOLVED_LINE_TOTAL",
            message: `Line item ${lineNum} is missing line total and cannot be derived (quantity or unit price missing).`,
          },
        };
      }

      const parsedQty = parseStrictDecimal(item.quantity);
      const parsedPrice = parseStrictDecimal(item.unitPrice);

      if (!parsedQty.ok || !parsedPrice.ok) {
        return {
          ruleKey: "invoice_line_total",
          status: "INCOMPLETE",
          details: {
            invoiceTotal: targetInvoiceTotal.toString(),
            calculatedTotal: null,
            difference: null,
            currency: docCurrency,
            toleranceUsed: tolerance.toString(),
            isDerivedTotal: false,
            lineCount: input.lineItems.length,
            derivedLineCount,
            lines: evaluatedLines,
            charges: emptyCharges,
            sourceFieldIds,
            unreconciledReason: "MALFORMED_LINE_CALCULATION_VALUES",
            message: `Line item ${lineNum} has malformed quantity ("${item.quantity}") or unit price ("${item.unitPrice}").`,
          },
        };
      }

      lineAmount = parsedQty.value.times(parsedPrice.value);
      isDerived = true;
      derivedLineCount += 1;
      calculationFormula = `${parsedQty.canonicalString} × ${parsedPrice.canonicalString} = ${lineAmount.toString()}`;
    }

    linesSubtotal = linesSubtotal.plus(lineAmount);

    evaluatedLines.push({
      id: item.id,
      lineNumber: lineNum,
      description: desc,
      amount: lineAmount.toString(),
      currency: docCurrency,
      isDerived,
      calculationFormula,
      sourceQuote: item.sourceQuote,
    });
  }

  // 4. Rule 6: Account for explicit charges (tax, freight, insurance, discount, other)
  function parseCharge(chargeField?: InvoiceFieldInput | null): { value: Decimal; id?: string; error?: string } {
    if (!chargeField || chargeField.value === null || chargeField.value === undefined || String(chargeField.value).trim() === "") {
      return { value: new Decimal(0), id: chargeField?.id };
    }
    const parsed = parseStrictDecimal(chargeField.value, chargeField.sourceQuote);
    if (!parsed.ok) {
      return { value: new Decimal(0), id: chargeField.id, error: `Malformed charge value: ${chargeField.value}` };
    }
    return { value: parsed.value, id: chargeField.id };
  }

  const tax = parseCharge(input.taxAmount);
  const freight = parseCharge(input.freightAmount);
  const insurance = parseCharge(input.insuranceAmount);
  const discount = parseCharge(input.discountAmount);
  const otherCharges = parseCharge(input.otherCharges);

  const chargeError = tax.error || freight.error || insurance.error || discount.error || otherCharges.error;
  if (chargeError) {
    return {
      ruleKey: "invoice_line_total",
      status: "INCOMPLETE",
      details: {
        invoiceTotal: targetInvoiceTotal.toString(),
        calculatedTotal: null,
        difference: null,
        currency: docCurrency,
        toleranceUsed: tolerance.toString(),
        isDerivedTotal: derivedLineCount > 0,
        lineCount: input.lineItems.length,
        derivedLineCount,
        lines: evaluatedLines,
        charges: emptyCharges,
        sourceFieldIds,
        unreconciledReason: "MALFORMED_CHARGE_VALUE",
        message: chargeError,
      },
    };
  }

  // Reconciled total = linesSubtotal + tax + freight + insurance - discount + otherCharges
  const reconciledTotal = linesSubtotal
    .plus(tax.value)
    .plus(freight.value)
    .plus(insurance.value)
    .minus(discount.value)
    .plus(otherCharges.value);

  const chargeDetails: ChargeDetails = {
    linesSubtotal: linesSubtotal.toString(),
    tax: tax.value.toString(),
    freight: freight.value.toString(),
    insurance: insurance.value.toString(),
    discount: discount.value.toString(),
    otherCharges: otherCharges.value.toString(),
    reconciledTotal: reconciledTotal.toString(),
  };

  // 5. Compare with tolerance
  const diff = reconciledTotal.minus(targetInvoiceTotal).abs();
  const isMatch = diff.lessThanOrEqualTo(tolerance);

  const status: "PASS" | "MISMATCH" = isMatch ? "PASS" : "MISMATCH";
  const message = isMatch
    ? `Invoice total reconciled successfully (${reconciledTotal.toString()} ${docCurrency} vs declared ${targetInvoiceTotal.toString()} ${docCurrency}, tolerance ${tolerance.toString()}).`
    : `Invoice arithmetic mismatch: reconciled total is ${reconciledTotal.toString()} ${docCurrency}, but invoice declares ${targetInvoiceTotal.toString()} ${docCurrency} (diff: ${diff.toString()} ${docCurrency}).`;

  return {
    ruleKey: "invoice_line_total",
    status,
    details: {
      invoiceTotal: targetInvoiceTotal.toString(),
      calculatedTotal: reconciledTotal.toString(),
      difference: diff.toString(),
      currency: docCurrency,
      toleranceUsed: tolerance.toString(),
      isDerivedTotal: derivedLineCount > 0,
      lineCount: input.lineItems.length,
      derivedLineCount,
      lines: evaluatedLines,
      charges: chargeDetails,
      sourceFieldIds,
      message,
    },
  };
}

