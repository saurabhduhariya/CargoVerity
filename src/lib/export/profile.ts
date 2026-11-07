import { parseStrictDecimal } from "@/lib/normalizers/decimal";
import { normalizePackageType } from "@/lib/normalizers/package";
import { normalizeWeight } from "@/lib/normalizers/weight";

/**
 * Week 5 Step 3: typed export profile `demo-v1`.
 *
 * [ASSUMPTION] The client's filing-software template has not been delivered. demo-v1 is a
 * temporary, documented mapping (docs/assumptions.md, "Export profile demo-v1"). A real template replaces it
 * by registering a new profile; shipment data does not change.
 *
 * - Exactly the 21 plan columns, in plan order. No personal contacts (no emails, phones, names
 *   of people); approval details are kept on the ExportEvent, not in the file.
 * - Dates: YYYY-MM-DD. Day-first numeric dates (DD/MM/YYYY) are accepted only when unambiguous.
 * - Numbers: decimal strings preserved (no float rounding, no scientific notation); grouping
 *   commas removed. Weights are converted to kilograms from their stated unit.
 * - Null / missing values: empty cell.
 * - One CSV row per goods line item; shipment-level columns repeated on every row.
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
  "BL_No",
  "Port_Of_Loading",
  "Port_Of_Discharge",
] as const;

export type DemoV1Column = (typeof DEMO_V1_COLUMNS)[number];

/** Columns that must be present (and valid) before the CSV can be exported. */
export const DEMO_V1_REQUIRED_FIELDS = [
  "Shipment_Ref",
  "Supplier_Name",
  "Invoice_No",
  "Invoice_Date",
  "Currency",
  "Gross_Weight_KG",
  "Package_Count",
  "BL_No",
  "Port_Of_Loading",
  "Port_Of_Discharge",
] as const satisfies readonly DemoV1Column[];

type DocType = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";

export type ColumnSource =
  | { kind: "shipment"; property: "shipmentReference" | "supplierName" }
  | { kind: "field"; fieldKey: string; documents: readonly DocType[]; format: "text" | "date" | "weightKg" | "integer" | "upper" }
  | { kind: "fieldUnit"; fieldKey: string; documents: readonly DocType[]; format: "packageType" }
  | { kind: "line"; property: "lineNumber" | "hsnCode" | "description" | "quantity" | "quantityUnit" | "unitPrice" | "lineTotal" };

/**
 * Declarative column -> source mapping (Rule 3). Documents are tried in the listed order; the
 * first non-empty value wins. Supplier_Name falls back to the Invoice exporter.
 */
export const DEMO_V1_COLUMN_SOURCES: Record<DemoV1Column, ColumnSource> = {
  Shipment_Ref: { kind: "shipment", property: "shipmentReference" },
  Supplier_Name: { kind: "shipment", property: "supplierName" },
  Invoice_No: { kind: "field", fieldKey: "documentNumber", documents: ["INVOICE"], format: "text" },
  Invoice_Date: { kind: "field", fieldKey: "issueDate", documents: ["INVOICE"], format: "date" },
  Currency: { kind: "field", fieldKey: "currency", documents: ["INVOICE"], format: "upper" },
  Incoterm: { kind: "field", fieldKey: "incoterm", documents: ["INVOICE"], format: "upper" },
  Item_Sr: { kind: "line", property: "lineNumber" },
  HSN_Code: { kind: "line", property: "hsnCode" },
  Item_Description: { kind: "line", property: "description" },
  Quantity: { kind: "line", property: "quantity" },
  Unit: { kind: "line", property: "quantityUnit" },
  Unit_Price: { kind: "line", property: "unitPrice" },
  Line_Total: { kind: "line", property: "lineTotal" },
  Gross_Weight_KG: { kind: "field", fieldKey: "grossWeight", documents: ["PACKING_LIST", "BILL_OF_LADING", "INVOICE"], format: "weightKg" },
  Net_Weight_KG: { kind: "field", fieldKey: "netWeight", documents: ["PACKING_LIST", "INVOICE", "BILL_OF_LADING"], format: "weightKg" },
  Package_Count: { kind: "field", fieldKey: "packageCount", documents: ["PACKING_LIST", "BILL_OF_LADING", "INVOICE"], format: "integer" },
  // Extraction stores the package type as the unit of the package count ("120" + "cartons").
  Package_Type: { kind: "fieldUnit", fieldKey: "packageCount", documents: ["PACKING_LIST", "BILL_OF_LADING", "INVOICE"], format: "packageType" },
  Container_No: { kind: "field", fieldKey: "containerNumber", documents: ["BILL_OF_LADING"], format: "upper" },
  BL_No: { kind: "field", fieldKey: "documentNumber", documents: ["BILL_OF_LADING"], format: "text" },
  Port_Of_Loading: { kind: "field", fieldKey: "portOfLoading", documents: ["BILL_OF_LADING"], format: "text" },
  Port_Of_Discharge: { kind: "field", fieldKey: "portOfDischarge", documents: ["BILL_OF_LADING"], format: "text" },
};

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
  /** Approval details are metadata for the export record; they are not written into the CSV. */
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

export interface ExportFieldIssue {
  column: string;
  problem: string;
}

export interface ExportValidationResult {
  valid: boolean;
  /** Required columns with no value. */
  missingFields: string[];
  /** Columns whose value cannot be exported as-is (bad date, unknown weight unit, ...). */
  invalidFields: ExportFieldIssue[];
}

export interface ExportProfile {
  id: string;
  version: string;
  name: string;
  assumptionLabel: string;
  columns: readonly string[];
  requiredFields: readonly string[];
  columnSources?: Record<string, ColumnSource>;
  generateRows: (snapshot: ShipmentExportSnapshot) => ExportProfileResult;
  validate: (snapshot: ShipmentExportSnapshot) => ExportValidationResult;
}

/* ----------------------------------------------------------------------------------------- */
/* Formatting                                                                                 */
/* ----------------------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function expandYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

export type ParsedExportDate = { ok: true; value: string } | { ok: false; reason: "UNPARSEABLE_DATE" | "AMBIGUOUS_DATE" };

/**
 * Strict date parsing to YYYY-MM-DD. Accepts ISO dates/datetimes, month-name dates
 * ("15-Oct-2026", "15 October 2026", "Oct 15, 2026") and day-first numeric dates
 * (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY) only when the day is > 12. "03/04/2026" is ambiguous and
 * is rejected so a reviewer confirms it instead of the export guessing.
 */
export function parseExportDate(value: unknown): ParsedExportDate | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { ok: false, reason: "UNPARSEABLE_DATE" } : { ok: true, value: value.toISOString().slice(0, 10) };
  }
  const str = String(value).trim();
  if (!str) return null;

  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(str);
  if (match) {
    const parsed = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return parsed ? { ok: true, value: parsed } : { ok: false, reason: "UNPARSEABLE_DATE" };
  }

  match = /^(\d{1,2})[\s.\-/]+([A-Za-z]{3,9})\.?[\s.\-/,]+(\d{2,4})$/.exec(str);
  if (match && MONTHS[match[2].slice(0, 3).toLowerCase()]) {
    const parsed = isoDate(expandYear(Number(match[3])), MONTHS[match[2].slice(0, 3).toLowerCase()], Number(match[1]));
    return parsed ? { ok: true, value: parsed } : { ok: false, reason: "UNPARSEABLE_DATE" };
  }

  match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(str);
  if (match && MONTHS[match[1].slice(0, 3).toLowerCase()]) {
    const parsed = isoDate(Number(match[3]), MONTHS[match[1].slice(0, 3).toLowerCase()], Number(match[2]));
    return parsed ? { ok: true, value: parsed } : { ok: false, reason: "UNPARSEABLE_DATE" };
  }

  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(str);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first <= 12 && second <= 12 && first !== second) return { ok: false, reason: "AMBIGUOUS_DATE" };
    // Day-first (DD/MM/YYYY), the convention for the client's Indian customs documents.
    const parsed = first > 12 || first === second ? isoDate(expandYear(Number(match[3])), second, first) : null;
    if (parsed) return { ok: true, value: parsed };
    return { ok: false, reason: second > 12 ? "AMBIGUOUS_DATE" : "UNPARSEABLE_DATE" };
  }

  return { ok: false, reason: "UNPARSEABLE_DATE" };
}

/** Formats a date to YYYY-MM-DD; returns "" when empty and the trimmed input when it cannot be parsed. */
export function formatExportDate(value: unknown): string {
  const parsed = parseExportDate(value);
  if (!parsed) return "";
  return parsed.ok ? parsed.value : String(value).trim();
}

/**
 * Formats a number as a plain decimal string: preserves the given decimal digits, removes
 * grouping commas, never uses scientific notation. Non-numeric input is returned trimmed.
 */
export function formatExportNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const plain = String(value);
    // Avoid exponent notation (1e-7, 1e21) for very small or large numbers.
    return /e/i.test(plain) ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : plain;
  }
  const str = String(value).trim();
  if (/^-?\d+(\.\d+)?$/.test(str)) return str;
  const parsed = parseStrictDecimal(str);
  if (parsed.ok) return str.replace(/,/g, "").replace(/ /g, "");
  return str;
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = new Set(["=", "+", "-", "@", "\t", "\r", "|", "%"]);

/**
 * Guards against spreadsheet formula injection. Text whose first non-whitespace character could
 * start a formula is prefixed with a single quote. Plain numbers (including negatives such as
 * -12.50) are left untouched so typed values are not corrupted.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str === "") return "";
  if (PLAIN_NUMBER.test(str)) return str;
  const firstVisible = str.trimStart().charAt(0);
  if (FORMULA_START.has(str.charAt(0)) || FORMULA_START.has(firstVisible)) {
    return `'${str}`;
  }
  return str;
}

/** RFC 4180: every field is quoted; embedded quotes are doubled. */
export function escapeCsvCell(value: unknown): string {
  const sanitized = sanitizeCsvCell(value);
  return `"${sanitized.replaceAll('"', '""')}"`;
}

/** RFC 4180 CSV: CRLF record separator, header row first, terminating CRLF. */
export function serializeCsv(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  return `${allRows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

/* ----------------------------------------------------------------------------------------- */
/* Value resolution                                                                           */
/* ----------------------------------------------------------------------------------------- */

function findField(snapshot: ShipmentExportSnapshot, fieldKey: string, documents: readonly DocType[]) {
  for (const docType of documents) {
    const doc = snapshot.documents.find((d) => d.docType === docType);
    const field = doc?.fields.find((f) => f.fieldKey === fieldKey);
    if (field && field.currentValue !== null && field.currentValue !== undefined && String(field.currentValue).trim() !== "") {
      return { field, docType };
    }
  }
  return null;
}

type Resolved = { value: string; issue?: string };

function resolveShipmentColumn(snapshot: ShipmentExportSnapshot, column: DemoV1Column): Resolved {
  const source = DEMO_V1_COLUMN_SOURCES[column];
  switch (source.kind) {
    case "shipment": {
      if (source.property === "shipmentReference") return { value: snapshot.shipmentReference ?? "" };
      const supplier = snapshot.supplierName?.trim() || findField(snapshot, "exporter", ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"])?.field.currentValue?.trim();
      return { value: supplier ?? "" };
    }
    case "fieldUnit": {
      const found = findField(snapshot, source.fieldKey, source.documents);
      const explicit = findField(snapshot, "packageType", source.documents)?.field.currentValue;
      const raw = found?.field.unit ?? explicit ?? null;
      return { value: raw ? normalizePackageType(raw) ?? "" : "" };
    }
    case "field": {
      const found = findField(snapshot, source.fieldKey, source.documents);
      if (!found) return { value: "" };
      const raw = String(found.field.currentValue).trim();
      switch (source.format) {
        case "text":
          return { value: raw };
        case "upper":
          return { value: raw.toUpperCase() };
        case "date": {
          const parsed = parseExportDate(raw);
          if (parsed && !parsed.ok) {
            return {
              value: raw,
              issue: parsed.reason === "AMBIGUOUS_DATE" ? `ambiguous date "${raw}"; confirm it as YYYY-MM-DD` : `unrecognised date "${raw}"`,
            };
          }
          return { value: parsed?.ok ? parsed.value : "" };
        }
        case "weightKg": {
          const weight = normalizeWeight({ value: raw, unit: found.field.unit ?? null });
          if (!weight.ok) {
            const why =
              weight.error === "MISSING_EXPLICIT_UNIT"
                ? "no unit recorded"
                : weight.error === "AMBIGUOUS_WEIGHT_UNIT"
                  ? `ambiguous unit "${found.field.unit}"`
                  : weight.error === "UNKNOWN_WEIGHT_UNIT"
                    ? `unknown unit "${found.field.unit}"`
                    : `invalid weight "${raw}"`;
            return { value: "", issue: `${why} on the ${found.docType.replaceAll("_", " ").toLowerCase()}` };
          }
          return { value: weight.weightInKg.toString() };
        }
        case "integer": {
          const parsed = parseStrictDecimal(raw);
          if (!parsed.ok || !parsed.value.isInteger() || parsed.value.isNegative()) {
            return { value: raw, issue: `"${raw}" is not a whole number` };
          }
          return { value: parsed.value.toFixed(0) };
        }
      }
    }
    // Line columns are resolved per row.
    case "line":
      return { value: "" };
  }
}

function lineCell(item: ExportLineItemSnapshot | null, column: DemoV1Column): string {
  const source = DEMO_V1_COLUMN_SOURCES[column];
  if (source.kind !== "line" || !item) return "";
  switch (source.property) {
    case "lineNumber":
      return String(item.lineNumber);
    case "hsnCode":
      return item.hsnCode?.trim() ?? "";
    case "description":
      return item.description ?? "";
    case "quantityUnit":
      return item.quantityUnit?.trim() ?? "";
    default:
      return formatExportNumber(item[source.property]);
  }
}

function goodsLines(snapshot: ShipmentExportSnapshot): ExportLineItemSnapshot[] {
  const invoice = snapshot.documents.find((d) => d.docType === "INVOICE");
  const packing = snapshot.documents.find((d) => d.docType === "PACKING_LIST");
  const lines = invoice?.lineItems?.length ? invoice.lineItems : packing?.lineItems ?? [];
  return [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
}

/**
 * The demo-v1 export profile implementation.
 */
export const demoV1Profile: ExportProfile = {
  id: "demo-v1",
  version: "1.1.0",
  name: "Demo V1 Customs Reconciliation Profile",
  assumptionLabel:
    "[ASSUMPTION] Temporary export profile demo-v1; filing-software customs template awaiting client specification.",
  columns: DEMO_V1_COLUMNS,
  requiredFields: DEMO_V1_REQUIRED_FIELDS,
  columnSources: DEMO_V1_COLUMN_SOURCES,

  validate(snapshot: ShipmentExportSnapshot): ExportValidationResult {
    const missingFields: string[] = [];
    const invalidFields: ExportFieldIssue[] = [];

    for (const column of DEMO_V1_COLUMNS) {
      if (DEMO_V1_COLUMN_SOURCES[column].kind === "line") continue;
      const resolved = resolveShipmentColumn(snapshot, column);
      if (resolved.issue) invalidFields.push({ column, problem: resolved.issue });
      else if ((DEMO_V1_REQUIRED_FIELDS as readonly string[]).includes(column) && !resolved.value) missingFields.push(column);
    }

    return { valid: missingFields.length === 0 && invalidFields.length === 0, missingFields, invalidFields };
  },

  generateRows(snapshot: ShipmentExportSnapshot): ExportProfileResult {
    const shipmentValues = new Map<DemoV1Column, string>();
    for (const column of DEMO_V1_COLUMNS) {
      if (DEMO_V1_COLUMN_SOURCES[column].kind !== "line") {
        shipmentValues.set(column, resolveShipmentColumn(snapshot, column).value);
      }
    }

    const lines = goodsLines(snapshot);
    const rowSources: Array<ExportLineItemSnapshot | null> = lines.length > 0 ? lines : [null];
    const rows = rowSources.map((item) =>
      DEMO_V1_COLUMNS.map((column) =>
        DEMO_V1_COLUMN_SOURCES[column].kind === "line" ? lineCell(item, column) : shipmentValues.get(column) ?? "",
      ),
    );

    const headers = [...DEMO_V1_COLUMNS];
    return {
      headers,
      rows,
      csv: serializeCsv(headers, rows),
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
