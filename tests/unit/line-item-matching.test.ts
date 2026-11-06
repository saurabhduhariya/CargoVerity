import { describe, expect, it } from "vitest";
import { matchLineItems } from "@/lib/crosschecks/line-item-matching";

describe("Line-Item Matching Cross-Check (Week 4 Step 4 - CHK_LINE_QUANTITY)", () => {
  it("passes when all line items match exactly in description, unit, and quantity (Exact Match)", () => {
    const result = matchLineItems({
      invoiceLines: [
        {
          id: "inv-1",
          lineNumber: 1,
          description: "Stainless Steel Hex Bolts M8x30",
          quantity: "500",
          quantityUnit: "pcs",
        },
        {
          id: "inv-2",
          lineNumber: 2,
          description: "High Pressure Flange Gasket 2 inch",
          quantity: "250",
          quantityUnit: "pcs",
        },
      ],
      packingListLines: [
        {
          id: "pl-1",
          lineNumber: 1,
          description: "Stainless Steel Hex Bolts M8x30",
          quantity: "500",
          quantityUnit: "pcs",
        },
        {
          id: "pl-2",
          lineNumber: 2,
          description: "High Pressure Flange Gasket 2 inch",
          quantity: "250",
          quantityUnit: "pcs",
        },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.matchedPairsCount).toBe(2);
    expect(result.details.unmatchedInvoiceLinesCount).toBe(0);
    expect(result.details.unmatchedPackingListLinesCount).toBe(0);
    expect(result.details.matchedPairs[0].status).toBe("PASS");
    expect(result.details.matchedPairs[0].mappingMethod).toBe("EXACT_DESCRIPTION");
    expect(result.details.matchedPairs[1].status).toBe("PASS");
  });

  it("matches correctly when rows are reordered across documents without relying on array index (Reordered Rows)", () => {
    const result = matchLineItems({
      invoiceLines: [
        { lineNumber: 1, description: "Hydraulic Pump 24V", quantity: "10", quantityUnit: "pcs" },
        { lineNumber: 2, description: "Pressure Relief Valve", quantity: "20", quantityUnit: "pcs" },
        { lineNumber: 3, description: "Oil Filter Element", quantity: "30", quantityUnit: "pcs" },
      ],
      packingListLines: [
        // Inverted order in Packing List
        { lineNumber: 1, description: "Oil Filter Element", quantity: "30", quantityUnit: "pcs" },
        { lineNumber: 2, description: "Hydraulic Pump 24V", quantity: "10", quantityUnit: "pcs" },
        { lineNumber: 3, description: "Pressure Relief Valve", quantity: "20", quantityUnit: "pcs" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.matchedPairsCount).toBe(3);

    const pumpPair = result.details.matchedPairs.find(
      (p) => p.invoiceDescription === "Hydraulic Pump 24V",
    );
    expect(pumpPair?.packingListLineNumber).toBe(2);
    expect(pumpPair?.invoiceLineNumber).toBe(1);
    expect(pumpPair?.status).toBe("PASS");

    const filterPair = result.details.matchedPairs.find(
      (p) => p.invoiceDescription === "Oil Filter Element",
    );
    expect(filterPair?.packingListLineNumber).toBe(1);
    expect(filterPair?.invoiceLineNumber).toBe(3);
    expect(filterPair?.status).toBe("PASS");
  });

  it("rejects duplicate identical descriptions without disambiguating codes as unresolved (Duplicate Descriptions)", () => {
    // Both lines have identical description without unique HSN or SKU
    const result = matchLineItems({
      invoiceLines: [
        { id: "inv-1", lineNumber: 1, description: "Universal Coupling 50mm", quantity: "100", quantityUnit: "pcs" },
        { id: "inv-2", lineNumber: 2, description: "Universal Coupling 50mm", quantity: "150", quantityUnit: "pcs" },
      ],
      packingListLines: [
        { id: "pl-1", lineNumber: 1, description: "Universal Coupling 50mm", quantity: "100", quantityUnit: "pcs" },
        { id: "pl-2", lineNumber: 2, description: "Universal Coupling 50mm", quantity: "150", quantityUnit: "pcs" },
      ],
    });

    // Rule 3 & 4: Must reject duplicate ambiguous matches and never silently map by array index
    expect(result.status).toBe("INCOMPLETE");
    expect(result.details.unresolvedReason).toBe("UNRESOLVED_LINE_ITEM_MAPPING");
    expect(result.details.matchedPairsCount).toBe(0);
    expect(result.details.unmatchedInvoiceLinesCount).toBe(2);
    expect(result.details.unmatchedLines.some((u) => u.reason === "AMBIGUOUS_DUPLICATE_CANDIDATES")).toBe(true);
    expect(result.details.message).toContain("Ambiguous duplicate item matches detected");
  });

  it("disambiguates identical descriptions when distinct HSN or SKU is present", () => {
    const result = matchLineItems({
      invoiceLines: [
        { lineNumber: 1, description: "Coupling", hsnCode: "8483.60.10", quantity: "100", quantityUnit: "pcs" },
        { lineNumber: 2, description: "Coupling", hsnCode: "8483.60.90", quantity: "150", quantityUnit: "pcs" },
      ],
      packingListLines: [
        { lineNumber: 1, description: "Coupling", hsnCode: "8483.60.90", quantity: "150", quantityUnit: "pcs" },
        { lineNumber: 2, description: "Coupling", hsnCode: "8483.60.10", quantity: "100", quantityUnit: "pcs" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.matchedPairsCount).toBe(2);
    expect(result.details.matchedPairs[0].mappingMethod).toBe("EXACT_DESCRIPTION_AND_CODE");
    expect(result.details.matchedPairs[1].mappingMethod).toBe("EXACT_DESCRIPTION_AND_CODE");
  });

  it("returns INCOMPLETE when some rows are unmatched (Unmatched Rows)", () => {
    const result = matchLineItems({
      invoiceLines: [
        { lineNumber: 1, description: "Controller Unit", quantity: "5", quantityUnit: "pcs" },
        { lineNumber: 2, description: "Sensor Cable 10m", quantity: "15", quantityUnit: "pcs" },
        { lineNumber: 3, description: "Spare Fuse 5A", quantity: "50", quantityUnit: "pcs" }, // Not on PL
      ],
      packingListLines: [
        { lineNumber: 1, description: "Controller Unit", quantity: "5", quantityUnit: "pcs" },
        { lineNumber: 2, description: "Sensor Cable 10m", quantity: "15", quantityUnit: "pcs" },
      ],
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.details.matchedPairsCount).toBe(2);
    expect(result.details.unmatchedInvoiceLinesCount).toBe(1);
    expect(result.details.unmatchedPackingListLinesCount).toBe(0);
    expect(result.details.unmatchedLines[0].description).toBe("Spare Fuse 5A");
  });

  it("flags incompatible units and does not assume equivalence (Incompatible Units)", () => {
    // 100 PCS vs 100 BOX: Rule 7 specifies PCS, BOX, CARTON, SET are NOT interchangeable
    const result = matchLineItems({
      invoiceLines: [
        { lineNumber: 1, description: "Fastener Screws", quantity: "100", quantityUnit: "PCS" },
      ],
      packingListLines: [
        { lineNumber: 1, description: "Fastener Screws", quantity: "100", quantityUnit: "BOX" },
      ],
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.details.unresolvedReason).toBe("INCOMPATIBLE_LINE_UNITS");
    expect(result.details.matchedPairs[0].status).toBe("INCOMPATIBLE_UNITS");
    expect(result.details.matchedPairs[0].note).toContain("Incompatible units: Invoice specifies 'PCS', but Packing List specifies 'BOX'");
  });

  it("recognizes compatible quantity unit aliases (e.g. 'pcs', 'Pieces', 'nos', 'each')", () => {
    const result = matchLineItems({
      invoiceLines: [
        { lineNumber: 1, description: "Ball Bearings", quantity: "200", quantityUnit: "Pieces" },
      ],
      packingListLines: [
        { lineNumber: 1, description: "Ball Bearings", quantity: "200", quantityUnit: "pcs" },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.matchedPairs[0].status).toBe("PASS");
    expect(result.details.matchedPairs[0].canonicalUnit).toBe("PCS");
  });

  it("detects quantity mismatch when descriptions match but counts differ", () => {
    const result = matchLineItems({
      invoiceLines: [
        { lineNumber: 1, description: "Precision Gearbox", quantity: "100", quantityUnit: "pcs" },
      ],
      packingListLines: [
        { lineNumber: 1, description: "Precision Gearbox", quantity: "95", quantityUnit: "pcs" },
      ],
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.details.matchedPairs[0].status).toBe("MISMATCH");
    expect(result.details.matchedPairs[0].difference).toBe("5");
    expect(result.details.message).toContain("Line-item quantity mismatch detected on 1 item(s)");
  });

  it("allows Executive to override matching via manual line mapping with evidence (Manual Mapping)", () => {
    // Two differently named items that represent the same physical goods by supplier naming
    const result = matchLineItems({
      invoiceLines: [
        { id: "inv-line-1", lineNumber: 1, description: "Commercial Model CV-500", quantity: "50", quantityUnit: "pcs" },
      ],
      packingListLines: [
        { id: "pl-line-9", lineNumber: 9, description: "Factory Internal Ref #8841-A", quantity: "50", quantityUnit: "pcs" },
      ],
      manualMappings: [
        {
          invoiceLineId: "inv-line-1",
          packingListLineId: "pl-line-9",
          mappedBy: "executive-42",
          reason: "Supplier internal code 8841-A corresponds to commercial model CV-500 per catalog",
          timestamp: "2026-11-06T12:00:00Z",
        },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.manualMappingsApplied).toBe(1);
    expect(result.details.matchedPairs[0].mappingMethod).toBe("MANUAL");
    expect(result.details.matchedPairs[0].manualEvidence?.mappedBy).toBe("executive-42");
    expect(result.details.matchedPairs[0].manualEvidence?.reason).toContain("CV-500");
    expect(result.details.matchedPairs[0].status).toBe("PASS");
  });

  it("matches items using token similarity when wording has minor punctuation and case differences", () => {
    const result = matchLineItems({
      invoiceLines: [
        {
          lineNumber: 1,
          description: "Industrial Motor, 3-Phase, 400V (Model X)",
          quantity: "8",
          quantityUnit: "pcs",
        },
      ],
      packingListLines: [
        {
          lineNumber: 1,
          description: "industrial motor 3 phase 400v model x",
          quantity: "8",
          quantityUnit: "pcs",
        },
      ],
    });

    expect(result.status).toBe("PASS");
    expect(result.details.matchedPairs[0].status).toBe("PASS");
  });

  it("returns INCOMPLETE when line items are missing from either document", () => {
    const result = matchLineItems({
      invoiceLines: [],
      packingListLines: [{ lineNumber: 1, description: "Item", quantity: "1" }],
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.details.unresolvedReason).toBe("LINE_ITEMS_MISSING");
  });
});

