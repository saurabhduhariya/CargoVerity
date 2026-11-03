import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

const reviewSchema = z.object({
  status: z.enum(["CONFIRMED", "CORRECTED", "MANUAL_ENTRY"]),
  value: z.string().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const input = reviewSchema.parse(await request.json());
    if (input.status !== "CONFIRMED" && !input.reason) throw new Error("A correction reason is required.");
    const prisma = getPrisma();
    const field = await prisma.extractedField.findFirst({
      where: {
        id,
        document: appUser.role === "MANAGER" ? undefined : { shipment: { createdById: appUser.id } },
      },
      include: { document: true },
    });
    if (!field) throw new Error("Field not found or inaccessible.");

    const value = input.status === "CONFIRMED" ? field.currentValue : (input.value ?? null);
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.extractedField.update({ where: { id }, data: { currentValue: value, reviewStatus: input.status } });
      if (input.status !== "CONFIRMED" && value !== field.currentValue) {
        await transaction.fieldCorrection.create({ data: { fieldId: id, previousValue: field.currentValue, newValue: value, reason: input.reason!, correctedById: appUser.id } });
        await transaction.shipment.update({ where: { id: field.document.shipmentId }, data: { currentRevision: { increment: 1 }, status: "IN_REVIEW" } });
      }
      await transaction.auditEvent.create({ data: { shipmentId: field.document.shipmentId, actorId: appUser.id, action: `FIELD_${input.status}`, entityType: "ExtractedField", entityId: id, metadata: { reason: input.reason ?? null } } });
      return result;
    });

    return NextResponse.json({ field: updated });
  } catch (error) {
    return apiError(error);
  }
}
