import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { PROMPT_VERSION } from "@/lib/ai/extraction-prompts";

const manualFieldInputSchema = z.object({
  fieldKey: z.string().trim().min(1).max(100),
  value: z.string().nullable(),
  unit: z.string().nullable().optional(),
  pageNumber: z.number().int().positive().optional(),
  reason: z.string().trim().min(1).max(500),
});

/**
 * Week 3 Step 5: Manual Field Fallback Route
 * Explicitly saves manually entered field values when a page is unreadable or AI fails.
 * Marks fields as MANUALLY_ENTERED with actor, timestamp, and field correction history.
 * Preserves modelValue as null or original immutable value.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: documentId } = await context.params;
    const input = manualFieldInputSchema.parse(await request.json());

    const prisma = getPrisma();
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        shipment:
          appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
      include: {
        shipment: true,
        extractionRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!document) {
      throw new Error("Document not found or inaccessible.");
    }

    const updatedField = await prisma.$transaction(async (tx) => {
      // Find or create an extraction run anchor
      let runId = document.extractionRuns[0]?.id;
      if (!runId) {
        const fallbackRun = await tx.extractionRun.create({
          data: {
            documentId: document.id,
            documentVersion: document.documentVersion,
            requestedById: appUser.id,
            provider: "manual",
            model: "human-fallback",
            promptVersion: PROMPT_VERSION,
            status: "COMPLETED",
            pageCount: document.pageCount ?? 1,
            completedAt: new Date(),
          },
        });
        runId = fallbackRun.id;
      }

      // Check if field already exists on this run
      const existingField = await tx.extractedField.findUnique({
        where: {
          extractionRunId_fieldKey: {
            extractionRunId: runId,
            fieldKey: input.fieldKey,
          },
        },
      });

      let savedField;
      if (existingField) {
        savedField = await tx.extractedField.update({
          where: { id: existingField.id },
          data: {
            currentValue: input.value,
            unit: input.unit !== undefined ? input.unit : existingField.unit,
            pageNumber: input.pageNumber ?? existingField.pageNumber,
            reviewStatus: "MANUAL_ENTRY",
            reviewReason: "MANUAL_ENTRY",
          },
        });

        await tx.fieldCorrection.create({
          data: {
            fieldId: existingField.id,
            previousValue: existingField.currentValue,
            newValue: input.value,
            reason: input.reason,
            correctedById: appUser.id,
          },
        });
      } else {
        savedField = await tx.extractedField.create({
          data: {
            documentId: document.id,
            extractionRunId: runId,
            fieldKey: input.fieldKey,
            modelValue: null, // Immutable original remains null
            currentValue: input.value,
            unit: input.unit ?? null,
            pageNumber: input.pageNumber ?? null,
            sourceQuote: "Manual entry by reviewer",
            modelConfidence: null,
            reviewStatus: "MANUAL_ENTRY",
            reviewReason: "MANUAL_ENTRY",
          },
        });

        await tx.fieldCorrection.create({
          data: {
            fieldId: savedField.id,
            previousValue: null,
            newValue: input.value,
            reason: input.reason,
            correctedById: appUser.id,
          },
        });
      }

      // Increment shipment revision and mark IN_REVIEW (invalidates approvals)
      await tx.shipment.update({
        where: { id: document.shipmentId },
        data: {
          currentRevision: { increment: 1 },
          status: "IN_REVIEW",
        },
      });

      // Audit log event
      await tx.auditEvent.create({
        data: {
          shipmentId: document.shipmentId,
          actorId: appUser.id,
          action: "FIELD_MANUALLY_ENTERED",
          entityType: "ExtractedField",
          entityId: savedField.id,
          metadata: {
            documentId: document.id,
            fieldKey: input.fieldKey,
            value: input.value,
            reason: input.reason,
          },
        },
      });

      return savedField;
    });

    return NextResponse.json({ field: updatedField });
  } catch (error) {
    return apiError(error);
  }
}

