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
    // The plan's 21 columns, in the plan's order (literal list, not derived from the code).
    expect(result.headers).toEqual([
      "Shipment_Ref", "Supplier_Name", "Invoice_No", "Invoice_Date", "Currency", "Incoterm",
      "Item_Sr", "HSN_Code", "Item_Description", "Quantity", "Unit", "Unit_Price", "Line_Total",
      "Gross_Weight_KG", "Net_Weight_KG", "Package_Count", "Package_Type", "Container_No",
      "BL_No", "Port_Of_Loading", "Port_Of_Discharge",
    ]);
    // No personal contacts (approver e-mails etc.) in the file.
    expect(result.csv).not.toContain("manager@cargoverity.test");
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
    expect(row1[13]).toBe("3165"); // Gross weight in kg, repeated
    expect(row1[14]).toBe("2950"); // Net weight in kg
    expect(row1[15]).toBe("120"); // Package count
    expect(row1[16]).toBe("BOX"); // Package type from the package-count unit
    expect(row1[17]).toBe("MSCU9876543"); // Container
    expect(row1[18]).toBe("MEDU12345678"); // BL_No before the ports
    expect(row1[19]).toBe("INBOM");
    expect(row1[20]).toBe("USLAX");
    expect(row1).toHaveLength(21);

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
    expect(row[13]).toBe("3165"); // Gross weight still populated
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
    expect(profile.version).toBe("1.1.0");
    expect(profile.assumptionLabel).toMatch(/\[ASSUMPTION\]/);

    const exportData = buildDemoV1Export("SHP-2026-001", sampleDocuments);
    expect(exportData.profileId).toBe("demo-v1");
    expect(exportData.profileVersion).toBe("1.1.0");
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
    expect(validValidation.invalidFields).toHaveLength(0);

    // Empty snapshot: every required column except the reference is missing
    const invalidValidation = demoV1Profile.validate({
      shipmentReference: "SHP-001",
      documents: [],
    });
    expect(invalidValidation.valid).toBe(false);
    expect(invalidValidation.missingFields).toEqual([
      "Supplier_Name", "Invoice_No", "Invoice_Date", "Currency", "Gross_Weight_KG",
      "Package_Count", "BL_No", "Port_Of_Loading", "Port_Of_Discharge",
    ]);
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

  describe("Week 5 Step 3/4 formatting fixes", () => {
    const withField = (docType: string, fieldKey: string, currentValue: string, unit: string | null = null) =>
      sampleDocuments.map((doc) =>
        doc.docType === docType
          ? { ...doc, fields: [...doc.fields.filter((f) => f.fieldKey !== fieldKey), { fieldKey, currentValue, unit, sourceQuote: null, pageNumber: 1 }] }
          : doc,
      );

    it("converts weights to kilograms from their stated unit", () => {
      const tonnes = buildDemoV1Export("S", withField("PACKING_LIST", "grossWeight", "3.165", "MT"));
      expect(tonnes.rows[0][13]).toBe("3165");
      const pounds = buildDemoV1Export("S", withField("PACKING_LIST", "grossWeight", "1000", "lbs"));
      expect(pounds.rows[0][13]).toBe("453.59237");
      const grouped = buildDemoV1Export("S", withField("PACKING_LIST", "grossWeight", "3,165.000", "kg"));
      expect(grouped.rows[0][13]).toBe("3165");
    });

    it("blocks export when a weight has no unit or an ambiguous/unknown unit", () => {
      for (const unit of [null, "tons", "bags"]) {
        const result = demoV1Profile.validate({ shipmentReference: "S", supplierName: "X", documents: withField("PACKING_LIST", "grossWeight", "3165", unit) });
        expect(result.valid).toBe(false);
        expect(result.invalidFields.map((f) => f.column)).toContain("Gross_Weight_KG");
      }
    });

    it("parses dates strictly and rejects ambiguous day/month dates", () => {
      expect(formatExportDate("15/10/2026")).toBe("2026-10-15");
      expect(formatExportDate("15-Oct-2026")).toBe("2026-10-15");
      expect(formatExportDate("Oct 15, 2026")).toBe("2026-10-15");
      expect(formatExportDate("2026-02-30")).toBe("2026-02-30"); // not a real date: left as-is, and validation blocks it
      const ambiguous = demoV1Profile.validate({ shipmentReference: "S", supplierName: "X", documents: withField("INVOICE", "issueDate", "03/04/2026") });
      expect(ambiguous.invalidFields).toEqual([expect.objectContaining({ column: "Invoice_Date", problem: expect.stringMatching(/ambiguous/) })]);
      const bad = demoV1Profile.validate({ shipmentReference: "S", supplierName: "X", documents: withField("INVOICE", "issueDate", "2026-02-30") });
      expect(bad.invalidFields.map((f) => f.column)).toEqual(["Invoice_Date"]);
    });

    it("rejects a non-integer package count", () => {
      const result = demoV1Profile.validate({ shipmentReference: "S", supplierName: "X", documents: withField("PACKING_LIST", "packageCount", "12.5", "cartons") });
      expect(result.invalidFields.map((f) => f.column)).toContain("Package_Count");
    });

    it("guards formulas behind leading whitespace and keeps plain negative numbers", () => {
      expect(sanitizeCsvCell(" =1+1")).toBe("' =1+1");
      expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
      expect(sanitizeCsvCell("-12.50")).toBe("-12.50");
      expect(sanitizeCsvCell("-1,200.00")).toBe("'-1,200.00");
      expect(sanitizeCsvCell("Normal text")).toBe("Normal text");
    });

    it("uses CRLF record separators with a terminating CRLF and keeps Unicode", () => {
      const csv = buildDemoV1Csv("SHP-ÜNICODE", sampleDocuments, { supplierName: "München Export GmbH" });
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing empty
      expect(csv).toContain('"München Export GmbH"');
      expect(csv).toContain('"SHP-ÜNICODE"');
    });

    it("is reproducible: the same snapshot gives byte-identical CSV", () => {
      expect(buildDemoV1Csv("S", sampleDocuments, sampleMetadata)).toBe(buildDemoV1Csv("S", sampleDocuments, { ...sampleMetadata, approvedAt: "2030-01-01" }));
    });
  });
});
