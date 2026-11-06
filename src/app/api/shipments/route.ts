import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import {
  buildShipmentWhere,
  calculateShipmentRiskScore,
  deriveCrossChecksSummary,
  deriveDocumentSlots,
  deriveNextAction,
  EnrichedShipment,
  normalizeSupplierKey,
  normalizeSupplierName,
  sortShipments,
} from "@/lib/shipments";

const createShipmentSchema = z.object({
  reference: z.string().trim().min(3).max(80),
  importerName: z.string().trim().max(200).optional(),
  exporterName: z.string().trim().max(200).optional(),
  supplierName: z.string().trim().max(200).optional(),
});

const listQuerySchema = z.object({
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

export async function GET(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const filters = listQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const prisma = getPrisma();

    const shipments = await prisma.shipment.findMany({
      where: buildShipmentWhere(filters, appUser),
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
      // 1. CI / PL / BL Slot Presence & Extraction Status (Rule 2)
      const slots = deriveDocumentSlots(s.documents);

      // 2. Cross-Checks Summary for Current Revision (Rule 3)
      const checks = deriveCrossChecksSummary(s.crossChecks, s.currentRevision);

      // Count fields and pages requiring human review
      const reviewRequiredCount = s.documents.reduce((acc, doc) => {
        const unreviewedFields = (doc.fields ?? []).filter(
          (f) => f.reviewStatus === "REQUIRES_REVIEW",
        ).length;
        const unreadablePages = (doc.pages ?? []).filter(
          (p) => !p.isReadable && !p.manualEntryRequired,
        ).length;
        return acc + unreviewedFields + unreadablePages;
      }, 0);

      // 3. Deterministic Next Action (Rule 5)
      const nextAction = deriveNextAction({
        id: s.id,
        status: s.status,
        slots,
        checks,
        reviewRequiredCount,
        userRole: appUser.role,
      });

      // 4. Stored High-Risk Priority Score (Rule 8)
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

    // 5. Sort shipments (Default: high-risk first using real data - Rule 8)
    const sortedShipments = sortShipments(
      enrichedShipments,
      filters.sort ?? "risk",
    );

    // 6. Real stored operational KPIs (Rule 9: Never fabricate KPIs)
    const stats = {
      totalShipments: sortedShipments.length,
      highRiskReviewPending: sortedShipments.filter((s) => s.riskScore >= 80)
        .length,
      awaitingManagerApproval: sortedShipments.filter(
        (s) => s.status === "READY_FOR_APPROVAL",
      ).length,
      clearedOrExported: sortedShipments.filter(
        (s) => s.status === "APPROVED" || s.status === "EXPORTED",
      ).length,
    };

    return NextResponse.json({
      shipments: sortedShipments,
      stats,
      sort: filters.sort ?? "risk",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const input = createShipmentSchema.parse(await request.json());
    const prisma = getPrisma();
    const supplierName = input.supplierName
      ? normalizeSupplierName(input.supplierName)
      : "";
    const shipment = await prisma.$transaction(async (transaction) => {
      const supplier = supplierName
        ? await transaction.supplier.upsert({
            where: { normalizedName: normalizeSupplierKey(supplierName) },
            update: { name: supplierName },
            create: {
              name: supplierName,
              normalizedName: normalizeSupplierKey(supplierName),
            },
          })
        : null;

      return transaction.shipment.create({
        data: {
          reference: input.reference,
          createdById: appUser.id,
          importerName: input.importerName || null,
          exporterName: input.exporterName || null,
          supplierId: supplier?.id ?? null,
          auditEvents: {
            create: {
              actorId: appUser.id,
              action: "SHIPMENT_CREATED",
              entityType: "Shipment",
            },
          },
        },
      });
    });

    return NextResponse.json({ shipment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
