import { z } from "zod";

import type { Prisma, PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import { ReviewError } from "@/lib/errors";
import { classifyChargeLine } from "./charge-lines";
import { createCrossCheckRunInTx } from "./service";

/**
 * Week 4 Step 4: Executive line-item mapping (Invoice line -> Packing List line).
 *
 * - Both lines must belong to the shipment's CURRENT Invoice / Packing List and to that document's
 *   latest COMPLETED extraction. Charge lines (freight, tax, discount...) cannot be mapped.
 * - At most one active mapping per line (partial unique indexes back this up). A conflicting
 *   mapping is rejected unless `replace: true`, which supersedes the old one.
 * - Mappings are append-only: removal supersedes (supersededAt / supersededById), never deletes.
 * - Each change bumps the shipment revision under `expectedRevision`, writes an AuditEvent and
 *   creates a fresh cross-check run in the same transaction.
 */

export type MappingActor = { id: string; role: "EXECUTIVE" | "MANAGER" };

export const MAPPING_EDITABLE_STATUSES: readonly ShipmentStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "NEEDS_REVIEW",
  "READY_FOR_APPROVAL",
];

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const createLineMappingSchema = z.object({
  invoiceLineId: z.string().uuid(),
  packingListLineId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
  expectedRevision: z.number().int().positive(),
  replace: z.boolean().optional().default(false),
});

export const removeLineMappingSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

async function findAccessibleShipment(prisma: PrismaClient, shipmentId: string, actor: MappingActor) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, ...(actor.role === "MANAGER" ? {} : { createdById: actor.id }) },
    select: { id: true, status: true, currentRevision: true },
  });
  if (!shipment) throw new ReviewError("Shipment not found or inaccessible.", "SHIPMENT_NOT_FOUND", 404);
  return shipment;
}

async function bumpRevision(tx: Prisma.TransactionClient, shipmentId: string, expectedRevision: number) {
  const before = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
  const bumped = await tx.shipment.updateMany({
    where: { id: shipmentId, currentRevision: expectedRevision, status: { in: [...MAPPING_EDITABLE_STATUSES] } },
    data: { currentRevision: { increment: 1 }, status: "NEEDS_REVIEW" },
  });
  if (bumped.count !== 1) {
    const current = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
    if (current && !MAPPING_EDITABLE_STATUSES.includes(current.status)) {
      throw new ReviewError(`Line mappings cannot change while the shipment is ${current.status}.`, "SHIPMENT_LOCKED", 409);
    }
    throw new ReviewError("The shipment changed since you loaded it. Refresh and try again.", "STALE_REVISION", 409);
  }
  const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  return { previousStatus: before?.status ?? null, shipment };
}

async function assertCurrentLine(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  lineId: string,
  expectedType: "INVOICE" | "PACKING_LIST",
) {
  const line = await tx.lineItem.findUnique({
    where: { id: lineId },
    include: { document: { select: { id: true, shipmentId: true, isCurrent: true, selectedDocType: true } } },
  });
  const label = expectedType === "INVOICE" ? "invoice" : "packing list";
  if (!line || line.document.shipmentId !== shipmentId || line.document.selectedDocType !== expectedType || !line.document.isCurrent) {
    throw new ReviewError(`The ${label} line is not part of this shipment's current ${label}.`, "MAPPING_LINE_INVALID", 422);
  }
  const latestRun = await tx.extractionRun.findFirst({
    where: { documentId: line.documentId, status: "COMPLETED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!latestRun || latestRun.id !== line.extractionRunId) {
    throw new ReviewError(`The ${label} line belongs to an older extraction. Refresh and map the current lines.`, "MAPPING_LINE_INVALID", 422);
  }
  if (classifyChargeLine({ description: line.description, hsnCode: line.hsnCode }) !== "GOODS") {
    throw new ReviewError(`The ${label} line is a charge line (freight, tax, discount...) and cannot be mapped to goods.`, "MAPPING_LINE_INVALID", 422);
  }
  return line;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

export async function createLineMapping(
  prisma: PrismaClient,
  params: { shipmentId: string; actor: MappingActor; body: unknown },
) {
  const input = createLineMappingSchema.parse(params.body);
  const shipment = await findAccessibleShipment(prisma, params.shipmentId, params.actor);

  try {
    return await prisma.$transaction(async (tx) => {
      const { previousStatus, shipment: updated } = await bumpRevision(tx, shipment.id, input.expectedRevision);
      await assertCurrentLine(tx, shipment.id, input.invoiceLineId, "INVOICE");
      await assertCurrentLine(tx, shipment.id, input.packingListLineId, "PACKING_LIST");

      const conflicts = await tx.lineItemMapping.findMany({
        where: {
          shipmentId: shipment.id,
          supersededAt: null,
          OR: [{ invoiceLineItemId: input.invoiceLineId }, { packingListLineItemId: input.packingListLineId }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      if (conflicts.length > 0 && !input.replace) {
        throw new ReviewError(
          "One of these lines is already mapped. Remove the existing mapping or choose replace.",
          "MAPPING_CONFLICT",
          409,
        );
      }

      const now = new Date();
      for (const conflict of conflicts) {
        await tx.lineItemMapping.update({
          where: { id: conflict.id },
          data: { supersededAt: now, supersededById: params.actor.id },
        });
        await tx.auditEvent.create({
          data: {
            shipmentId: shipment.id,
            actorId: params.actor.id,
            action: "LINE_MAPPING_SUPERSEDED",
            entityType: "LineItemMapping",
            entityId: conflict.id,
            metadata: {
              invoiceLineId: conflict.invoiceLineItemId,
              packingListLineId: conflict.packingListLineItemId,
              revision: updated.currentRevision,
            },
          },
        });
      }

      const mapping = await tx.lineItemMapping.create({
        data: {
          shipmentId: shipment.id,
          invoiceLineItemId: input.invoiceLineId,
          packingListLineItemId: input.packingListLineId,
          reason: input.reason,
          revision: updated.currentRevision,
          createdById: params.actor.id,
        },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId: shipment.id,
          actorId: params.actor.id,
          action: "LINE_MAPPING_CREATED",
          entityType: "LineItemMapping",
          entityId: mapping.id,
          metadata: {
            invoiceLineId: input.invoiceLineId,
            packingListLineId: input.packingListLineId,
            reason: input.reason,
            replacedMappingIds: conflicts.map((conflict) => conflict.id),
            previousStatus,
            approvalInvalidated: previousStatus === "READY_FOR_APPROVAL",
            expectedRevision: input.expectedRevision,
            revision: updated.currentRevision,
          },
        },
      });

      const run = await createCrossCheckRunInTx(tx, {
        shipmentId: shipment.id,
        requestedById: params.actor.id,
        triggeredBy: "LINE_MAPPING",
      });

      return {
        mapping,
        supersededMappingIds: conflicts.map((conflict) => conflict.id),
        revision: updated.currentRevision,
        shipmentStatus: updated.status,
        approvalInvalidated: previousStatus === "READY_FOR_APPROVAL",
        crossCheckRunId: run.run.id,
        crossChecks: run.results,
      };
    }, TX);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReviewError("One of these lines was mapped by someone else. Refresh and try again.", "MAPPING_CONFLICT", 409);
    }
    throw error;
  }
}

export async function removeLineMapping(
  prisma: PrismaClient,
  params: { shipmentId: string; mappingId: string; actor: MappingActor; body: unknown },
) {
  const input = removeLineMappingSchema.parse(params.body ?? {});
  const shipment = await findAccessibleShipment(prisma, params.shipmentId, params.actor);

  return prisma.$transaction(async (tx) => {
    const { previousStatus, shipment: updated } = await bumpRevision(tx, shipment.id, input.expectedRevision);
    const mapping = await tx.lineItemMapping.findFirst({
      where: { id: params.mappingId, shipmentId: shipment.id, supersededAt: null },
    });
    if (!mapping) throw new ReviewError("Active line mapping not found.", "MAPPING_NOT_FOUND", 404);

    const superseded = await tx.lineItemMapping.update({
      where: { id: mapping.id },
      data: { supersededAt: new Date(), supersededById: params.actor.id },
    });

    await tx.auditEvent.create({
      data: {
        shipmentId: shipment.id,
        actorId: params.actor.id,
        action: "LINE_MAPPING_REMOVED",
        entityType: "LineItemMapping",
        entityId: mapping.id,
        metadata: {
          invoiceLineId: mapping.invoiceLineItemId,
          packingListLineId: mapping.packingListLineItemId,
          reason: input.reason ?? null,
          previousStatus,
          approvalInvalidated: previousStatus === "READY_FOR_APPROVAL",
          expectedRevision: input.expectedRevision,
          revision: updated.currentRevision,
        },
      },
    });

    const run = await createCrossCheckRunInTx(tx, {
      shipmentId: shipment.id,
      requestedById: params.actor.id,
      triggeredBy: "LINE_MAPPING",
    });

    return {
      mapping: superseded,
      revision: updated.currentRevision,
      shipmentStatus: updated.status,
      approvalInvalidated: previousStatus === "READY_FOR_APPROVAL",
      crossCheckRunId: run.run.id,
      crossChecks: run.results,
    };
  }, TX);
}

export async function listActiveLineMappings(prisma: PrismaClient, shipmentId: string) {
  return prisma.lineItemMapping.findMany({
    where: { shipmentId, supersededAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { createdBy: { select: { id: true, email: true, fullName: true } } },
  });
}
