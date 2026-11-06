import { checkInvoiceArithmetic } from "./invoice-arithmetic";
import {
  checkGrossNetSanity,
  checkGrossWeight,
  checkPackageCount,
  PackageCandidate,
  WeightFieldCandidate,
} from "./weight-package-checks";
import { matchLineItems } from "./line-item-matching";

export * from "./invoice-arithmetic";
export * from "./weight-package-checks";
export * from "./line-item-matching";

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
  hsnCode?: string | null;
  sku?: string | null;
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

function result(ruleKey: string, status: CrossCheckStatus, details: Record<string, unknown>): CrossCheckResult {
  return { ruleKey, status, details };
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

  // 2. Gross Weight Comparison (CHK_GROSS_WEIGHT)
  const grossWeightCandidates: WeightFieldCandidate[] = [];
  if (invoice) {
    grossWeightCandidates.push({
      documentType: "INVOICE",
      fieldId: invoice.fields.grossWeight?.id,
      value: invoice.fields.grossWeight?.value,
      unit: invoice.fields.grossWeight?.unit,
      sourceQuote: invoice.fields.grossWeight?.sourceQuote,
    });
  }
  if (packingList) {
    grossWeightCandidates.push({
      documentType: "PACKING_LIST",
      fieldId: packingList.fields.grossWeight?.id,
      value: packingList.fields.grossWeight?.value,
      unit: packingList.fields.grossWeight?.unit,
      sourceQuote: packingList.fields.grossWeight?.sourceQuote,
    });
  }
  if (billOfLading) {
    grossWeightCandidates.push({
      documentType: "BILL_OF_LADING",
      fieldId: billOfLading.fields.grossWeight?.id,
      value: billOfLading.fields.grossWeight?.value,
      unit: billOfLading.fields.grossWeight?.unit,
      sourceQuote: billOfLading.fields.grossWeight?.sourceQuote,
    });
  }

  const grossWeightResult = checkGrossWeight({
    candidates: grossWeightCandidates,
    requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
  });
  results.push({
    ruleKey: grossWeightResult.ruleKey,
    status: grossWeightResult.status,
    details: grossWeightResult.details,
  });

  // 3. Package Count Comparison (CHK_PACKAGE_COUNT)
  const packageCandidates: PackageCandidate[] = [];
  if (
    invoice &&
    invoice.fields.packageCount &&
    invoice.fields.packageCount.value !== null &&
    invoice.fields.packageCount.value !== undefined &&
    String(invoice.fields.packageCount.value).trim().length > 0
  ) {
    packageCandidates.push({
      documentType: "INVOICE",
      fieldId: invoice.fields.packageCount.id,
      value: invoice.fields.packageCount.value,
      packageType: invoice.fields.packageCount.unit,
      unit: invoice.fields.packageCount.unit,
      sourceQuote: invoice.fields.packageCount.sourceQuote,
    });
  }
  if (packingList) {
    packageCandidates.push({
      documentType: "PACKING_LIST",
      fieldId: packingList.fields.packageCount?.id,
      value: packingList.fields.packageCount?.value,
      packageType: packingList.fields.packageCount?.unit,
      unit: packingList.fields.packageCount?.unit,
      sourceQuote: packingList.fields.packageCount?.sourceQuote,
    });
  }
  if (billOfLading) {
    packageCandidates.push({
      documentType: "BILL_OF_LADING",
      fieldId: billOfLading.fields.packageCount?.id,
      value: billOfLading.fields.packageCount?.value,
      packageType: billOfLading.fields.packageCount?.unit,
      unit: billOfLading.fields.packageCount?.unit,
      sourceQuote: billOfLading.fields.packageCount?.sourceQuote,
    });
  }

  const packageCountResult = checkPackageCount({
    candidates: packageCandidates,
    requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
  });
  results.push({
    ruleKey: packageCountResult.ruleKey,
    status: packageCountResult.status,
    details: packageCountResult.details,
  });

  // 4. Line-Item Quantity Matching (CHK_LINE_QUANTITY)
  if (!invoice || !packingList) {
    results.push(result("invoice_quantity_vs_packing_list", "NOT_APPLICABLE", { reason: "required_documents_missing" }));
  } else {
    const lineMatchingResult = matchLineItems({
      invoiceLines: invoice.lineItems.map((item, idx) => ({
        id: item.id,
        lineNumber: item.lineNumber ?? idx + 1,
        description: item.description,
        hsnCode: item.hsnCode,
        sku: item.sku,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        currency: item.currency,
        sourceQuote: item.sourceQuote,
      })),
      packingListLines: packingList.lineItems.map((item, idx) => ({
        id: item.id,
        lineNumber: item.lineNumber ?? idx + 1,
        description: item.description,
        hsnCode: item.hsnCode,
        sku: item.sku,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        currency: item.currency,
        sourceQuote: item.sourceQuote,
      })),
    });
    results.push({
      ruleKey: lineMatchingResult.ruleKey,
      status: lineMatchingResult.status,
      details: lineMatchingResult.details,
    });
  }

  // 5. Gross vs Net Weight Sanity (CHK_GROSS_NET_SANITY)
  if (!packingList) {
    results.push(result("gross_weight_vs_net_weight", "NOT_APPLICABLE", { reason: "packing_list_missing" }));
  } else {
    const sanityResult = checkGrossNetSanity({
      grossWeight: packingList.fields.grossWeight
        ? {
            id: packingList.fields.grossWeight.id,
            value: packingList.fields.grossWeight.value,
            unit: packingList.fields.grossWeight.unit,
            sourceQuote: packingList.fields.grossWeight.sourceQuote,
          }
        : null,
      netWeight: packingList.fields.netWeight
        ? {
            id: packingList.fields.netWeight.id,
            value: packingList.fields.netWeight.value,
            unit: packingList.fields.netWeight.unit,
            sourceQuote: packingList.fields.netWeight.sourceQuote,
          }
        : null,
      documentType: "PACKING_LIST",
    });
    results.push({
      ruleKey: sanityResult.ruleKey,
      status: sanityResult.status,
      details: sanityResult.details,
    });
  }

  const partyValues = [field(invoice, "exporter"), field(packingList, "exporter"), field(billOfLading, "exporter")].filter(Boolean) as string[];
  results.push(
    partyValues.length < 2
      ? result("exporter_consistency", "NOT_APPLICABLE", { reason: "fewer_than_two_parties" })
      : result("exporter_consistency", new Set(partyValues.map((value) => value.trim().toLowerCase())).size === 1 ? "PASS" : "MISMATCH", { values: partyValues }),
  );

  return results;
}
