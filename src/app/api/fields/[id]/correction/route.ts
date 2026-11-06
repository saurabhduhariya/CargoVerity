import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { createCrossCheckRun } from "@/lib/crosschecks/service";

const correctionSchema = z.object({
  value: z.string().nullable(),
  reason: z.string().trim().min(3).max(500),
  expectedRevision: z.number().int().positive().optional(),
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
      include: {
        document: {
          include: {
            shipment: true,
          },
        },
      },
    });

    if (!field) throw new Error("Field not found or inaccessible.");

    const shipment = field.document.shipment;

    // Check pre-approval editable status
    if (shipment.status === "APPROVED" || shipment.status === "EXPORTED") {
      throw new Error(`Cannot edit fields on a shipment with status ${shipment.status}.`);
    }

    // Check expectedRevision for stale conflict
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== shipment.currentRevision
    ) {
      throw new ConflictError(
        `Stale shipment revision. Expected revision ${input.expectedRevision}, but current revision is ${shipment.currentRevision}.`,
      );
    }

    const { updatedField, updatedShipment } = await prisma.$transaction(async (transaction) => {
      const result = await transaction.extractedField.update({
        where: { id: field.id },
        data: {
          currentValue: input.value,
          reviewStatus: "CORRECTED",
          reviewReason: input.reason,
        },
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
      const nextShipment = await transaction.shipment.update({
        where: { id: shipment.id },
        data: { currentRevision: { increment: 1 }, status: "NEEDS_REVIEW" },
      });
      await transaction.auditEvent.create({
        data: {
          shipmentId: shipment.id,
          actorId: appUser.id,
          action: "FIELD_CORRECTED",
          entityType: "ExtractedField",
          entityId: field.id,
          metadata: {
            reason: input.reason,
            previousValue: field.currentValue,
            newValue: input.value,
            expectedRevision: input.expectedRevision ?? shipment.currentRevision,
          },
        },
      });
      return { updatedField: result, updatedShipment: nextShipment };
    });

    // Recompute cross-checks
    let crossCheckResults = null;
    try {
      const run = await createCrossCheckRun({
        shipmentId: shipment.id,
        requestedById: appUser.id,
        triggeredBy: "FIELD_CORRECTED",
        prismaClient: prisma,
      });
      crossCheckResults = run.results;
    } catch (checkErr) {
      console.error("Failed to recompute cross-checks after correction:", checkErr);
    }

    return NextResponse.json({
      field: updatedField,
      revision: updatedShipment.currentRevision,
      shipmentStatus: updatedShipment.status,
      crossChecks: crossCheckResults,
    });
  } catch (error) {
    return apiError(error);
  }
}
