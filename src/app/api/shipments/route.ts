import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { buildShipmentWhere, normalizeSupplierKey, normalizeSupplierName } from "@/lib/shipments";

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
});

export async function GET(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const filters = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const prisma = getPrisma();
    const shipments = await prisma.shipment.findMany({
      where: buildShipmentWhere(filters, appUser),
      include: {
        supplier: { select: { id: true, name: true } },
        documents: { where: { isCurrent: true }, select: { id: true, docType: true, extractionStatus: true, originalFileName: true, documentVersion: true, isCurrent: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ shipments });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const input = createShipmentSchema.parse(await request.json());
    const prisma = getPrisma();
    const supplierName = input.supplierName ? normalizeSupplierName(input.supplierName) : "";
    const shipment = await prisma.$transaction(async (transaction) => {
      const supplier = supplierName
        ? await transaction.supplier.upsert({
            where: { normalizedName: normalizeSupplierKey(supplierName) },
            update: { name: supplierName },
            create: { name: supplierName, normalizedName: normalizeSupplierKey(supplierName) },
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
