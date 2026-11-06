import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { ExtractionPersistenceService } from "@/lib/ai/persistence.service";

const documentExtractSchema = z
  .object({
    retry: z.boolean().default(false),
    retryOfRunId: z.string().uuid().optional(),
  })
  .default({ retry: false });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: documentId } = await context.params;

    let bodyData: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        bodyData = JSON.parse(text);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request payload.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const input = documentExtractSchema.parse(bodyData);
    const prisma = getPrisma();

    // Authorize document and shipment access
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        isCurrent: true,
        shipment:
          appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
      include: {
        shipment: true,
        extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found or inaccessible.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const provider = createAIProvider();
    const persistenceService = new ExtractionPersistenceService(prisma);

    // Update shipment status to EXTRACTING
    await prisma.shipment.update({
      where: { id: document.shipmentId },
      data: { status: "EXTRACTING" },
    });

    const latestRun = document.extractionRuns[0];
    const retryOfRunId = input.retryOfRunId ?? (input.retry ? latestRun?.id : undefined);
    const idempotencyKey = input.retry
      ? `retry-${document.id}-${document.documentVersion}-${Date.now()}`
      : undefined;

    const { run } = await persistenceService.createOrGetExtractionRun({
      documentId: document.id,
      requestedById: appUser.id,
      provider: provider.name,
      model: provider.model,
      pageCount: document.pageCount || 1,
      idempotencyKey,
      retryOfRunId,
    });

    return NextResponse.json({
      success: true,
      documentId: document.id,
      runId: run.id,
      status: run.status,
      retryOfRunId: run.retryOfRunId,
      provider: run.provider,
      model: run.model,
    });
  } catch (error) {
    return apiError(error);
  }
}
