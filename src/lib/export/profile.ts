/**
 * CargoVerity Export Profile Definitions (Week 5 Step 3)
 *
 * Requirements:
 * 1. Typed ExportProfile representation.
 * 2. Profile ID and version, initially demo-v1.
 * 3. Ordered columns and source-field mappings.
 * 4. Date, number, null and unit formatting.
 * 5. Line-item row expansion (repeats shipment columns per line item).
 * 6. Labels mapping as an assumption ([ASSUMPTION] Temporary export profile).
 * 7. Excludes personal contacts (telephone, personal addresses).
 * 8. Validation list for required export fields.
 * 9. Pluggable registry so client templates can replace demo-v1 without changing domain data.
 */

export const DEMO_V1_COLUMNS = [
  "Shipment_Ref",
  "Supplier_Name",
  "Invoice_No",
  "Invoice_Date",
  "Currency",
  "Incoterm",
  "Item_Sr",
  "HSN_Code",
  "Item_Description",
  "Quantity",
  "Unit",
  "Unit_Price",
  "Line_Total",
  "Gross_Weight_KG",
  "Net_Weight_KG",
  "Package_Count",
  "Package_Type",
  "Container_No",
  "Port_Of_Loading",
  "Port_Of_Discharge",
  "BL_No",
  "BL_Date",
  "Approved_By",
  "Approved_At",
] as const;

export type DemoV1Column = (typeof DEMO_V1_COLUMNS)[number];

export const DEMO_V1_REQUIRED_FIELDS = [
  "Shipment_Ref",
  "Supplier_Name",
  "Invoice_No",
  "Invoice_Date",
  "Currency",
  "Gross_Weight_KG",
  "Package_Count",
  "Approved_By",
  "Approved_At",
] as const;

export interface ExportFieldSnapshot {
  fieldKey: string;
  currentValue: string | null;
  unit?: string | null;
  sourceQuote?: string | null;
  pageNumber?: number | null;
}

export interface ExportLineItemSnapshot {
  lineNumber: number;
  description: string | null;
  hsnCode?: string | null;
  quantity?: unknown;
  quantityUnit?: string | null;
  unitPrice?: unknown;
  currency?: string | null;
  lineTotal?: unknown;
  sourceQuote?: string | null;
  pageNumber?: number | null;
}

export interface ExportDocumentSnapshot {
  docType: string;
  fields: ExportFieldSnapshot[];
  lineItems: ExportLineItemSnapshot[];
}

export interface ShipmentExportSnapshot {
  shipmentReference: string;
  supplierName?: string | null;
  importerName?: string | null;
  documents: ExportDocumentSnapshot[];
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  approvedRevision?: number | null;
}

export interface ExportProfileResult {
  headers: string[];
  rows: string[][];
  csv: string;
  profileId: string;
  profileVersion: string;
  assumptionLabel: string;
}

export interface ExportValidationResult {
  valid: boolean;
  missingFields: string[];
}

export interface ExportProfile {
  id: string;
  version: string;
  name: string;
  assumptionLabel: string;
  columns: readonly string[];
  requiredFields: readonly string[];
  generateRows: (snapshot: ShipmentExportSnapshot) => ExportProfileResult;
  validate: (snapshot: ShipmentExportSnapshot) => ExportValidationResult;
}

/**
 * Formats dates into ISO standard YYYY-MM-DD.
 */
export function formatExportDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return "";

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // If ISO date string
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return str.slice(0, 10);
  }

  // Attempt parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return str;
}

/**
 * Formats numbers into clean decimal strings without scientific notation.
 */
export function formatExportNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (!isNaN(num) && Number.isFinite(num)) {
    // Preserve string decimal if provided, else format number
    const str = String(value).trim();
    if (/^-?\d+(\.\d+)?$/.test(str)) return str;
    return String(num);
  }
  return String(value).trim();
}

/**
 * Sanitizes cell values to guard against spreadsheet formula injection (RFC 4180 security).
 * Formula starters (=, +, -, @, \t, \r) are prefixed with a single quote unless it's a valid negative number.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str === "") return "";

  // Preserve valid negative numbers (e.g. -12.50) without prefixing
  if (/^-\d+(\.\d+)?$/.test(str.trim())) {
    return str;
  }

  const firstChar = str.charAt(0);
  if (["=", "+", "-", "@", "\t", "\r"].includes(firstChar)) {
    return `'${str}`;
  }

  return str;
}

/**
 * Escapes cell content according to RFC 4180 rules.
 */
export function escapeCsvCell(value: unknown): string {
  const sanitized = sanitizeCsvCell(value);
  if (
    sanitized.includes(",") ||
    sanitized.includes('"') ||
    sanitized.includes("\n") ||
    sanitized.includes("\r")
  ) {
    return `"${sanitized.replaceAll('"', '""')}"`;
  }
  return `"${sanitized}"`;
}

/**
 * Serializes rows into an RFC 4180 CSV string.
 */
export function serializeCsv(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  return allRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function getFieldValue(doc: ExportDocumentSnapshot | undefined, key: string): string | null {
  if (!doc) return null;
  const f = doc.fields.find((field) => field.fieldKey === key);
  return f?.currentValue ?? null;
}

/**
 * The demo-v1 export profile implementation.
 */
export const demoV1Profile: ExportProfile = {
  id: "demo-v1",
  version: "1.0.0",
  name: "Demo V1 Customs Reconciliation Profile",
  assumptionLabel:
    "[ASSUMPTION] Temporary export profile demo-v1; filing-software customs template awaiting client specification.",
  columns: DEMO_V1_COLUMNS,
  requiredFields: DEMO_V1_REQUIRED_FIELDS,

  validate(snapshot: ShipmentExportSnapshot): ExportValidationResult {
    const missingFields: string[] = [];
    const invDoc = snapshot.documents.find((d) => d.docType === "INVOICE");
    const plDoc = snapshot.documents.find((d) => d.docType === "PACKING_LIST");
    const blDoc = snapshot.documents.find((d) => d.docType === "BILL_OF_LADING");

    if (!snapshot.shipmentReference) missingFields.push("Shipment_Ref");
    const supplier = snapshot.supplierName || getFieldValue(invDoc, "exporter");
    if (!supplier) missingFields.push("Supplier_Name");

    if (!getFieldValue(invDoc, "documentNumber")) missingFields.push("Invoice_No");
    if (!getFieldValue(invDoc, "issueDate")) missingFields.push("Invoice_Date");
    if (!getFieldValue(invDoc, "currency")) missingFields.push("Currency");

    const grossWeight =
      getFieldValue(plDoc, "grossWeight") ||
      getFieldValue(invDoc, "grossWeight") ||
      getFieldValue(blDoc, "grossWeight");
    if (!grossWeight) missingFields.push("Gross_Weight_KG");

    const packageCount =
      getFieldValue(plDoc, "packageCount") ||
      getFieldValue(blDoc, "packageCount") ||
      getFieldValue(invDoc, "packageCount");
    if (!packageCount) missingFields.push("Package_Count");

    if (!snapshot.approvedBy) missingFields.push("Approved_By");
    if (!snapshot.approvedAt) missingFields.push("Approved_At");

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  },

  generateRows(snapshot: ShipmentExportSnapshot): ExportProfileResult {
    const invDoc = snapshot.documents.find((d) => d.docType === "INVOICE");
    const plDoc = snapshot.documents.find((d) => d.docType === "PACKING_LIST");
    const blDoc = snapshot.documents.find((d) => d.docType === "BILL_OF_LADING");

    // Common shipment headers
    const shipmentRef = snapshot.shipmentReference;
    const supplierName = snapshot.supplierName || getFieldValue(invDoc, "exporter") || "";
    const invoiceNo = getFieldValue(invDoc, "documentNumber") || "";
    const invoiceDate = formatExportDate(getFieldValue(invDoc, "issueDate"));
    const currency = getFieldValue(invDoc, "currency") || "";
    const incoterm = getFieldValue(invDoc, "incoterm") || "";

    const grossWeightKg = formatExportNumber(
      getFieldValue(plDoc, "grossWeight") ||
        getFieldValue(invDoc, "grossWeight") ||
        getFieldValue(blDoc, "grossWeight"),
    );
    const netWeightKg = formatExportNumber(
      getFieldValue(plDoc, "netWeight") || getFieldValue(invDoc, "netWeight"),
    );
    const packageCount = formatExportNumber(
      getFieldValue(plDoc, "packageCount") ||
        getFieldValue(blDoc, "packageCount") ||
        getFieldValue(invDoc, "packageCount"),
    );
    const packageType =
      getFieldValue(plDoc, "packageType") ||
      getFieldValue(blDoc, "packageType") ||
      getFieldValue(invDoc, "packageType") ||
      "";

    const containerNo = getFieldValue(blDoc, "containerNumber") || "";
    const portOfLoading = getFieldValue(blDoc, "portOfLoading") || "";
    const portOfDischarge = getFieldValue(blDoc, "portOfDischarge") || "";
    const blNo = getFieldValue(blDoc, "documentNumber") || "";
    const blDate = formatExportDate(getFieldValue(blDoc, "issueDate"));

    const approvedBy = snapshot.approvedBy || "";
    const approvedAt = formatExportDate(snapshot.approvedAt);

    // Line item row expansion (Rule 5)
    const lineItems =
      invDoc?.lineItems && invDoc.lineItems.length > 0
        ? invDoc.lineItems
        : plDoc?.lineItems && plDoc.lineItems.length > 0
          ? plDoc.lineItems
          : [];

    const rows: string[][] = [];

    if (lineItems.length > 0) {
      for (const item of lineItems) {
        rows.push([
          shipmentRef,
          supplierName,
          invoiceNo,
          invoiceDate,
          currency,
          incoterm,
          String(item.lineNumber),
          item.hsnCode || "",
          item.description || "",
          formatExportNumber(item.quantity),
          item.quantityUnit || "",
          formatExportNumber(item.unitPrice),
          formatExportNumber(item.lineTotal),
          grossWeightKg,
          netWeightKg,
          packageCount,
          packageType,
          containerNo,
          portOfLoading,
          portOfDischarge,
          blNo,
          blDate,
          approvedBy,
          approvedAt,
        ]);
      }
    } else {
      // Single row if no line items exist
      rows.push([
        shipmentRef,
        supplierName,
        invoiceNo,
        invoiceDate,
        currency,
        incoterm,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        grossWeightKg,
        netWeightKg,
        packageCount,
        packageType,
        containerNo,
        portOfLoading,
        portOfDischarge,
        blNo,
        blDate,
        approvedBy,
        approvedAt,
      ]);
    }

    const headers = [...DEMO_V1_COLUMNS];
    const csv = serializeCsv(headers, rows);

    return {
      headers,
      rows,
      csv,
      profileId: this.id,
      profileVersion: this.version,
      assumptionLabel: this.assumptionLabel,
    };
  },
};

/**
 * Pluggable Export Profile Registry (Rule 9).
 */
const exportProfiles: Record<string, ExportProfile> = {
  "demo-v1": demoV1Profile,
};

export function getExportProfile(profileId = "demo-v1"): ExportProfile {
  const profile = exportProfiles[profileId];
  if (!profile) {
    throw new Error(`Export profile "${profileId}" is not registered.`);
  }
  return profile;
}

export function registerExportProfile(profile: ExportProfile): void {
  exportProfiles[profile.id] = profile;
}

