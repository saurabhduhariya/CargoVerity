import { describe, expect, it } from "vitest";

import { chargeSign, classifyChargeLine, splitLines } from "@/lib/crosschecks/charge-lines";

describe("Charge-line classification (Week 4 Step 2)", () => {
  it.each([
    ["Ocean freight", "FREIGHT"],
    ["Freight charges", "FREIGHT"],
    ["Marine insurance", "INSURANCE"],
    ["IGST @ 18%", "TAX"],
    ["VAT 20%", "TAX"],
    ["Goods and services tax", "TAX"],
    ["Discount", "DISCOUNT"],
    ["Less: trade discount 5%", "DISCOUNT"],
    ["Handling charges", "OTHER"],
  ])("%s is %s", (description, kind) => {
    expect(classifyChargeLine({ description })).toBe(kind);
  });

  it.each([
    "Valves with special bulk discount",
    "Steel bolts M8",
    "Freight & insurance",
    "Packing materials",
    "",
  ])("'%s' stays goods (conservative)", (description) => {
    expect(classifyChargeLine({ description })).toBe("GOODS");
  });

  it("an HSN code or SKU always means goods", () => {
    expect(classifyChargeLine({ description: "Freight", hsnCode: "996511" })).toBe("GOODS");
    expect(classifyChargeLine({ description: "Discount", sku: "SKU-1" })).toBe("GOODS");
  });

  it("only discounts are signed negative", () => {
    expect(chargeSign("DISCOUNT")).toBe(-1);
    for (const kind of ["TAX", "FREIGHT", "INSURANCE", "OTHER"] as const) expect(chargeSign(kind)).toBe(1);
  });

  it("splits lines in order", () => {
    const lines = [{ description: "Bolts" }, { description: "Ocean freight" }, { description: "Nuts" }];
    const split = splitLines(lines);
    expect(split.goods.map((l) => l.description)).toEqual(["Bolts", "Nuts"]);
    expect(split.charges).toEqual([{ line: lines[1], kind: "FREIGHT" }]);
  });
});
