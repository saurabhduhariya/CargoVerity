import { describe, expect, it } from "vitest";

import { checkInvoiceArithmetic } from "@/lib/crosschecks/invoice-arithmetic";

describe("Invoice Arithmetic Check (Week 4 Step 2)", () => {
  it("reconciles exact total when line items sum matches invoice total (Exact Total)", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { id: "field-total", value: "100.00" },
      currency: { id: "field-curr", value: "USD" },
      lineItems: [
        { id: "line-1", lineNumber: 1, description: "LED Panel 60W", lineTotal: "40.00", currency: "USD" },
        { id: "line-2", lineNumber: 2, description: "Mounting Bracket", lineTotal: "60.00", currency: "USD" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.invoiceTotal).toBe("100");
    expect(result.details.calculatedTotal).toBe("100");
    expect(result.details.difference).toBe("0");
    expect(result.details.currency).toBe("USD");
    expect(result.details.isDerivedTotal).toBe(false);
    expect(result.details.lines).toHaveLength(2);
    expect(result.details.sourceFieldIds.invoiceTotalFieldId).toBe("field-total");
    expect(result.details.sourceFieldIds.lineItemIds).toEqual(["line-1", "line-2"]);
  });

  it("handles decimal precision exactly (e.g. 0.10 + 0.20 = 0.30) without binary floating point errors", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { value: "0.30" },
      currency: { value: "EUR" },
      lineItems: [
        { lineNumber: 1, description: "Item A", lineTotal: "0.10" },
        { lineNumber: 2, description: "Item B", lineTotal: "0.20" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.calculatedTotal).toBe("0.3");
    expect(result.details.invoiceTotal).toBe("0.3");
    expect(result.details.difference).toBe("0");
  });

  it("passes when arithmetic difference is within the configured monetary tolerance (Rounding Tolerance)", () => {
    // 100.03 vs declared 100.00: difference 0.03 <= 0.05 default tolerance
    const withinTolerance = checkInvoiceArithmetic({
      invoiceTotal: { value: "100.00" },
      currency: { value: "USD" },
      lineItems: [
        { lineNumber: 1, description: "Item 1", lineTotal: "50.01" },
        { lineNumber: 2, description: "Item 2", lineTotal: "50.02" },
      ],
    });

    expect(withinTolerance.status).toBe("PASS");
    expect(withinTolerance.details.calculatedTotal).toBe("100.03");
    expect(withinTolerance.details.difference).toBe("0.03");

    // 100.08 vs declared 100.00: difference 0.08 > 0.05 default tolerance
    const exceedsTolerance = checkInvoiceArithmetic({
      invoiceTotal: { value: "100.00" },
      currency: { value: "USD" },
      lineItems: [
        { lineNumber: 1, description: "Item 1", lineTotal: "50.04" },
        { lineNumber: 2, description: "Item 2", lineTotal: "50.04" },
      ],
    });

    expect(exceedsTolerance.status).toBe("MISMATCH");
    expect(exceedsTolerance.details.calculatedTotal).toBe("100.08");
    expect(exceedsTolerance.details.difference).toBe("0.08");
  });

  it("calculates quantity × unitPrice when lineTotal is absent and marks it as derived", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { value: "450.00" },
      currency: { value: "USD" },
      lineItems: [
        {
          id: "derived-line",
          lineNumber: 1,
          description: "Ball Valves",
          quantity: "10",
          unitPrice: "45.00",
          lineTotal: null, // absent line total
          currency: "USD",
        },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.isDerivedTotal).toBe(true);
    expect(result.details.derivedLineCount).toBe(1);
    expect(result.details.lines[0].isDerived).toBe(true);
    expect(result.details.lines[0].amount).toBe("450");
    expect(result.details.lines[0].calculationFormula).toBe("10 × 45 = 450");
  });

  it("prefers visible lineTotal when present even if quantity and unit price exist", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { value: "500.00" },
      currency: { value: "USD" },
      lineItems: [
        {
          lineNumber: 1,
          description: "Valves with special bulk discount",
          quantity: "10",
          unitPrice: "60.00", // 10 * 60 = 600
          lineTotal: "500.00", // visible line total is preferred
        },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.calculatedTotal).toBe("500");
    expect(result.details.lines[0].isDerived).toBe(false);
  });

  it("returns INCOMPLETE when line total is absent and cannot be derived (Missing line value)", () => {
    const missingPrice = checkInvoiceArithmetic({
      invoiceTotal: { value: "100.00" },
      currency: { value: "USD" },
      lineItems: [
        {
          lineNumber: 1,
          description: "Missing price",
          quantity: "5",
          unitPrice: null, // missing unit price
          lineTotal: null, // missing line total
        },
      ],
    });

    expect(missingPrice.status).toBe("INCOMPLETE");
    expect(missingPrice.details.unreconciledReason).toBe("UNRESOLVED_LINE_TOTAL");
    expect(missingPrice.details.message).toContain("cannot be derived");
  });

  it("returns INCOMPLETE when invoice total is missing from the document (Missing total)", () => {
    const missingTotal = checkInvoiceArithmetic({
      invoiceTotal: null,
      currency: { value: "USD" },
      lineItems: [{ lineNumber: 1, description: "Item", lineTotal: "50.00" }],
    });

    expect(missingTotal.status).toBe("INCOMPLETE");
    expect(missingTotal.details.unreconciledReason).toBe("MISSING_INVOICE_TOTAL");
  });

  it("returns INCOMPLETE when invoice total is malformed", () => {
    const malformed = checkInvoiceArithmetic({
      invoiceTotal: { value: "abc" },
      currency: { value: "USD" },
      lineItems: [{ lineNumber: 1, description: "Item", lineTotal: "50.00" }],
    });

    expect(malformed.status).toBe("INCOMPLETE");
    expect(malformed.details.unreconciledReason).toBe("MALFORMED_INVOICE_TOTAL");
  });

  it("accounts for explicit tax, freight, insurance, discount, and other charges (Explicit charges)", () => {
    // lines: 1000.00
    // + tax: 80.00
    // + freight: 50.00
    // + insurance: 20.00
    // - discount: 50.00
    // + other: 10.00
    // Reconciled Total = 1110.00
    const result = checkInvoiceArithmetic({
      invoiceTotal: { id: "tot-1", value: "1110.00" },
      currency: { value: "USD" },
      taxAmount: { id: "tax-1", value: "80.00" },
      freightAmount: { id: "frt-1", value: "50.00" },
      insuranceAmount: { id: "ins-1", value: "20.00" },
      discountAmount: { id: "dsc-1", value: "50.00" },
      otherCharges: { id: "oth-1", value: "10.00" },
      lineItems: [
        { id: "l-1", lineNumber: 1, description: "Sub-assembly", lineTotal: "600.00" },
        { id: "l-2", lineNumber: 2, description: "Controllers", lineTotal: "400.00" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.charges.linesSubtotal).toBe("1000");
    expect(result.details.charges.tax).toBe("80");
    expect(result.details.charges.freight).toBe("50");
    expect(result.details.charges.insurance).toBe("20");
    expect(result.details.charges.discount).toBe("50");
    expect(result.details.charges.otherCharges).toBe("10");
    expect(result.details.charges.reconciledTotal).toBe("1110");
    expect(result.details.calculatedTotal).toBe("1110");
    expect(result.details.sourceFieldIds.taxFieldId).toBe("tax-1");
    expect(result.details.sourceFieldIds.freightFieldId).toBe("frt-1");
    expect(result.details.sourceFieldIds.insuranceFieldId).toBe("ins-1");
    expect(result.details.sourceFieldIds.discountFieldId).toBe("dsc-1");
    expect(result.details.sourceFieldIds.otherChargesFieldId).toBe("oth-1");
  });

  it("returns INCOMPLETE when line item currency conflicts with invoice currency (Currency mismatch)", () => {
    const mismatch = checkInvoiceArithmetic({
      invoiceTotal: { value: "100.00" },
      currency: { value: "USD" },
      lineItems: [
        { lineNumber: 1, description: "Item A", lineTotal: "50.00", currency: "USD" },
        { lineNumber: 2, description: "Item B (Foreign import)", lineTotal: "50.00", currency: "EUR" },
      ],
    });

    expect(mismatch.status).toBe("INCOMPLETE");
    expect(mismatch.details.unreconciledReason).toBe("LINE_ITEM_CURRENCY_MISMATCH");
    expect(mismatch.details.message).toContain("EUR");
    expect(mismatch.details.message).toContain("USD");
  });

  it("returns INCOMPLETE when invoice has no currency specified", () => {
    const noCurrency = checkInvoiceArithmetic({
      invoiceTotal: { value: "100.00" },
      currency: null,
      lineItems: [{ lineNumber: 1, description: "Item A", lineTotal: "100.00" }],
    });

    expect(noCurrency.status).toBe("INCOMPLETE");
    expect(noCurrency.details.unreconciledReason).toBe("MISSING_INVOICE_CURRENCY");
  });
});
