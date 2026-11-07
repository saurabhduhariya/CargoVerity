import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { startDocumentExtraction } from "@/lib/ai/extraction-workflow";
import { ExtractionPersistenceService } from "@/lib/ai/persistence.service";
import { documentTypes, type DocumentType } from "@/lib/ai/types";

const extractRequestSchema = z
  .object({
    documentTypes: z.array(z.enum(documentTypes)).optional(),
    /** Retry documents whose latest run FAILED (creates new linked runs). */
    forceRetry: z.boolean().default(false),
  })
  .default({ forceRetry: false });

/**
 * Week 3 Step 2/6: start one run per current document (idempotent per document version, model
 * and prompt). Partial completion is allowed; the shipment stays EXTRACTING until every started
 * run has finished, which the persistence layer decides server-side.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;

    const text = await request.text();
    let bodyData: unknown = {};
    if (text.trim().length > 0) {
      try {
        bodyData = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Invalid JSON request body.", code: "INVALID_JSON" }, { status: 400 });
      }
    }

    const input = extractRequestSchema.parse(bodyData);
    const prisma = getPrisma();

    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
      include: {
        documents: {
          where: { isCurrent: true },
          include: { extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
    });

    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found or unauthorized.", code: "NOT_FOUND" }, { status: 404 });
    }
    if (shipment.documents.length === 0) {
      return NextResponse.json(
        { error: "No active documents found to extract. Upload documents first.", code: "NO_DOCUMENTS" },
        { status: 400 },
      );
    }

    const targetDocs =
      input.documentTypes && input.documentTypes.length > 0
        ? shipment.documents.filter((d) => input.documentTypes!.includes(d.selectedDocType as DocumentType))
        : shipment.documents;

    if (targetDocs.length === 0) {
      return NextResponse.json(
        { error: "None of the requested document types are currently uploaded.", code: "DOCUMENTS_NOT_FOUND" },
        { status: 400 },
      );
    }

    const provider = createAIProvider();
    const runs = [];
    for (const doc of targetDocs) {
      const retry = input.forceRetry && doc.extractionRuns[0]?.status === "FAILED";
      const { run, isExisting } = await startDocumentExtraction(prisma, {
        documentId: doc.id,
        actor: appUser,
        provider,
        retry,
      });
      runs.push({
        id: run.id,
        documentId: doc.id,
        documentType: doc.selectedDocType,
        documentVersion: doc.documentVersion,
        status: run.status,
        provider: run.provider,
        model: run.model,
        retryOfRunId: run.retryOfRunId,
        existing: isExisting,
      });
    }

    await prisma.auditEvent.create({
      data: {
        shipmentId: shipment.id,
        actorId: appUser.id,
        action: input.forceRetry ? "EXTRACTION_RETRY_STARTED" : "SHIPMENT_EXTRACTION_INITIATED",
        entityType: "Shipment",
        entityId: shipment.id,
        metadata: { documentCount: targetDocs.length, runIds: runs.map((r) => r.id), model: provider.model },
      },
    });

    const refreshed = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    return NextResponse.json({ shipmentId: shipment.id, status: refreshed.status, runs });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Persisted per-document extraction state for polling. Counts come from the latest COMPLETED
 * run (the one reviewers and cross-checks use); status comes from the latest run of any state.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;
    const prisma = getPrisma();

    const scoped = await prisma.shipment.findFirst({
      where: { id: shipmentId, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
      select: { id: true },
    });
    if (!scoped) {
      return NextResponse.json({ error: "Shipment not found or unauthorized.", code: "NOT_FOUND" }, { status: 404 });
    }

    const persistenceService = new ExtractionPersistenceService(prisma);
    await persistenceService.expireStaleRuns(shipmentId);

    const shipment = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
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
            pages: { select: { id: true, pageNumber: true, isReadable: true, manualEntryRequired: true } },
          },
        },
      },
    });

    const completedRuns = await prisma.extractionRun.findMany({
      where: { documentId: { in: shipment.documents.map((d) => d.id) }, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: {
        documentId: true,
        fields: { select: { reviewStatus: true, reviewReason: true } },
      },
    });
    const latestCompleted = new Map<string, (typeof completedRuns)[number]>();
    for (const run of completedRuns) if (!latestCompleted.has(run.documentId)) latestCompleted.set(run.documentId, run);

    const readiness = await persistenceService.checkShipmentExtractionReadiness(shipment.id);
    const isExtracting = shipment.documents.some((d) => d.extractionRuns[0]?.status === "PROCESSING");

    const documents = shipment.documents.map((doc) => {
      const fields = latestCompleted.get(doc.id)?.fields ?? [];
      const count = (status: string) => fields.filter((f) => f.reviewStatus === status).length;
      return {
        documentId: doc.id,
        docType: doc.selectedDocType as DocumentType,
        documentVersion: doc.documentVersion,
        originalFileName: doc.originalFileName,
        extractionStatus: doc.extractionStatus,
        typeMismatch: doc.typeMismatch,
        detectedDocType: doc.detectedDocType,
        latestRun: doc.extractionRuns[0] ?? null,
        extractedFieldCount: fields.filter((f) => f.reviewStatus !== "NOT_PRESENT").length,
        reviewRequiredCount: count("REQUIRES_REVIEW"),
        lowConfidenceCount: fields.filter((f) => f.reviewReason === "LOW_MODEL_CONFIDENCE").length,
        confirmedCount: count("CONFIRMED"),
        correctedCount: count("CORRECTED"),
        manualEntryCount: count("MANUAL_ENTRY"),
        unreadablePageCount: doc.pages.filter((p) => !p.isReadable && !p.manualEntryRequired).length,
        unreadablePages: doc.pages.filter((p) => !p.isReadable && !p.manualEntryRequired).map((p) => p.pageNumber),
        manualPagesCount: doc.pages.filter((p) => p.manualEntryRequired).length,
      };
    });

    return NextResponse.json({
      shipmentId: shipment.id,
      shipmentStatus: shipment.status,
      shipmentRevision: shipment.currentRevision,
      isExtracting,
      readiness,
      documents,
    });
  } catch (error) {
    return apiError(error);
  }
}
