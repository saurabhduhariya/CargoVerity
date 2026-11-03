import Decimal from "decimal.js";

export type CrossCheckStatus = "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
export type CrossCheckDocumentType = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";

export type CrossCheckField = {
  value: string | null;
  unit?: string | null;
};

export type CrossCheckLineItem = {
  description: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  lineTotal: string | null;
  currency: string | null;
};

export type CrossCheckDocument = {
  type: CrossCheckDocumentType;
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
    if (!latestByType.has(document.type)) latestByType.set(document.type, document);
  }
  return [...latestByType.values()];
}

function field(document: CrossCheckDocument | undefined, key: string) {
  return document?.fields[key]?.value ?? null;
}

function decimal(value: string | null) {
  if (value === null || value.trim() === "") return null;
  try {
    const parsed = new Decimal(value.replaceAll(",", "").trim());
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeWeight(value: string, unit: string | null | undefined) {
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
  const invoice = documents.find((document) => document.type === "INVOICE");
  const packingList = documents.find((document) => document.type === "PACKING_LIST");
  const billOfLading = documents.find((document) => document.type === "BILL_OF_LADING");
  const results: CrossCheckResult[] = [];

  if (!invoice) {
    results.push(result("invoice_line_total", "NOT_APPLICABLE", { reason: "invoice_missing" }));
  } else {
    const invoiceTotal = decimal(field(invoice, "invoiceTotal"));
    const currency = field(invoice, "currency");
    const lineCurrencies = invoice.lineItems.map((item) => item.currency).filter(Boolean);
    const currencyComparable = lineCurrencies.every((item) => item === currency || !item || !currency);
    const lineSum = invoice.lineItems.reduce<Decimal | null>((sum, item) => {
      const value = decimal(item.lineTotal);
      if (!value) return sum;
      return (sum ?? new Decimal(0)).plus(value);
    }, null);

    results.push(
      !currencyComparable
        ? result("invoice_line_total", "INCOMPLETE", { reason: "currency_mismatch" })
        : compareDecimal("invoice_line_total", lineSum, invoiceTotal, {
            lineSum: lineSum?.toString() ?? null,
            invoiceTotal: invoiceTotal?.toString() ?? null,
            currency,
          }),
    );
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
