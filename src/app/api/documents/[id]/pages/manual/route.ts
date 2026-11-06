import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

const markPageManualSchema = z.object({
  pageNumber: z.number().int().positive(),
  manualEntryRequired: z.boolean().default(true),
  reviewNote: z.string().trim().max(500).optional(),
});

/**
 * Week 3 Step 5: Mark Page for Manual Entry
 * Allows an Executive or Manager to mark an unreadable or garbled page for manual entry.
 * Unlocks manual field fallback and invalidates prior manager approvals via revision increment.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: documentId } = await context.params;
    const input = markPageManualSchema.parse(await request.json());

    const prisma = getPrisma();
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        shipment:
          appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
      include: { shipment: true },
    });

    if (!document) {
      throw new Error("Document not found or inaccessible.");
    }

    const updatedPage = await prisma.$transaction(async (tx) => {
      // Upsert DocumentPage record
      const page = await tx.documentPage.upsert({
        where: {
          documentId_pageNumber: {
            documentId,
            pageNumber: input.pageNumber,
          },
        },
        update: {
          manualEntryRequired: input.manualEntryRequired,
          isReadable: input.manualEntryRequired ? false : true,
          reviewNote: input.reviewNote ?? "Marked for manual entry by user.",
        },
        create: {
          documentId,
          pageNumber: input.pageNumber,
          manualEntryRequired: input.manualEntryRequired,
          isReadable: input.manualEntryRequired ? false : true,
          reviewNote: input.reviewNote ?? "Marked for manual entry by user.",
        },
      });

      // Invalidate existing approvals and increment revision
      await tx.shipment.update({
        where: { id: document.shipmentId },
        data: {
          currentRevision: { increment: 1 },
          status: "IN_REVIEW",
        },
      });

      // Record audit event
      await tx.auditEvent.create({
        data: {
          shipmentId: document.shipmentId,
          actorId: appUser.id,
          action: "PAGE_MARKED_FOR_MANUAL_ENTRY",
          entityType: "DocumentPage",
          entityId: page.id,
          metadata: {
            documentId,
            pageNumber: input.pageNumber,
            manualEntryRequired: input.manualEntryRequired,
            reviewNote: input.reviewNote ?? null,
          },
        },
      });

      return page;
    });

    return NextResponse.json({ page: updatedPage });
  } catch (error) {
    return apiError(error);
  }
}

