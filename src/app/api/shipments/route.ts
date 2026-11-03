import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

const createShipmentSchema = z.object({
  reference: z.string().trim().min(3).max(80),
  importerName: z.string().trim().max(200).optional(),
  exporterName: z.string().trim().max(200).optional(),
});

export async function GET() {
  try {
    const { appUser } = await requireAppUser();
    const prisma = getPrisma();
    const shipments = await prisma.shipment.findMany({
      where: appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      include: { documents: { select: { id: true, type: true, status: true, fileName: true } } },
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
    const shipment = await prisma.shipment.create({
      data: {
        ...input,
        createdById: appUser.id,
        importerName: input.importerName || null,
        exporterName: input.exporterName || null,
        auditEvents: {
          create: {
            actorId: appUser.id,
            action: "SHIPMENT_CREATED",
            entityType: "Shipment",
          },
        },
      },
    });

    return NextResponse.json({ shipment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
