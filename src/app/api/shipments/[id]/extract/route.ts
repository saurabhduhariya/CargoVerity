import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { ExtractionPersistenceService } from "@/lib/ai/persistence.service";
import { documentTypes, type DocumentType } from "@/lib/ai/types";

const extractRequestSchema = z
  .object({
    documentTypes: z.array(z.enum(documentTypes)).optional(),
    forceRetry: z.boolean().default(false),
  })
  .default({ forceRetry: false });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;

    let bodyData: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        bodyData = JSON.parse(text);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const input = extractRequestSchema.parse(bodyData);
    const prisma = getPrisma();

    // 1. Authorize shipment access
    const shipment = await prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
      },
      include: {
        documents: {
          where: { isCurrent: true },
          include: {
            extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    if (!shipment) {
      return NextResponse.json(
        { error: "Shipment not found or unauthorized.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    if (shipment.documents.length === 0) {
      return NextResponse.json(
        {
          error: "No active documents found to extract. Upload documents first.",
          code: "NO_DOCUMENTS",
        },
        { status: 400 },
      );
    }

    // Filter target documents if specific types requested
    const targetDocs = input.documentTypes && input.documentTypes.length > 0
      ? shipment.documents.filter((d) =>
          input.documentTypes!.includes(d.docType as DocumentType),
        )
      : shipment.documents;

    if (targetDocs.length === 0) {
      return NextResponse.json(
        {
          error: "None of the requested document types are currently uploaded.",
          code: "DOCUMENTS_NOT_FOUND",
        },
        { status: 400 },
      );
    }

    const provider = createAIProvider();
    const persistenceService = new ExtractionPersistenceService(prisma);

    // 2. Set shipment status to EXTRACTING atomically
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: "EXTRACTING" },
    });

    // 3. Create or retrieve extraction runs for each target document
    const runs = [];
    for (const doc of targetDocs) {
      const latestRun = doc.extractionRuns[0];
      const isRetry = input.forceRetry && latestRun?.status === "FAILED";

      const { run } = await persistenceService.createOrGetExtractionRun({
        documentId: doc.id,
        requestedById: appUser.id,
        provider: provider.name,
        model: provider.model,
        pageCount: doc.pageCount || 1,
        idempotencyKey: isRetry
          ? `retry-${doc.id}-${doc.documentVersion}-${Date.now()}`
          : undefined,
        retryOfRunId: isRetry ? latestRun?.id : undefined,
      });

      runs.push({
        id: run.id,
        documentId: doc.id,
        documentType: doc.docType,
        documentVersion: doc.documentVersion,
        status: run.status,
        provider: run.provider,
        model: run.model,
      });
    }

    // 4. Audit event
    await prisma.auditEvent.create({
      data: {
        shipmentId: shipment.id,
        actorId: appUser.id,
        action: input.forceRetry ? "EXTRACTION_RETRY_STARTED" : "SHIPMENT_EXTRACTION_INITIATED",
        entityType: "Shipment",
        entityId: shipment.id,
        metadata: {
          documentCount: targetDocs.length,
          runIds: runs.map((r) => r.id),
          model: provider.model,
        },
      },
    });

    return NextResponse.json({
      shipmentId: shipment.id,
      status: "EXTRACTING",
      runs,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;
    const prisma = getPrisma();

    const shipment = await prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
      },
      include: {
        documents: {
          where: { isCurrent: true },
          include: {
            extractionRuns: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                provider: true,
                model: true,
                errorCode: true,
                errorMessage: true,
                completedAt: true,
                latencyMs: true,
              },
            },
            fields: {
              select: {
                id: true,
                fieldKey: true,
                reviewStatus: true,
                modelConfidence: true,
              },
            },
            pages: {
              select: {
                id: true,
                pageNumber: true,
                isReadable: true,
                manualEntryRequired: true,
              },
            },
          },
        },
      },
    });

    if (!shipment) {
      return NextResponse.json(
        { error: "Shipment not found or unauthorized.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const persistenceService = new ExtractionPersistenceService(prisma);
    const readiness = await persistenceService.checkShipmentExtractionReadiness(shipment.id);

    // Check if any document is currently actively processing/queued
    const activeRuns = shipment.documents.filter((d) => {
      const latestRun = d.extractionRuns[0];
      return latestRun && (latestRun.status === "PROCESSING" || latestRun.status === "QUEUED");
    });
    const isExtracting = activeRuns.length > 0;

    // If shipment was in EXTRACTING state and all runs have finished, determine state
    let effectiveStatus = shipment.status;
    if (shipment.status === "EXTRACTING" && !isExtracting) {
      // Transition from EXTRACTING to NEEDS_REVIEW
      effectiveStatus = "NEEDS_REVIEW";
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: "NEEDS_REVIEW" },
      });
    }

    const documents = shipment.documents.map((doc) => {
      const latestRun = doc.extractionRuns[0] ?? null;
      const totalFields = doc.fields.length;
      const reviewRequiredCount = doc.fields.filter(
        (f) => f.reviewStatus === "REQUIRES_REVIEW",
      ).length;
      const confirmedCount = doc.fields.filter(
        (f) => f.reviewStatus === "CONFIRMED",
      ).length;
      const correctedCount = doc.fields.filter(
        (f) => f.reviewStatus === "CORRECTED",
      ).length;
      const manualEntryCount = doc.fields.filter(
        (f) => f.reviewStatus === "MANUAL_ENTRY",
      ).length;
      const unreadablePageCount = doc.pages.filter(
        (p) => !p.isReadable && !p.manualEntryRequired,
      ).length;
      const manualPagesCount = doc.pages.filter((p) => p.manualEntryRequired).length;

      return {
        documentId: doc.id,
        docType: doc.docType as DocumentType,
        documentVersion: doc.documentVersion,
        originalFileName: doc.originalFileName,
        extractionStatus: doc.extractionStatus,
        typeMismatch: doc.typeMismatch,
        detectedDocType: doc.detectedDocType,
        latestRun,
        extractedFieldCount: totalFields,
        reviewRequiredCount,
        confirmedCount,
        correctedCount,
        manualEntryCount,
        unreadablePageCount,
        manualPagesCount,
      };
    });

    return NextResponse.json({
      shipmentId: shipment.id,
      shipmentStatus: effectiveStatus,
      shipmentRevision: shipment.currentRevision,
      isExtracting,
      readiness,
      documents,
    });
  } catch (error) {
    return apiError(error);
  }
}
