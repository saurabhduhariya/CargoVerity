type ExportField = {
  fieldKey: string;
  currentValue: string | null;
  unit: string | null;
  sourceQuote: string | null;
  pageNumber: number | null;
};

type ExportLineItem = {
  lineNumber: number;
  description: string | null;
  hsnCode: string | null;
  quantity: unknown;
  quantityUnit: string | null;
  unitPrice: unknown;
  currency: string | null;
  lineTotal: unknown;
  sourceQuote: string | null;
  pageNumber: number | null;
};

export type ExportDocument = {
  docType: string;
  fields: ExportField[];
  lineItems: ExportLineItem[];
};

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function cellValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

const headers = [
  "shipment_reference",
  "document_type",
  "field_key",
  "value",
  "unit",
  "source_quote",
  "page_number",
  "record_type",
  "hsn_code",
  "quantity",
  "quantity_unit",
  "unit_price",
  "currency",
  "line_total",
];

export function buildDemoV1Export(reference: string, documents: ExportDocument[]) {
  const rows: unknown[][] = [headers];

  for (const document of documents) {
    for (const field of document.fields) {
      rows.push([
        reference,
        document.docType,
        field.fieldKey,
        field.currentValue,
        field.unit,
        field.sourceQuote,
        field.pageNumber,
        "FIELD",
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
    }

    for (const item of document.lineItems) {
      rows.push([
        reference,
        document.docType,
        `line_item_${item.lineNumber}`,
        item.description,
        item.quantityUnit,
        item.sourceQuote,
        item.pageNumber,
        "LINE_ITEM",
        item.hsnCode,
        item.quantity,
        item.quantityUnit,
        item.unitPrice,
        item.currency,
        item.lineTotal,
      ]);
    }
  }

  const serializedRows = rows.map((row) => row.map(cellValue));

  return {
    headers: serializedRows[0] ?? [],
    rows: serializedRows.slice(1),
    csv: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
  };
}

export function buildDemoV1Csv(reference: string, documents: ExportDocument[]) {
  return buildDemoV1Export(reference, documents).csv;
}
