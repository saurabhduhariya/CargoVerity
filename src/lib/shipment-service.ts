import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  buildShipmentWhere,
  calculateShipmentRiskScore,
  deriveCrossChecksSummary,
  deriveDocumentSlots,
  deriveNextAction,
  type EnrichedShipment,
  normalizeSupplierKey,
  normalizeSupplierName,
  sortShipments,
} from "@/lib/shipments";

/**
 * Week 1 Step 5: shipment creation and list services.
 * Route Handlers stay thin (auth + parsing + response); these functions hold the rules and
 * are exercised directly by the PostgreSQL integration tests.
 */

export type ShipmentActor = { id: string; role: "EXECUTIVE" | "MANAGER" };

export const createShipmentSchema = z.object({
  reference: z.string().trim().min(3).max(80),
  importerName: z.string().trim().max(200).optional(),
  exporterName: z.string().trim().max(200).optional(),
  supplierName: z.string().trim().max(200).optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const shipmentListQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  status: z
    .enum([
      "DRAFT",
      "IN_REVIEW",
      "EXTRACTING",
      "NEEDS_REVIEW",
      "READY_FOR_APPROVAL",
      "APPROVED",
      "EXPORTED",
    ])
    .optional(),
  supplierId: z.string().uuid().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  sort: z.enum(["risk", "date_desc", "date_asc"]).optional(),
});

export type ShipmentListQuery = z.infer<typeof shipmentListQuerySchema>;

/**
 * Creates a shipment owned by the actor, links or creates the supplier by normalized name,
 * and records a SHIPMENT_CREATED audit event in the same transaction.
 *
 * Duplicate references are rejected by the `Shipment.reference` unique constraint (Prisma
 * P2002), which `apiError` maps to a 409 with a safe message. A pre-check would still race,
 * so the constraint is the single source of truth.
 */
export async function createShipment(
  prisma: PrismaClient,
  actor: ShipmentActor,
  rawInput: unknown,
) {
  const input = createShipmentSchema.parse(rawInput);
  const supplierName = input.supplierName ? normalizeSupplierName(input.supplierName) : "";

  return prisma.$transaction(async (transaction) => {
    const supplier = supplierName
      ? await transaction.supplier.upsert({
          where: { normalizedName: normalizeSupplierKey(supplierName) },
          // Never rename an existing supplier from one user's free-text input.
          update: {},
          create: {
            name: supplierName,
            normalizedName: normalizeSupplierKey(supplierName),
          },
        })
      : null;

    return transaction.shipment.create({
      data: {
        reference: input.reference,
        createdById: actor.id,
        importerName: input.importerName || null,
        exporterName: input.exporterName || null,
        supplierId: supplier?.id ?? null,
        auditEvents: {
          create: {
            actorId: actor.id,
            action: "SHIPMENT_CREATED",
            entityType: "Shipment",
          },
        },
      },
      include: { supplier: { select: { id: true, name: true } } },
    });
  });
}

/**
 * Lists shipments visible to the actor (Executives: own shipments only; Managers: all),
 * applying search, status, supplier and date filters, then enriches each row with document
 * slots, cross-check summary, next action and risk score from stored data only.
 */
export async function listShipments(
  prisma: PrismaClient,
  actor: ShipmentActor,
  filters: ShipmentListQuery = {},
) {
  const shipments = await prisma.shipment.findMany({
    where: buildShipmentWhere(filters, actor),
    include: {
      supplier: { select: { id: true, name: true } },
      documents: {
        where: { isCurrent: true },
        select: {
          id: true,
          docType: true,
          extractionStatus: true,
          originalFileName: true,
          documentVersion: true,
          isCurrent: true,
          fields: {
            select: { reviewStatus: true },
          },
          pages: {
            select: { isReadable: true, manualEntryRequired: true },
          },
        },
      },
      crossChecks: {
        select: {
          id: true,
          ruleKey: true,
          status: true,
          severity: true,
          createdAt: true,
          revision: true,
          resolutions: {
            select: { id: true, type: true, managerApprovedAt: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const enrichedShipments: EnrichedShipment[] = shipments.map((s) => {
    // 1. CI / PL / BL Slot Presence & Extraction Status
    const slots = deriveDocumentSlots(s.documents);

    // 2. Cross-Checks Summary for Current Revision
    const checks = deriveCrossChecksSummary(s.crossChecks, s.currentRevision);

    // Count fields and pages requiring human review
    const reviewRequiredCount = s.documents.reduce((acc, doc) => {
      const unreviewedFields = (doc.fields ?? []).filter(
        (f) => f.reviewStatus === "REQUIRES_REVIEW",
      ).length;
      const unreadablePages = (doc.pages ?? []).filter(
        (p) => !p.isReadable && !p.manualEntryRequired,
      ).length;
      return acc + unreadablePages + unreviewedFields;
    }, 0);

    // 3. Deterministic Next Action
    const nextAction = deriveNextAction({
      id: s.id,
      status: s.status,
      slots,
      checks,
      reviewRequiredCount,
      userRole: actor.role,
    });

    // 4. Stored High-Risk Priority Score
    const riskScore = calculateShipmentRiskScore({
      status: s.status,
      blockingUnresolved: checks.blockingUnresolved,
      reviewRequiredCount,
      allDocumentsPresent: slots.allPresent,
    });

    return {
      id: s.id,
      reference: s.reference,
      status: s.status,
      currentRevision: s.currentRevision,
      importerName: s.importerName,
      exporterName: s.exporterName,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      supplier: s.supplier,
      documentSlots: slots,
      checksSummary: checks,
      reviewRequiredCount,
      nextAction,
      riskScore,
    };
  });

  // 5. Sort shipments (default: high-risk first using stored data)
  const sortedShipments = sortShipments(enrichedShipments, filters.sort ?? "risk");

  // 6. Real stored operational KPIs (never fabricated)
  const stats = {
    totalShipments: sortedShipments.length,
    highRiskReviewPending: sortedShipments.filter((s) => s.riskScore >= 80).length,
    awaitingManagerApproval: sortedShipments.filter((s) => s.status === "READY_FOR_APPROVAL")
      .length,
    clearedOrExported: sortedShipments.filter(
      (s) => s.status === "APPROVED" || s.status === "EXPORTED",
    ).length,
  };

  return { shipments: sortedShipments, stats, sort: filters.sort ?? "risk" };
}
