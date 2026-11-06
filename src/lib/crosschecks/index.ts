import Decimal from "decimal.js";
import { checkInvoiceArithmetic } from "./invoice-arithmetic";

export * from "./invoice-arithmetic";

export type CrossCheckStatus = "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
export type CrossCheckDocumentType = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";

export type CrossCheckField = {
  id?: string;
  value: string | number | null;
  unit?: string | null;
  currency?: string | null;
  sourceQuote?: string | null;
};

export type CrossCheckLineItem = {
  id?: string;
  lineNumber?: number;
  description: string | null;
  quantity: string | number | null;
  quantityUnit: string | null;
  unitPrice?: string | number | null;
  lineTotal: string | number | null;
  currency: string | null;
  sourceQuote?: string | null;
};

export type CrossCheckDocument = {
  docType: CrossCheckDocumentType;
  fields: Record<string, CrossCheckField | undefined>;
  lineItems: CrossCheckLineItem[];
};

export type CrossCheckResult = {
  ruleKey: string;
  status: CrossCheckStatus;
  details: Record<string, unknown>;
};

/**
 * The API supplies documents newest first. Ignore older retries of the same
 * document type so a failed upload cannot hide a completed extraction.
 */
export function selectLatestCrossCheckDocuments(documents: CrossCheckDocument[]) {
  const latestByType = new Map<CrossCheckDocumentType, CrossCheckDocument>();
  for (const document of documents) {
    if (!latestByType.has(document.docType)) latestByType.set(document.docType, document);
  }
  return [...latestByType.values()];
}

function field(document: CrossCheckDocument | undefined, key: string) {
  return document?.fields[key]?.value ?? null;
}

function decimal(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === "") return null;
  try {
    const parsed = new Decimal(str.replaceAll(",", ""));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeWeight(value: string | number | null | undefined, unit: string | null | undefined) {
  const parsed = decimal(value);
  if (!parsed) return null;
  const normalized = (unit ?? "kg").toLowerCase().replaceAll(".", "");
  if (["g", "gram", "grams"].includes(normalized)) return parsed.dividedBy(1000);
  if (["lb", "lbs", "pound", "pounds"].includes(normalized)) return parsed.times(0.45359237);
  if (["kg", "kgs", "kilogram", "kilograms"].includes(normalized)) return parsed;
  return null;
}

function result(ruleKey: string, status: CrossCheckStatus, details: Record<string, unknown>): CrossCheckResult {
  return { ruleKey, status, details };
}

function compareDecimal(
  ruleKey: string,
  left: Decimal | null,
  right: Decimal | null,
  details: Record<string, unknown>,
) {
  if (!left || !right) return result(ruleKey, "INCOMPLETE", details);
  return result(ruleKey, left.eq(right) ? "PASS" : "MISMATCH", details);
}

export function runCrossChecks(documents: CrossCheckDocument[]): CrossCheckResult[] {
  const invoice = documents.find((document) => document.docType === "INVOICE");
  const packingList = documents.find((document) => document.docType === "PACKING_LIST");
  const billOfLading = documents.find((document) => document.docType === "BILL_OF_LADING");
  const results: CrossCheckResult[] = [];

  if (!invoice) {
    results.push(result("invoice_line_total", "NOT_APPLICABLE", { reason: "invoice_missing" }));
  } else {
    const arithmeticResult = checkInvoiceArithmetic({
      invoiceTotal: invoice.fields.invoiceTotal
        ? {
            id: invoice.fields.invoiceTotal.id,
            value: invoice.fields.invoiceTotal.value,
            unit: invoice.fields.invoiceTotal.unit,
            currency: invoice.fields.invoiceTotal.currency,
            sourceQuote: invoice.fields.invoiceTotal.sourceQuote,
          }
        : undefined,
      currency: invoice.fields.currency
        ? {
            id: invoice.fields.currency.id,
            value: invoice.fields.currency.value,
            sourceQuote: invoice.fields.currency.sourceQuote,
          }
        : undefined,
      taxAmount: invoice.fields.taxAmount
        ? { id: invoice.fields.taxAmount.id, value: invoice.fields.taxAmount.value }
        : undefined,
      freightAmount: invoice.fields.freightAmount
        ? { id: invoice.fields.freightAmount.id, value: invoice.fields.freightAmount.value }
        : undefined,
      insuranceAmount: invoice.fields.insuranceAmount
        ? { id: invoice.fields.insuranceAmount.id, value: invoice.fields.insuranceAmount.value }
        : undefined,
      discountAmount: invoice.fields.discountAmount
        ? { id: invoice.fields.discountAmount.id, value: invoice.fields.discountAmount.value }
        : undefined,
      otherCharges: invoice.fields.otherCharges
        ? { id: invoice.fields.otherCharges.id, value: invoice.fields.otherCharges.value }
        : undefined,
      lineItems: invoice.lineItems.map((item, idx) => ({
        id: item.id,
        lineNumber: item.lineNumber ?? idx + 1,
        description: item.description,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        unitPrice: item.unitPrice,
        currency: item.currency,
        lineTotal: item.lineTotal,
        sourceQuote: item.sourceQuote,
      })),
    });

    results.push({
      ruleKey: arithmeticResult.ruleKey,
      status: arithmeticResult.status,
      details: arithmeticResult.details,
    });
  }

  const weightDocuments = [packingList, billOfLading].filter(Boolean) as CrossCheckDocument[];
  if (weightDocuments.length < 2) {
    results.push(result("gross_weight_comparison", "NOT_APPLICABLE", { reason: "fewer_than_two_weight_documents" }));
  } else {
    const left = weightDocuments[0];
    const right = weightDocuments[1];
    const leftValue = field(left, "grossWeight");
    const rightValue = field(right, "grossWeight");
    results.push(
      compareDecimal(
        "gross_weight_comparison",
        leftValue ? normalizeWeight(leftValue, left.fields.grossWeight?.unit) : null,
        rightValue ? normalizeWeight(rightValue, right.fields.grossWeight?.unit) : null,
        { left: leftValue, right: rightValue },
      ),
    );
  }

  const packageDocuments = documents.filter((document) => field(document, "packageCount") !== null);
  if (packageDocuments.length < 2) {
    results.push(result("package_count_comparison", "NOT_APPLICABLE", { reason: "fewer_than_two_package_documents" }));
  } else {
    const values = packageDocuments.map((document) => decimal(field(document, "packageCount")));
    results.push(
      values.some((value) => !value)
        ? result("package_count_comparison", "INCOMPLETE", { values: values.map((value) => value?.toString() ?? null) })
        : result(
            "package_count_comparison",
            values.every((value) => value?.eq(values[0] as Decimal)) ? "PASS" : "MISMATCH",
            { values: values.map((value) => value?.toString()) },
          ),
    );
  }

  if (!invoice || !packingList) {
    results.push(result("invoice_quantity_vs_packing_list", "NOT_APPLICABLE", { reason: "required_documents_missing" }));
  } else {
    const packingByDescription = new Map(
      packingList.lineItems.map((item) => [item.description?.trim().toLowerCase(), item]),
    );
    const quantityResults = invoice.lineItems.map((item) => {
      const match = item.description ? packingByDescription.get(item.description.trim().toLowerCase()) : undefined;
      if (!match || !item.quantity || !match.quantity) return "INCOMPLETE";
      if (item.quantityUnit && match.quantityUnit && item.quantityUnit !== match.quantityUnit) return "INCOMPLETE";
      return decimal(item.quantity)?.eq(decimal(match.quantity) ?? new Decimal(-1)) ? "PASS" : "MISMATCH";
    });
    results.push(
      quantityResults.length === 0
        ? result("invoice_quantity_vs_packing_list", "INCOMPLETE", { reason: "line_items_missing" })
        : result(
            "invoice_quantity_vs_packing_list",
            quantityResults.includes("MISMATCH")
              ? "MISMATCH"
              : quantityResults.includes("INCOMPLETE")
                ? "INCOMPLETE"
                : "PASS",
            { lineResults: quantityResults },
          ),
    );
  }

  const netWeight = packingList ? field(packingList, "netWeight") : null;
  const grossWeight = packingList ? field(packingList, "grossWeight") : null;
  if (!netWeight || !grossWeight) {
    results.push(result("gross_weight_vs_net_weight", "INCOMPLETE", { reason: "weight_missing" }));
  } else {
    const net = normalizeWeight(netWeight, packingList?.fields.netWeight?.unit);
    const gross = normalizeWeight(grossWeight, packingList?.fields.grossWeight?.unit);
    results.push(
      !net || !gross
        ? result("gross_weight_vs_net_weight", "INCOMPLETE", { reason: "unknown_weight_unit" })
        : result("gross_weight_vs_net_weight", gross.gte(net) ? "PASS" : "MISMATCH", {
            netWeight: net.toString(),
            grossWeight: gross.toString(),
          }),
    );
  }

  const partyValues = [field(invoice, "exporter"), field(packingList, "exporter"), field(billOfLading, "exporter")].filter(Boolean) as string[];
  results.push(
    partyValues.length < 2
      ? result("exporter_consistency", "NOT_APPLICABLE", { reason: "fewer_than_two_parties" })
      : result("exporter_consistency", new Set(partyValues.map((value) => value.trim().toLowerCase())).size === 1 ? "PASS" : "MISMATCH", { values: partyValues }),
  );

  return results;
}
