import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { buildShipmentWhere } from "@/lib/shipments";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

describe.skipIf(!enabled)("shipment database foundation", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const executiveId = randomUUID();
  const managerId = randomUUID();
  const supplierId = randomUUID();
  const executiveReference = `TEST-${randomUUID()}`;
  const managerReference = `TEST-${randomUUID()}`;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates records and scopes the list by role and supplier", async () => {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.user.createMany({
        data: [
          { id: executiveId, email: `${executiveId}@example.test`, role: "EXECUTIVE" },
          { id: managerId, email: `${managerId}@example.test`, role: "MANAGER" },
        ],
      });
      await transaction.supplier.create({ data: { id: supplierId, name: "Integration Supplier", normalizedName: "integration supplier" } });
      await transaction.shipment.create({ data: { reference: executiveReference, createdById: executiveId, supplierId } });
      await transaction.shipment.create({ data: { reference: managerReference, createdById: managerId } });
    }, { maxWait: 15000, timeout: 30000 });

    try {
      const executiveRows = await prisma.shipment.findMany({ where: buildShipmentWhere({ supplierId }, { id: executiveId, role: "EXECUTIVE" }) });
      const managerRows = await prisma.shipment.findMany({ where: buildShipmentWhere({}, { id: managerId, role: "MANAGER" }) });

      expect(executiveRows.map((row) => row.reference)).toEqual([executiveReference]);
      expect(managerRows.map((row) => row.reference)).toEqual(expect.arrayContaining([managerReference]));
      expect(managerRows.map((row) => row.reference)).toContain(executiveReference);
    } finally {
      await prisma.shipment.deleteMany({ where: { reference: { in: [executiveReference, managerReference] } } });
      await prisma.supplier.delete({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: { in: [executiveId, managerId] } } });
    }
  });
});
