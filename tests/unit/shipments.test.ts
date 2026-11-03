import { describe, expect, it } from "vitest";

import { buildShipmentWhere, normalizeSupplierKey, normalizeSupplierName } from "@/lib/shipments";

describe("shipment foundation filters", () => {
  it("normalizes supplier names for deduplicated lookup", () => {
    expect(normalizeSupplierName("  Mumbai   Components Pvt. Ltd. ")).toBe("Mumbai Components Pvt. Ltd.");
    expect(normalizeSupplierKey("  Mumbai   Components Pvt. Ltd. ")).toBe("mumbai components pvt. ltd.");
  });

  it("scopes executive searches and applies status and supplier filters", () => {
    expect(buildShipmentWhere(
      { search: "demo", status: "IN_REVIEW", supplierId: "11111111-1111-4111-8111-111111111111" },
      { id: "22222222-2222-4222-8222-222222222222", role: "EXECUTIVE" },
    )).toEqual({
      AND: [
        { createdById: "22222222-2222-4222-8222-222222222222" },
        { status: "IN_REVIEW" },
        { supplierId: "11111111-1111-4111-8111-111111111111" },
        { OR: [
          { reference: { contains: "demo", mode: "insensitive" } },
          { importerName: { contains: "demo", mode: "insensitive" } },
          { exporterName: { contains: "demo", mode: "insensitive" } },
          { supplier: { name: { contains: "demo", mode: "insensitive" } } },
        ] },
      ],
    });
  });

  it("does not add creator scope for managers", () => {
    expect(buildShipmentWhere({}, { id: "22222222-2222-4222-8222-222222222222", role: "MANAGER" })).toEqual({ AND: [] });
  });
});
