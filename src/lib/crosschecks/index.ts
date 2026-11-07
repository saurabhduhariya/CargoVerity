import { comparePartyNames } from "@/lib/normalizers/party";
import { DEFAULT_TOLERANCES, type ToleranceConfig } from "@/lib/normalizers/tolerances";
import { splitLines } from "./charge-lines";
import { checkInvoiceArithmetic, type InvoiceFieldInput } from "./invoice-arithmetic";
import {
  checkGrossNetSanityAggregate,
  checkGrossWeight,
  checkPackageCount,
  type GrossNetDocumentInput,
  type PackageCandidate,
  type WeightFieldCandidate,
} from "./weight-package-checks";
import { matchLineItems, type ManualLineItemMapping } from "./line-item-matching";

export * from "./charge-lines";
export * from "./invoice-arithmetic";
export * from "./weight-package-checks";
export * from "./line-item-matching";

export type CrossCheckStatus = "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
export type CrossCheckSeverityLevel = "BLOCKING" | "WARNING";
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
  severity: CrossCheckSeverityLevel;
  details: Record<string, unknown>;
};

export type RunCrossChecksOptions = {
  tolerances?: ToleranceConfig;
  manualMappings?: ManualLineItemMapping[];
};

/**
 * Severity per rule. WARNING failures are shown to the reviewer but never block
 * submission, approval or export. Every other rule is BLOCKING.
 */
export const RULE_SEVERITY: Record<string, CrossCheckSeverityLevel> = {
  invoice_line_total: "BLOCKING",
  gross_weight_comparison: "BLOCKING",
  package_count_comparison: "BLOCKING",
  invoice_quantity_vs_packing_list: "BLOCKING",
  gross_weight_vs_net_weight: "BLOCKING",
  exporter_consistency: "WARNING",
};

export function severityForRule(ruleKey: string): CrossCheckSeverityLevel {
  return RULE_SEVERITY[ruleKey] ?? "BLOCKING";
}

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

function result(ruleKey: string, status: CrossCheckStatus, details: Record<string, unknown>): CrossCheckResult {
  return { ruleKey, status, severity: severityForRule(ruleKey), details };
}

function invoiceField(field: CrossCheckField | undefined): InvoiceFieldInput | undefined {
  if (!field) return undefined;
  return {
    id: field.id,
    value: field.value,
    unit: field.unit,
    currency: field.currency,
    sourceQuote: field.sourceQuote,
  };
}

function weightCandidate(documentType: CrossCheckDocumentType, document: CrossCheckDocument): WeightFieldCandidate {
  const gross = document.fields.grossWeight;
  return {
    documentType,
    fieldId: gross?.id,
    value: gross?.value,
    unit: gross?.unit,
    sourceQuote: gross?.sourceQuote,
  };
}

function weightInput(field: CrossCheckField | undefined) {
  return field ? { id: field.id, value: field.value, unit: field.unit, sourceQuote: field.sourceQuote } : null;
}

/** Exporter names compared via the party normalizer (textual only; not a legal-identity claim). */
export function checkExporterConsistency(documents: Array<{ documentType: CrossCheckDocumentType; field?: CrossCheckField }>) {
  const values = documents
    .filter((entry) => entry.field?.value !== null && entry.field?.value !== undefined && String(entry.field.value).trim().length > 0)
    .map((entry) => ({ documentType: entry.documentType, fieldId: entry.field?.id, value: String(entry.field?.value) }));

  if (values.length < 2) {
    return result("exporter_consistency", "NOT_APPLICABLE", { reason: "fewer_than_two_parties", values });
  }

  const comparisons = [];
  for (let index = 1; index < values.length; index += 1) {
    const comparison = comparePartyNames(values[0].value, values[index].value);
    comparisons.push({
      left: values[0].documentType,
      right: values[index].documentType,
      isMatch: comparison.isMatch,
      similarityScore: comparison.similarityScore,
      leftNormalized: comparison.leftNormalized,
      rightNormalized: comparison.rightNormalized,
    });
  }
  const allMatch = comparisons.every((comparison) => comparison.isMatch);

  return result("exporter_consistency", allMatch ? "PASS" : "MISMATCH", {
    values,
    comparisons,
    sourceFieldIds: values.map((value) => value.fieldId).filter(Boolean),
    legalIdentityClaimed: false,
    disclaimer: "Normalized for textual comparison only; does not claim legal-name identity.",
    cause: "unknown",
    message: allMatch
      ? "Exporter names match after normalization."
      : "Exporter names differ across documents after normalization. Cause is not stated in source documents.",
  });
}

export function runCrossChecks(documents: CrossCheckDocument[], options: RunCrossChecksOptions = {}): CrossCheckResult[] {
  const tolerances = options.tolerances ?? DEFAULT_TOLERANCES;
  const invoice = documents.find((document) => document.docType === "INVOICE");
  const packingList = documents.find((document) => document.docType === "PACKING_LIST");
  const billOfLading = documents.find((document) => document.docType === "BILL_OF_LADING");
  const results: CrossCheckResult[] = [];

  // 1. Invoice arithmetic (CHK_INVOICE_ARITHMETIC)
  if (!invoice) {
    results.push(result("invoice_line_total", "NOT_APPLICABLE", { reason: "invoice_missing" }));
  } else {
    const arithmeticResult = checkInvoiceArithmetic({
      invoiceTotal: invoiceField(invoice.fields.invoiceTotal),
      currency: invoiceField(invoice.fields.currency),
      taxAmount: invoiceField(invoice.fields.taxAmount),
      freightAmount: invoiceField(invoice.fields.freightAmount),
      insuranceAmount: invoiceField(invoice.fields.insuranceAmount),
      discountAmount: invoiceField(invoice.fields.discountAmount),
      otherCharges: invoiceField(invoice.fields.otherCharges),
      tolerance: tolerances.monetary,
      lineItems: invoice.lineItems.map((item, idx) => ({
        id: item.id,
        lineNumber: item.lineNumber ?? idx + 1,
        description: item.description,
        hsnCode: item.hsnCode,
        sku: item.sku,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        unitPrice: item.unitPrice,
        currency: item.currency,
        lineTotal: item.lineTotal,
        sourceQuote: item.sourceQuote,
      })),
    });
    results.push(result(arithmeticResult.ruleKey, arithmeticResult.status, arithmeticResult.details));
  }

  // 2. Gross weight comparison (CHK_GROSS_WEIGHT), dynamic ±percent tolerance
  const grossWeightCandidates: WeightFieldCandidate[] = [];
  if (invoice) grossWeightCandidates.push(weightCandidate("INVOICE", invoice));
  if (packingList) grossWeightCandidates.push(weightCandidate("PACKING_LIST", packingList));
  if (billOfLading) grossWeightCandidates.push(weightCandidate("BILL_OF_LADING", billOfLading));

  const grossWeightResult = checkGrossWeight({
    candidates: grossWeightCandidates,
    requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
    tolerances,
  });
  results.push(result(grossWeightResult.ruleKey, grossWeightResult.status, grossWeightResult.details));

  // 3. Package count comparison (CHK_PACKAGE_COUNT)
  const packageCandidates: PackageCandidate[] = [];
  const packageField = (document: CrossCheckDocument) => document.fields.packageCount;
  if (invoice) {
    const value = packageField(invoice)?.value;
    if (value !== null && value !== undefined && String(value).trim().length > 0) {
      packageCandidates.push({
        documentType: "INVOICE",
        fieldId: packageField(invoice)?.id,
        value,
        packageType: packageField(invoice)?.unit,
        unit: packageField(invoice)?.unit,
        sourceQuote: packageField(invoice)?.sourceQuote,
      });
    }
  }
  for (const [documentType, document] of [
    ["PACKING_LIST", packingList],
    ["BILL_OF_LADING", billOfLading],
  ] as const) {
    if (!document) continue;
    packageCandidates.push({
      documentType,
      fieldId: packageField(document)?.id,
      value: packageField(document)?.value,
      packageType: packageField(document)?.unit,
      unit: packageField(document)?.unit,
      sourceQuote: packageField(document)?.sourceQuote,
    });
  }

  const packageCountResult = checkPackageCount({
    candidates: packageCandidates,
    requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
  });
  results.push(result(packageCountResult.ruleKey, packageCountResult.status, packageCountResult.details));

  // 4. Line-item quantity matching (CHK_LINE_QUANTITY) on goods lines only
  if (!invoice || !packingList) {
    results.push(result("invoice_quantity_vs_packing_list", "NOT_APPLICABLE", { reason: "required_documents_missing" }));
  } else {
    const toMatchLine = (item: CrossCheckLineItem, idx: number) => ({
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
    });
    const invoiceSplit = splitLines(invoice.lineItems.map(toMatchLine));
    const packingSplit = splitLines(packingList.lineItems.map(toMatchLine));

    const lineMatchingResult = matchLineItems({
      invoiceLines: invoiceSplit.goods,
      packingListLines: packingSplit.goods,
      manualMappings: options.manualMappings,
      tolerance: tolerances.quantity,
    });
    results.push(
      result(lineMatchingResult.ruleKey, lineMatchingResult.status, {
        ...lineMatchingResult.details,
        excludedChargeLines: [...invoiceSplit.charges, ...packingSplit.charges].map(({ line, kind }) => ({
          lineId: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          kind,
        })),
      }),
    );
  }

  // 5. Gross >= Net on every document that states both (CHK_GROSS_NET_SANITY)
  const sanityDocuments: GrossNetDocumentInput[] = [];
  for (const [documentType, document] of [
    ["INVOICE", invoice],
    ["PACKING_LIST", packingList],
    ["BILL_OF_LADING", billOfLading],
  ] as const) {
    if (!document) continue;
    sanityDocuments.push({
      documentType,
      grossWeight: weightInput(document.fields.grossWeight),
      netWeight: weightInput(document.fields.netWeight),
    });
  }
  const sanityResult = checkGrossNetSanityAggregate({ documents: sanityDocuments });
  results.push(result(sanityResult.ruleKey, sanityResult.status, sanityResult.details));

  // 6. Exporter consistency (WARNING severity)
  results.push(
    checkExporterConsistency([
      { documentType: "INVOICE", field: invoice?.fields.exporter },
      { documentType: "PACKING_LIST", field: packingList?.fields.exporter },
      { documentType: "BILL_OF_LADING", field: billOfLading?.fields.exporter },
    ]),
  );

  return results;
}
