import { describe, expect, it } from "vitest";

import { buildDemoV1Csv, buildDemoV1Export } from "@/lib/export/csv";

describe("demo-v1 CSV export", () => {
  it("exports line-item details in dedicated columns while preserving evidence", () => {
    const csv = buildDemoV1Csv("SHP-DEMO-002", [
      {
        type: "INVOICE",
        fields: [],
        lineItems: [
          {
            lineNumber: 1,
            description: "Precision Sensor",
            hsnCode: "9026.10",
            quantity: "10",
            quantityUnit: "pcs",
            unitPrice: "25.00",
            currency: "USD",
            lineTotal: "250.00",
            sourceQuote: "Precision Sensor 10 pcs 25.00 250.00",
            pageNumber: 1,
          },
        ],
      },
    ]);

    const [header, line] = csv.split("\n");
    expect(header).toContain('"hsn_code"');
    expect(header).toContain('"quantity"');
    expect(header).toContain('"line_total"');
    expect(line).toContain('"LINE_ITEM"');
    expect(line).toContain('"9026.10"');
    expect(line).toContain('"10"');
    expect(line).toContain('"25.00"');
    expect(line).toContain('"250.00"');
    expect(line).toContain('"Precision Sensor 10 pcs 25.00 250.00"');
  });

  it("quotes multiline evidence and embedded quotes as valid CSV cells", () => {
    const csv = buildDemoV1Csv("SHP-DEMO-002", [
      {
        type: "INVOICE",
        fields: [{ fieldKey: "exporter", currentValue: "Demo", unit: null, sourceQuote: 'Exporter\n"Demo"', pageNumber: 1 }],
        lineItems: [],
      },
    ]);

    expect(csv).toContain('"Exporter\n""Demo"""');
  });

  it("returns a preview with string cells before download", () => {
    const preview = buildDemoV1Export("SHP-DEMO-002", [
      { type: "INVOICE", fields: [], lineItems: [] },
    ]);

    expect(preview.headers.at(-1)).toBe("line_total");
    expect(preview.rows).toEqual([]);
    expect(preview.csv).toContain('"line_total"');
  });
});
