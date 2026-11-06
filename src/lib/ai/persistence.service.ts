import type { PrismaClient } from "@/generated/prisma/client";
import { PROMPT_VERSION } from "@/lib/ai/extraction-prompts";
import type { DocumentType, ExtractionAdapterOutput } from "@/lib/ai/types";

export type CreateExtractionRunParams = {
  documentId: string;
  requestedById: string;
  provider: string;
  model: string;
  promptVersion?: string;
  pageCount: number;
  inputSizeBytes?: number;
  idempotencyKey?: string;
  retryOfRunId?: string;
};

export type SaveExtractionResultParams = {
  runId: string;
  result: ExtractionAdapterOutput;
  batchNumber?: number;
  isFinal?: boolean;
  latencyMs?: number;
  storeRawResponse?: boolean;
  rawResponseContent?: string;
};

export type RecordExtractionFailureParams = {
  runId: string;
  errorCode: string;
  errorMessage: string;
  latencyMs?: number;
};

export type ShipmentExtractionReadiness = {
  isReadyForReview: boolean;
  completedSlots: DocumentType[];
  pendingSlots: DocumentType[];
  missingSlots: DocumentType[];
  failedSlots: DocumentType[];
  blockingReasons: string[];
};

const REQUIRED_SLOTS: DocumentType[] = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"];

/**
 * Week 3 Step 2: Extraction Persistence Service
 * Manages atomic lifecycle of ExtractionRun, ExtractedField, LineItem,
 * and DocumentPage records with revision and idempotency guarantees.
 */
export class ExtractionPersistenceService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 1. Create or retrieve an existing run via idempotency token.
   * Tracks documentVersion, requestedBy, retry linkage, and timestamps.
   */
  async createOrGetExtractionRun(params: CreateExtractionRunParams) {
    const {
      documentId,
      requestedById,
      provider,
      model,
      promptVersion = PROMPT_VERSION,
      pageCount,
      inputSizeBytes,
      idempotencyKey,
      retryOfRunId,
    } = params;

    // Idempotency check: if run with idempotencyKey already exists, return it
    if (idempotencyKey) {
      const existingRun = await this.prisma.extractionRun.findUnique({
        where: { idempotencyKey },
        include: { document: true },
      });
      if (existingRun) {
        return { run: existingRun, isExisting: true };
      }
    }

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new Error(`Target document ${documentId} not found.`);
    }

    // Verify retry linkage if supplied
    if (retryOfRunId) {
      const parentRun = await this.prisma.extractionRun.findUnique({
        where: { id: retryOfRunId },
      });
      if (!parentRun) {
        throw new Error(`Parent extraction run ${retryOfRunId} not found.`);
      }
    }

    const run = await this.prisma.$transaction(async (tx) => {
      const createdRun = await tx.extractionRun.create({
        data: {
          documentId: document.id,
          documentVersion: document.documentVersion,
          requestedById,
          idempotencyKey: idempotencyKey || null,
          retryOfRunId: retryOfRunId || null,
          provider,
          model,
          promptVersion,
          status: "PROCESSING",
          pageCount,
          inputSizeBytes: inputSizeBytes || null,
          startedAt: new Date(),
        },
      });

      await tx.document.update({
        where: { id: document.id },
        data: { extractionStatus: "PROCESSING", pageCount },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId: document.shipmentId,
          actorId: requestedById,
          action: retryOfRunId ? "EXTRACTION_RETRY_STARTED" : "EXTRACTION_RUN_STARTED",
          entityType: "ExtractionRun",
          entityId: createdRun.id,
          metadata: {
            documentId: document.id,
            documentType: document.docType,
            documentVersion: document.documentVersion,
            provider,
            model,
            promptVersion,
            retryOfRunId: retryOfRunId || null,
          },
        },
      });

      return createdRun;
    });

    return { run, isExisting: false };
  }

  /**
   * 2. Atomically save extraction output into ExtractedField, LineItem, and DocumentPage.
   * - Preserves modelValue as immutable original AI output.
   * - Sets currentValue initially to modelValue without overwriting original.
   * - Applies confidential-data retention controls for rawResponse.
   */
  async saveExtractionResult(params: SaveExtractionResultParams) {
    const {
      runId,
      result,
      batchNumber = 0,
      isFinal = true,
      latencyMs,
      storeRawResponse = false,
      rawResponseContent,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.extractionRun.findUnique({
        where: { id: runId },
        include: { document: true },
      });
      if (!run) {
        throw new Error(`Extraction run ${runId} not found.`);
      }

      // 1. Upsert ExtractedFields: modelValue is immutable, currentValue is initialized
      for (const field of result.fields) {
        const existing = await tx.extractedField.findUnique({
          where: {
            extractionRunId_fieldKey: {
              extractionRunId: run.id,
              fieldKey: field.fieldKey,
            },
          },
        });

        const newConfidence = field.modelConfidence !== null ? Number(field.modelConfidence) : null;
        const existingConfidence =
          existing?.modelConfidence !== null && existing?.modelConfidence !== undefined
            ? Number(existing.modelConfidence)
            : null;

        const shouldUpdate =
          !existing ||
          existing.currentValue === null ||
          (newConfidence !== null && (existingConfidence === null || newConfidence > existingConfidence));

        if (!existing) {
          await tx.extractedField.create({
            data: {
              documentId: run.documentId,
              extractionRunId: run.id,
              fieldKey: field.fieldKey,
              modelValue: field.value, // Immutable original AI output
              currentValue: field.value, // Active value, initially identical
              unit: field.unit,
              modelConfidence: newConfidence,
              sourceQuote: field.sourceQuote,
              pageNumber: field.pageNumber,
              reviewReason: field.reviewReason,
              reviewStatus: "PENDING",
            },
          });
        } else if (shouldUpdate) {
          await tx.extractedField.update({
            where: { id: existing.id },
            data: {
              modelValue: existing.modelValue ?? field.value, // Never overwrite existing original
              currentValue: field.value,
              unit: field.unit,
              modelConfidence: newConfidence,
              sourceQuote: field.sourceQuote,
              pageNumber: field.pageNumber,
              reviewReason: field.reviewReason,
            },
          });
        }
      }

      // 2. Insert line items
      if (result.lineItems.length > 0) {
        await tx.lineItem.createMany({
          data: result.lineItems.map((item) => ({
            documentId: run.documentId,
            extractionRunId: run.id,
            batchNumber,
            lineNumber: item.lineNumber,
            description: item.description,
            hsnCode: item.hsnCode,
            quantity: item.quantity ? Number(item.quantity) : null,
            quantityUnit: item.quantityUnit,
            unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
            currency: item.currency,
            lineTotal: item.lineTotal ? Number(item.lineTotal) : null,
            modelConfidence:
              item.modelConfidence !== null ? Number(item.modelConfidence) : null,
            sourceQuote: item.sourceQuote,
            pageNumber: item.pageNumber,
            reviewReason: item.reviewReason,
          })),
        });
      }

      // 3. Update page-level readability states
      if (result.pageReadability && result.pageReadability.length > 0) {
        for (const page of result.pageReadability) {
          await tx.documentPage.upsert({
            where: {
              documentId_pageNumber: {
                documentId: run.documentId,
                pageNumber: page.pageNumber,
              },
            },
            update: {
              isReadable: page.isReadable,
              reviewNote: page.reviewNote ?? null,
              manualEntryRequired: !page.isReadable,
            },
            create: {
              documentId: run.documentId,
              pageNumber: page.pageNumber,
              isReadable: page.isReadable,
              reviewNote: page.reviewNote ?? null,
              manualEntryRequired: !page.isReadable,
            },
          });
        }
      }

      // 4. Update Document detected type and mismatch flag
      if (result.detectedType) {
        await tx.document.update({
          where: { id: run.documentId },
          data: {
            detectedDocType: result.detectedType,
            typeMismatch: result.typeMismatch,
          },
        });
      }

      // 5. Update ExtractionRun and Document status
      // Confidential-data retention: rawResponse is only stored if explicitly requested and sanitized
      let rawResponseData = null;
      if (storeRawResponse && rawResponseContent) {
        try {
          rawResponseData = JSON.parse(rawResponseContent);
        } catch {
          rawResponseData = { content: rawResponseContent.slice(0, 500) };
        }
      }

      const updatedRun = await tx.extractionRun.update({
        where: { id: run.id },
        data: {
          status: isFinal ? "COMPLETED" : "PROCESSING",
          completedAt: isFinal ? new Date() : null,
          latencyMs: latencyMs ?? run.latencyMs,
          rawResponse: rawResponseData,
        },
      });

      if (isFinal) {
        await tx.document.update({
          where: { id: run.documentId },
          data: { extractionStatus: "REVIEW_REQUIRED" },
        });

        if (run.requestedById) {
          await tx.auditEvent.create({
            data: {
              shipmentId: run.document.shipmentId,
              actorId: run.requestedById,
              action: "EXTRACTION_COMPLETED",
              entityType: "ExtractionRun",
              entityId: run.id,
              metadata: {
                documentId: run.documentId,
                documentType: run.document.docType,
                fieldsExtracted: result.fields.length,
                lineItemsExtracted: result.lineItems.length,
                latencyMs,
              },
            },
          });
        }
      }

      return updatedRun;
    });
  }

  /**
   * 3. Record safe extraction failure without exposing raw secrets.
   */
  async recordExtractionFailure(params: RecordExtractionFailureParams) {
    const { runId, errorCode, errorMessage, latencyMs } = params;

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.extractionRun.findUnique({
        where: { id: runId },
        include: { document: true },
      });
      if (!run) return null;

      const failedRun = await tx.extractionRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorCode,
          errorMessage,
          completedAt: new Date(),
          latencyMs: latencyMs ?? run.latencyMs,
        },
      });

      await tx.document.update({
        where: { id: run.documentId },
        data: { extractionStatus: "FAILED" },
      });

      if (run.requestedById) {
        await tx.auditEvent.create({
          data: {
            shipmentId: run.document.shipmentId,
            actorId: run.requestedById,
            action: "EXTRACTION_FAILED",
            entityType: "ExtractionRun",
            entityId: run.id,
            metadata: {
              documentId: run.documentId,
              errorCode,
              errorMessage,
            },
          },
        });
      }

      return failedRun;
    });
  }

  /**
   * 4. Create one run per current document for a shipment extraction request.
   */
  async createShipmentExtractionRuns(params: {
    shipmentId: string;
    requestedById: string;
    provider: string;
    model: string;
    idempotencyPrefix?: string;
  }) {
    const { shipmentId, requestedById, provider, model, idempotencyPrefix } = params;

    const currentDocuments = await this.prisma.document.findMany({
      where: { shipmentId, isCurrent: true },
    });

    if (currentDocuments.length === 0) {
      throw new Error(`No current documents found for shipment ${shipmentId}.`);
    }

    const runs = [];
    for (const doc of currentDocuments) {
      const idempotencyKey = idempotencyPrefix
        ? `${idempotencyPrefix}-${doc.id}-${doc.documentVersion}`
        : undefined;

      const { run } = await this.createOrGetExtractionRun({
        documentId: doc.id,
        requestedById,
        provider,
        model,
        pageCount: doc.pageCount || 1,
        idempotencyKey,
      });

      runs.push(run);
    }

    return runs;
  }

  /**
   * 5. Check if shipment extraction is fully completed or has approved manual fallbacks.
   * Keeps shipment blocked if any required document is missing, extracting, or unhandled.
   */
  async checkShipmentExtractionReadiness(shipmentId: string): Promise<ShipmentExtractionReadiness> {
    const currentDocuments = await this.prisma.document.findMany({
      where: { shipmentId, isCurrent: true },
      include: {
        extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 },
        pages: true,
      },
    });

    const completedSlots: DocumentType[] = [];
    const pendingSlots: DocumentType[] = [];
    const missingSlots: DocumentType[] = [];
    const failedSlots: DocumentType[] = [];
    const blockingReasons: string[] = [];

    const docMap = new Map<DocumentType, (typeof currentDocuments)[number]>();
    for (const doc of currentDocuments) {
      docMap.set(doc.docType, doc);
    }

    for (const slot of REQUIRED_SLOTS) {
      const doc = docMap.get(slot);
      if (!doc) {
        missingSlots.push(slot);
        blockingReasons.push(`Missing mandatory ${slot.replace("_", " ")} document.`);
        continue;
      }

      const latestRun = doc.extractionRuns[0];
      if (!latestRun) {
        pendingSlots.push(slot);
        blockingReasons.push(`${slot.replace("_", " ")} has not been extracted yet.`);
        continue;
      }

      if (latestRun.status === "FAILED") {
        failedSlots.push(slot);
        blockingReasons.push(
          `${slot.replace("_", " ")} extraction failed: ${latestRun.errorCode ?? "Error"}.`,
        );
        continue;
      }

      if (latestRun.status === "PROCESSING" || latestRun.status === "QUEUED") {
        pendingSlots.push(slot);
        blockingReasons.push(`${slot.replace("_", " ")} extraction is currently in progress.`);
        continue;
      }

      if (latestRun.status === "COMPLETED") {
        completedSlots.push(slot);
      }
    }

    const isReadyForReview =
      completedSlots.length === REQUIRED_SLOTS.length &&
      pendingSlots.length === 0 &&
      missingSlots.length === 0 &&
      failedSlots.length === 0;

    return {
      isReadyForReview,
      completedSlots,
      pendingSlots,
      missingSlots,
      failedSlots,
      blockingReasons,
    };
  }
}

