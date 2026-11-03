import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

const correctionSchema = z.object({
  value: z.string().nullable(),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const input = correctionSchema.parse(await request.json());
    const prisma = getPrisma();
    const field = await prisma.extractedField.findFirst({
      where: {
        id,
        document: appUser.role === "MANAGER" ? undefined : { shipment: { createdById: appUser.id } },
      },
      include: { document: true },
    });

    if (!field) throw new Error("Field not found or inaccessible.");

    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.extractedField.update({
        where: { id: field.id },
        data: { currentValue: input.value, reviewStatus: "CORRECTED" },
      });
      await transaction.fieldCorrection.create({
        data: {
          fieldId: field.id,
          previousValue: field.currentValue,
          newValue: input.value,
          reason: input.reason,
          correctedById: appUser.id,
        },
      });
      await transaction.shipment.update({
        where: { id: field.document.shipmentId },
        data: { currentRevision: { increment: 1 }, status: "IN_REVIEW" },
      });
      await transaction.auditEvent.create({
        data: {
          shipmentId: field.document.shipmentId,
          actorId: appUser.id,
          action: "FIELD_CORRECTED",
          entityType: "ExtractedField",
          entityId: field.id,
          metadata: { reason: input.reason },
        },
      });
      return result;
    });

    return NextResponse.json({ field: updated });
  } catch (error) {
    return apiError(error);
  }
}
