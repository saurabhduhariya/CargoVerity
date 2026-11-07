import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { apiError } from "@/lib/api-response";
import { createShipment, listShipments } from "@/lib/shipment-service";

/**
 * Week 1 Step 5.12: integration tests for shipment creation, list access and authorization
 * scope. These call the application services (the same code the Route Handlers use) against
 * PostgreSQL. All records are synthetic and removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

describe.skipIf(!enabled)("Week 1 shipment services (PostgreSQL)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const executiveA = { id: randomUUID(), role: "EXECUTIVE" as const };
  const executiveB = { id: randomUUID(), role: "EXECUTIVE" as const };
  const manager = { id: randomUUID(), role: "MANAGER" as const };
  const supplierKey = `week1 integration supplier ${tag.toLowerCase()}`;
  const refA = `IT-W1-${tag}-A`;
  const refB = `IT-W1-${tag}-B`;
  const refA2 = `IT-W1-${tag}-A2`;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [executiveA, executiveB, manager].map((user) => ({
        id: user.id,
        email: `${user.id}@example.test`,
        role: user.role,
      })),
    });
  });

  afterAll(async () => {
    try {
      // Audit events cascade with the shipment.
      await prisma.shipment.deleteMany({ where: { reference: { startsWith: `IT-W1-${tag}` } } });
      await prisma.supplier.deleteMany({ where: { normalizedName: supplierKey } });
      await prisma.user.deleteMany({ where: { id: { in: [executiveA.id, executiveB.id, manager.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("creates a DRAFT revision-1 shipment owned by the actor with a SHIPMENT_CREATED audit event", async () => {
    const shipment = await createShipment(prisma, executiveA, {
      reference: `  ${refA}  `,
      supplierName: `Week1 Integration Supplier ${tag}`,
      status: "APPROVED",
      createdById: executiveB.id,
    });

    expect(shipment.reference).toBe(refA);
    expect(shipment.status).toBe("DRAFT");
    expect(shipment.currentRevision).toBe(1);
    expect(shipment.createdById).toBe(executiveA.id);
    expect(shipment.supplier?.name).toBe(`Week1 Integration Supplier ${tag}`);

    const audit = await prisma.auditEvent.findMany({ where: { shipmentId: shipment.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "SHIPMENT_CREATED", actorId: executiveA.id });
  });

  it("rejects a duplicate reference with a safe 409 and leaves no partial records", async () => {
    const before = await prisma.supplier.count({ where: { normalizedName: supplierKey } });

    const failure = await createShipment(prisma, executiveB, {
      reference: refA,
      supplierName: `Week1 Integration Supplier ${tag}`,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "P2002" });
    const response = apiError(failure);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That shipment reference already exists. Choose a unique reference.",
      code: "CONFLICT",
    });
    expect(await prisma.shipment.count({ where: { reference: refA } })).toBe(1);
    expect(await prisma.supplier.count({ where: { normalizedName: supplierKey } })).toBe(before);
  });

  it("reuses the supplier by normalized name without renaming it", async () => {
    const first = await prisma.shipment.findUniqueOrThrow({ where: { reference: refA } });
    const second = await createShipment(prisma, executiveA, {
      reference: refA2,
      supplierName: `  WEEK1   integration SUPPLIER ${tag} `,
    });

    expect(second.supplierId).toBe(first.supplierId);
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { normalizedName: supplierKey } });
    expect(supplier.name).toBe(`Week1 Integration Supplier ${tag}`);
  });

  it("scopes the list: Executives see only their own shipments, Managers see all", async () => {
    await createShipment(prisma, executiveB, { reference: refB });

    const refsFor = async (actor: { id: string; role: "EXECUTIVE" | "MANAGER" }) =>
      (await listShipments(prisma, actor, { search: `IT-W1-${tag}` })).shipments.map((s) => s.reference).sort();

    expect(await refsFor(executiveA)).toEqual([refA, refA2].sort());
    expect(await refsFor(executiveB)).toEqual([refB]);
    expect(await refsFor(manager)).toEqual([refA, refA2, refB].sort());
  });

  it("applies supplier and status filters inside the actor's scope", async () => {
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { normalizedName: supplierKey } });

    const bySupplierForA = await listShipments(prisma, executiveA, { supplierId: supplier.id });
    const bySupplierForB = await listShipments(prisma, executiveB, { supplierId: supplier.id });
    const draftsForManager = await listShipments(prisma, manager, { search: `IT-W1-${tag}`, status: "DRAFT" });
    const approvedForManager = await listShipments(prisma, manager, { search: `IT-W1-${tag}`, status: "APPROVED" });

    expect(bySupplierForA.shipments.map((s) => s.reference).sort()).toEqual([refA, refA2].sort());
    expect(bySupplierForB.shipments).toHaveLength(0);
    expect(draftsForManager.shipments).toHaveLength(3);
    expect(approvedForManager.shipments).toHaveLength(0);
    expect(draftsForManager.stats.totalShipments).toBe(3);
  });

  it("returns list rows with status, revision and an upload next action for a new shipment", async () => {
    const { shipments } = await listShipments(prisma, executiveB, { search: refB });

    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({
      reference: refB,
      status: "DRAFT",
      currentRevision: 1,
      documentSlots: { presentCount: 0, allPresent: false },
      nextAction: { type: "upload" },
    });
  });
});
