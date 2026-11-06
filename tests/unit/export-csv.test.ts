import { describe, expect, it } from "vitest";

import {
  buildDemoV1Csv,
  buildDemoV1Export,
  demoV1Profile,
  DEMO_V1_COLUMNS,
  getExportProfile,
  formatExportDate,
  formatExportNumber,
  sanitizeCsvCell,
  escapeCsvCell,
} from "@/lib/export/csv";

describe("Export Profile & CSV Generation (Week 5 Step 3)", () => {
  const sampleDocuments = [
    {
      docType: "INVOICE",
      fields: [
        { fieldKey: "exporter", currentValue: "Global Tech Exporters Ltd", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "importer", currentValue: "CargoVerity Imports Inc", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "documentNumber", currentValue: "INV-2026-9001", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "issueDate", currentValue: "2026-11-02", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "currency", currentValue: "USD", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "incoterm", currentValue: "CIF", unit: null, sourceQuote: null, pageNumber: 1 },
      ],
      lineItems: [
        {
          lineNumber: 1,
          description: "Optical Sensor Mod A",
          hsnCode: "9026.10.20",
          quantity: "50",
          quantityUnit: "PCS",
          unitPrice: "45.00",
          currency: "USD",
          lineTotal: "2250.00",
          sourceQuote: null,
          pageNumber: 1,
        },
        {
          lineNumber: 2,
          description: "Digital Controller Unit B",
          hsnCode: "9032.89.10",
          quantity: "20",
          quantityUnit: "PCS",
          unitPrice: "120.00",
          currency: "USD",
          lineTotal: "2400.00",
          sourceQuote: null,
          pageNumber: 1,
        },
      ],
    },
    {
      docType: "PACKING_LIST",
      fields: [
        { fieldKey: "grossWeight", currentValue: "3165.000", unit: "kg", sourceQuote: null, pageNumber: 1 },
        { fieldKey: "netWeight", currentValue: "2950.000", unit: "kg", sourceQuote: null, pageNumber: 1 },
        { fieldKey: "packageCount", currentValue: "120", unit: "BOXES", sourceQuote: null, pageNumber: 1 },
        { fieldKey: "packageType", currentValue: "Pallets / Cartons", unit: null, sourceQuote: null, pageNumber: 1 },
      ],
      lineItems: [],
    },
    {
      docType: "BILL_OF_LADING",
      fields: [
        { fieldKey: "documentNumber", currentValue: "MEDU12345678", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "issueDate", currentValue: "2026-11-04T00:00:00Z", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "containerNumber", currentValue: "MSCU9876543", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "portOfLoading", currentValue: "INBOM", unit: null, sourceQuote: null, pageNumber: 1 },
        { fieldKey: "portOfDischarge", currentValue: "USLAX", unit: null, sourceQuote: null, pageNumber: 1 },
      ],
      lineItems: [],
    },
  ];

  const sampleMetadata = {
    supplierName: "Global Tech Exporters Ltd",
    approvedBy: "manager@cargoverity.test",
    approvedAt: "2026-11-05T14:30:00.000Z",
    approvedRevision: 2,
  };

  it("exports exact ordered demo columns (Column Order)", () => {
    const result = buildDemoV1Export("SHP-2026-001", sampleDocuments, sampleMetadata);

    expect(result.headers).toEqual([...DEMO_V1_COLUMNS]);
    expect(result.headers).toHaveLength(24);
  });

  it("multiplies rows per line item and repeats shipment-level columns (Line-Item Multiplication)", () => {
    const result = buildDemoV1Export("SHP-2026-001", sampleDocuments, sampleMetadata);

    // 2 line items -> 2 rows
    expect(result.rows).toHaveLength(2);

    // Row 1 checks
    const [row1, row2] = result.rows;
    expect(row1[0]).toBe("SHP-2026-001");
    expect(row1[1]).toBe("Global Tech Exporters Ltd");
    expect(row1[2]).toBe("INV-2026-9001");
    expect(row1[6]).toBe("1"); // Item_Sr
    expect(row1[7]).toBe("9026.10.20"); // HSN
    expect(row1[8]).toBe("Optical Sensor Mod A");
    expect(row1[9]).toBe("50");
    expect(row1[10]).toBe("PCS");
    expect(row1[11]).toBe("45.00");
    expect(row1[12]).toBe("2250.00");
    expect(row1[13]).toBe("3165.000"); // Gross Weight repeated
    expect(row1[17]).toBe("MSCU9876543"); // Container
    expect(row1[22]).toBe("manager@cargoverity.test");
    expect(row1[23]).toBe("2026-11-05");

    // Row 2 checks
    expect(row2[0]).toBe("SHP-2026-001");
    expect(row2[1]).toBe("Global Tech Exporters Ltd");
    expect(row2[6]).toBe("2"); // Item_Sr
    expect(row2[7]).toBe("9032.89.10"); // HSN
    expect(row2[8]).toBe("Digital Controller Unit B");
    expect(row2[9]).toBe("20");
    expect(row2[12]).toBe("2400.00");
  });

  it("creates a single row with empty line-item cells when shipment has no line items", () => {
    const docsWithoutLines = sampleDocuments.map((d) => ({ ...d, lineItems: [] }));
    const result = buildDemoV1Export("SHP-2026-EMPTY", docsWithoutLines, sampleMetadata);

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row[0]).toBe("SHP-2026-EMPTY");
    expect(row[6]).toBe(""); // Item_Sr is empty
    expect(row[7]).toBe(""); // HSN_Code is empty
    expect(row[13]).toBe("3165.000"); // Gross weight still populated
  });

  it("formats null and undefined values consistently as empty cells (Null Formatting)", () => {
    const docsWithNulls = [
      {
        docType: "INVOICE",
        fields: [
          { fieldKey: "documentNumber", currentValue: null, unit: null, sourceQuote: null, pageNumber: 1 },
          { fieldKey: "incoterm", currentValue: null, unit: null, sourceQuote: null, pageNumber: 1 },
        ],
        lineItems: [
          {
            lineNumber: 1,
            description: null,
            hsnCode: null,
            quantity: null,
            unitPrice: null,
            lineTotal: null,
          },
        ],
      },
    ];

    const result = buildDemoV1Export("SHP-NULLS", docsWithNulls);
    const row = result.rows[0];

    expect(row[2]).toBe(""); // Invoice_No
    expect(row[5]).toBe(""); // Incoterm
    expect(row[7]).toBe(""); // HSN
    expect(row[8]).toBe(""); // Description
    expect(row[9]).toBe(""); // Quantity
    expect(row[11]).toBe(""); // Unit_Price
    expect(row[12]).toBe(""); // Line_Total
  });

  it("formats numeric values cleanly without scientific notation (Numeric Formatting)", () => {
    expect(formatExportNumber("1250000.50")).toBe("1250000.50");
    expect(formatExportNumber(0.0005)).toBe("0.0005");
    expect(formatExportNumber("3165.000")).toBe("3165.000");
    expect(formatExportNumber(null)).toBe("");
    expect(formatExportNumber("")).toBe("");
  });

  it("normalizes dates consistently to YYYY-MM-DD (Date Formatting)", () => {
    expect(formatExportDate("2026-11-04T08:12:00.000Z")).toBe("2026-11-04");
    expect(formatExportDate("2026-11-02")).toBe("2026-11-02");
    expect(formatExportDate(new Date("2026-10-15T00:00:00Z"))).toBe("2026-10-15");
    expect(formatExportDate(null)).toBe("");
    expect(formatExportDate(undefined)).toBe("");
  });

  it("includes profile versioning, ID, and assumption labels (Profile Versioning)", () => {
    const profile = getExportProfile("demo-v1");
    expect(profile.id).toBe("demo-v1");
    expect(profile.version).toBe("1.0.0");
    expect(profile.assumptionLabel).toMatch(/\[ASSUMPTION\]/);

    const exportData = buildDemoV1Export("SHP-2026-001", sampleDocuments);
    expect(exportData.profileId).toBe("demo-v1");
    expect(exportData.profileVersion).toBe("1.0.0");
    expect(exportData.assumptionLabel).toContain("[ASSUMPTION]");
  });

  it("validates required export fields and identifies missing values", () => {
    // Valid snapshot
    const validValidation = demoV1Profile.validate({
      shipmentReference: "SHP-001",
      supplierName: "Demo Supplier",
      approvedBy: "manager@test.com",
      approvedAt: "2026-11-01",
      documents: sampleDocuments,
    });
    expect(validValidation.valid).toBe(true);
    expect(validValidation.missingFields).toHaveLength(0);

    // Incomplete snapshot missing approval and gross weight
    const invalidValidation = demoV1Profile.validate({
      shipmentReference: "SHP-001",
      documents: [],
    });
    expect(invalidValidation.valid).toBe(false);
    expect(invalidValidation.missingFields).toContain("Supplier_Name");
    expect(invalidValidation.missingFields).toContain("Invoice_No");
    expect(invalidValidation.missingFields).toContain("Gross_Weight_KG");
    expect(invalidValidation.missingFields).toContain("Approved_By");
    expect(invalidValidation.missingFields).toContain("Approved_At");
  });

  it("escapes CSV delimiters, quotes, newlines, and protects against formula injection", () => {
    // Formula protection: single-quote prefixed unless valid negative number
    expect(sanitizeCsvCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeCsvCell("+cmd.exe")).toBe("'+cmd.exe");
    expect(sanitizeCsvCell("-15.50")).toBe("-15.50"); // valid negative number preserved!
    expect(sanitizeCsvCell("-cmd")).toBe("'-cmd"); // text starting with - protected!

    // RFC 4180 quotes
    expect(escapeCsvCell('Precision, "Sensor"')).toBe('"Precision, ""Sensor"""');
    expect(escapeCsvCell("Multi\nLine")).toBe('"Multi\nLine"');

    const csv = buildDemoV1Csv("SHP-CSV-TEST", [
      {
        docType: "INVOICE",
        fields: [{ fieldKey: "exporter", currentValue: 'ABC "Logistics", Inc.', unit: null, sourceQuote: null, pageNumber: 1 }],
        lineItems: [
          {
            lineNumber: 1,
            description: "Widget, High-Grade\nModel X",
            hsnCode: "8471.30",
            quantity: "-5", // negative return qty
            unitPrice: "100.00",
            lineTotal: "-500.00",
          },
        ],
      },
    ]);

    expect(csv).toContain('"ABC ""Logistics"", Inc."');
    expect(csv).toContain('"Widget, High-Grade\nModel X"');
    expect(csv).toContain('"-5"');
    expect(csv).toContain('"-500.00"');
  });
});
