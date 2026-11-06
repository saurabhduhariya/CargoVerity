import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { createCrossCheckRun } from "@/lib/crosschecks/service";

const reviewSchema = z.object({
  status: z.enum(["CONFIRMED", "CORRECTED", "MANUAL_ENTRY"]),
  value: z.string().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

/**
 * Week 4 Step 7: Field confirmation and correction route.
 *
 * 1. Checks pre-approval allowed state (blocks edits on APPROVED / EXPORTED).
 * 2. Compares expectedRevision with shipment.currentRevision, returning 409 Conflict if stale.
 * 3. Enforces that non-confirmed updates have a non-empty reason.
 * 4. Records FieldCorrection and AuditEvent in the same transaction as ExtractedField update.
 * 5. Increments shipment.currentRevision and resets status to NEEDS_REVIEW (invalidates approvals).
 * 6. Recomputes affected cross-checks using createCrossCheckRun.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const input = reviewSchema.parse(await request.json());

    if (input.status !== "CONFIRMED" && (!input.reason || input.reason.trim().length === 0)) {
      throw new Error("A reason is required when correcting or manually entering a field value.");
    }

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

    if (!field) {
      throw new Error("Field not found or inaccessible.");
    }

    const shipment = field.document.shipment;

    // Rule 1: Editable controls only for allowed pre-approval states
    if (shipment.status === "APPROVED" || shipment.status === "EXPORTED") {
      throw new Error(`Cannot edit fields on a shipment with status ${shipment.status}.`);
    }

    // Rules 6 & 7: Check expectedRevision and return 409 for stale updates
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== shipment.currentRevision
    ) {
      throw new ConflictError(
        `Stale shipment revision. Expected revision ${input.expectedRevision}, but current revision is ${shipment.currentRevision}.`,
      );
    }

    const targetValue = input.status === "CONFIRMED" ? field.currentValue : (input.value ?? null);
    const isMaterialChange = input.status !== "CONFIRMED" && targetValue !== field.currentValue;

    // Rules 5, 8, 9: Update field, record FieldCorrection, increment revision, invalidate approval
    const { updatedField, updatedShipment } = await prisma.$transaction(async (tx) => {
      const updated = await tx.extractedField.update({
        where: { id },
        data: {
          currentValue: targetValue,
          reviewStatus: input.status,
          reviewReason: input.status === "CONFIRMED" ? null : input.reason ?? null,
        },
      });

      let nextShipment = shipment;

      if (isMaterialChange) {
        // Record FieldCorrection in the same transaction
        await tx.fieldCorrection.create({
          data: {
            fieldId: id,
            previousValue: field.currentValue,
            newValue: targetValue,
            reason: input.reason!,
            correctedById: appUser.id,
          },
        });

        // Increment revision and set status to NEEDS_REVIEW (invalidating any prior approval)
        nextShipment = await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            currentRevision: { increment: 1 },
            status: "NEEDS_REVIEW",
          },
        });
      }

      // Record AuditEvent in the same transaction
      await tx.auditEvent.create({
        data: {
          shipmentId: shipment.id,
          actorId: appUser.id,
          action: `FIELD_${input.status}`,
          entityType: "ExtractedField",
          entityId: id,
          metadata: {
            reason: input.reason ?? null,
            previousValue: field.currentValue,
            newValue: targetValue,
            expectedRevision: input.expectedRevision ?? shipment.currentRevision,
            isMaterialChange,
          },
        },
      });

      return { updatedField: updated, updatedShipment: nextShipment };
    });

    // Rule 10: Recompute affected checks after a successful change
    let crossCheckResults = null;
    if (isMaterialChange) {
      try {
        const run = await createCrossCheckRun({
          shipmentId: shipment.id,
          requestedById: appUser.id,
          triggeredBy: `FIELD_${input.status}`,
          prismaClient: prisma,
        });
        crossCheckResults = run.results;
      } catch (checkErr) {
        console.error("Failed to recompute cross-checks after field change:", checkErr);
      }
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
