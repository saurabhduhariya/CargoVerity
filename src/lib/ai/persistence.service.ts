import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PROMPT_VERSION, SCHEMA_VERSION } from "@/lib/ai/extraction-prompts";
import { ExtractionReviewPolicyService } from "@/lib/ai/review-policy.service";
import type {
  DocumentType,
  ExtractionAdapterOutput,
  ExtractionUsage,
  NormalizedField,
  NormalizedLineItem,
  PageReadability,
} from "@/lib/ai/types";
import { ExtractionError } from "@/lib/errors";

export type CreateExtractionRunParams = {
  documentId: string;
  requestedById: string;
  provider: string;
  model: string;
  promptVersion?: string;
  /** Ignored for the Document row: the page count is measured server-side at upload. */
  pageCount: number;
  inputSizeBytes?: number;
  idempotencyKey?: string;
  retryOfRunId?: string;
};

export type SaveExtractionResultParams = {
  runId: string;
  result: ExtractionAdapterOutput;
  batchNumber?: number;
  /** Page numbers sent in this batch; readability rows are written for exactly these pages. */
  pageNumbers?: number[];
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

/** Per-batch bookkeeping stored in ExtractionRun.rawResponse (no document content). */
type BatchRecord = {
  pageNumbers: number[];
  usage?: ExtractionUsage;
  latencyMs?: number;
  warnings: string[];
};

type RunMetadata = {
  usage?: ExtractionUsage;
  providerMetadata?: ExtractionAdapterOutput["providerMetadata"];
  warnings?: string[];
  batches?: Record<string, BatchRecord>;
  rawContent?: unknown;
};

type Tx = Prisma.TransactionClient;

const REQUIRED_SLOTS: DocumentType[] = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"];
const HUMAN_REVIEW_STATUSES = new Set(["CONFIRMED", "CORRECTED", "MANUAL_ENTRY"]);

/** A PROCESSING run older than this is treated as abandoned (browser closed mid-extraction). */
export const STALE_RUN_AFTER_MS = 30 * 60 * 1000;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Idempotency key for the first extraction of an exact document version, model and prompt. */
export function initialExtractionKey(params: {
  documentId: string;
  documentVersion: number;
  provider: string;
  model: string;
  promptVersion?: string;
}) {
  return `extract:${params.documentId}:v${params.documentVersion}:${params.provider}:${params.model}:${params.promptVersion ?? PROMPT_VERSION}`;
}

/** Idempotency key for the (single) retry of a given run; retrying the retry chains from it. */
export function retryExtractionKey(parentRunId: string) {
  return `retry:${parentRunId}`;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function readMetadata(raw: unknown): RunMetadata {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as RunMetadata) : {};
}

function addUsage(a: ExtractionUsage | undefined, b: ExtractionUsage | undefined): ExtractionUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return {
    promptTokens: sum(a.promptTokens, b.promptTokens),
    completionTokens: sum(a.completionTokens, b.completionTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
    imageCount: a.imageCount + b.imageCount,
    requestCount: a.requestCount + b.requestCount,
  };
}

/** Policy code plus the model's own evidence note, e.g. "MISSING_SOURCE_EVIDENCE: CALCULATED". */
function persistedReviewReason(code: string | null, modelReason: string | null) {
  if (!code) return null;
  return modelReason && code === "MISSING_SOURCE_EVIDENCE" ? `${code}: ${modelReason.slice(0, 120)}` : code;
}

/**
 * Week 3 Step 2: Extraction Persistence Service.
 * Run lifecycle: PROCESSING → COMPLETED | FAILED (the schema's QUEUED is unused; a run is
 * created when work starts). Runs are never deleted or overwritten: retries are new runs.
 */
export class ExtractionPersistenceService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 1. Create, or return the existing run for, an idempotency key. Race-safe: the unique index on
   * ExtractionRun.idempotencyKey decides the winner and the loser returns the winner's run.
   */
  async createOrGetExtractionRun(params: CreateExtractionRunParams) {
    const {
      documentId,
      requestedById,
      provider,
      model,
      promptVersion = PROMPT_VERSION,
      inputSizeBytes,
      idempotencyKey,
      retryOfRunId,
    } = params;

    if (idempotencyKey) {
      const existingRun = await this.prisma.extractionRun.findUnique({
        where: { idempotencyKey },
        include: { document: true },
      });
      if (existingRun) {
        if (existingRun.documentId !== documentId) {
          throw new ExtractionError("Extraction run not found for this document.", "RUN_NOT_FOUND", 404);
        }
        return { run: existingRun, isExisting: true };
      }
    }

    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new ExtractionError("Document not found or inaccessible.", "DOCUMENT_NOT_FOUND", 404);
    }

    if (retryOfRunId) {
      const parentRun = await this.prisma.extractionRun.findUnique({ where: { id: retryOfRunId } });
      if (!parentRun || parentRun.documentId !== document.id) {
        throw new ExtractionError("The run being retried does not belong to this document.", "RUN_NOT_FOUND", 404);
      }
    }

    try {
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
            pageCount: document.pageCount ?? params.pageCount,
            inputSizeBytes: inputSizeBytes || null,
            startedAt: new Date(),
          },
          include: { document: true },
        });

        await tx.document.update({
          where: { id: document.id },
          data: { extractionStatus: "PROCESSING" },
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
              documentType: document.selectedDocType,
              documentVersion: document.documentVersion,
              provider,
              model,
              promptVersion,
              retryOfRunId: retryOfRunId || null,
            },
          },
        });

        return createdRun;
      }, TRANSACTION_OPTIONS);

      return { run, isExisting: false };
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error)) {
        const winner = await this.prisma.extractionRun.findUnique({
          where: { idempotencyKey },
          include: { document: true },
        });
        if (winner && winner.documentId === documentId) return { run: winner, isExisting: true };
      }
      throw error;
    }
  }

  /** Returns the stored record of a batch already persisted on this run, or null. */
  async getCompletedBatch(runId: string, batchNumber: number): Promise<BatchRecord | null> {
    const run = await this.prisma.extractionRun.findUnique({ where: { id: runId }, select: { rawResponse: true } });
    return readMetadata(run?.rawResponse).batches?.[String(batchNumber)] ?? null;
  }

  /**
   * 2. Atomically save one batch of extraction output.
   * - Only a PROCESSING run accepts results; a replayed batch number is a no-op.
   * - modelValue is the AI output for this run. It is written once per field; a later batch may
   *   supply a missing or higher-confidence value only while no human has touched the field,
   *   in which case modelValue and currentValue move together. After any human action the
   *   field is never changed by extraction again.
   * - Decimals are stored from canonical strings (no float conversion).
   * - On the final batch the run completes, the shipment revision is bumped (new values
   *   invalidate prior cross-checks and approvals) and the shipment status is settled.
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
        throw new ExtractionError("Extraction run not found.", "RUN_NOT_FOUND", 404);
      }
      if (run.status !== "PROCESSING") {
        throw new ExtractionError("This extraction run is already closed.", "RUN_CLOSED", 409);
      }

      const metadata = readMetadata(run.rawResponse);
      const batches = { ...(metadata.batches ?? {}) };
      if (batches[String(batchNumber)]) {
        return { run, replayed: true as const };
      }

      const docType = run.document.selectedDocType as DocumentType;
      const evaluation = new ExtractionReviewPolicyService().evaluateDocumentExtraction({
        expectedDocumentType: docType,
        extractionResult: result,
      });

      // 1. Fields
      for (const field of evaluation.fields) {
        const existing = await tx.extractedField.findUnique({
          where: { extractionRunId_fieldKey: { extractionRunId: run.id, fieldKey: field.fieldKey } },
        });
        const newConfidence = field.modelConfidence;
        const reviewReason = persistedReviewReason(field.reviewReason, field.modelReviewReason);
        const values = {
          modelValue: field.value,
          currentValue: field.value,
          unit: field.unit,
          modelConfidence: newConfidence,
          sourceQuote: field.sourceQuote,
          pageNumber: field.pageNumber,
          reviewReason,
          reviewStatus: field.reviewStatus,
        };

        if (!existing) {
          await tx.extractedField.create({
            data: { documentId: run.documentId, extractionRunId: run.id, fieldKey: field.fieldKey, ...values },
          });
          continue;
        }

        const humanTouched =
          HUMAN_REVIEW_STATUSES.has(existing.reviewStatus) || existing.currentValue !== existing.modelValue;
        if (humanTouched || field.value === null) continue;

        const existingConfidence = existing.modelConfidence === null ? null : Number(existing.modelConfidence);
        const better =
          existing.modelValue === null ||
          (newConfidence !== null && (existingConfidence === null || newConfidence > existingConfidence));
        if (better) {
          await tx.extractedField.update({ where: { id: existing.id }, data: values });
        }
      }

      // 2. Line items for this batch (replacing nothing: a batch number is written once)
      if (evaluation.lineItems.length > 0) {
        // Printed line numbers are kept when they are unique; otherwise lines are numbered in order
        // so no extracted line is silently dropped by the (run, batch, lineNumber) unique key.
        const printed = evaluation.lineItems.map((item) => item.lineNumber);
        const usePrinted = printed.every((n) => n > 0) && new Set(printed).size === printed.length;
        await tx.lineItem.createMany({
          data: evaluation.lineItems.map((item, index) => ({
            documentId: run.documentId,
            extractionRunId: run.id,
            batchNumber,
            lineNumber: usePrinted ? item.lineNumber : index + 1,
            description: item.description,
            hsnCode: item.hsnCode,
            quantity: item.quantity,
            quantityUnit: item.quantityUnit,
            unitPrice: item.unitPrice,
            currency: item.currency,
            lineTotal: item.lineTotal,
            modelConfidence: item.modelConfidence,
            sourceQuote: item.sourceQuote,
            pageNumber: item.pageNumber,
            reviewReason: item.reviewReason,
          })),
          skipDuplicates: true,
        });
      }

      // 3. Page readability for exactly the pages in this batch. The AI may say a page is
      //    unreadable; only a person marks it for manual entry (manualEntryRequired).
      const reported = new Map((result.pageReadability ?? []).map((p) => [p.pageNumber, p]));
      const batchPages = params.pageNumbers ?? [...reported.keys()];
      for (const pageNumber of batchPages) {
        const page = reported.get(pageNumber);
        const isReadable = page ? page.isReadable : true;
        const reviewNote = page?.reviewNote ?? null;
        await tx.documentPage.upsert({
          where: { documentId_pageNumber: { documentId: run.documentId, pageNumber } },
          update: { isReadable, reviewNote },
          create: { documentId: run.documentId, pageNumber, isReadable, reviewNote },
        });
      }

      // 4. Detected type (first batch that reports one wins; a mismatch anywhere sticks)
      if (result.detectedType) {
        await tx.document.update({
          where: { id: run.documentId },
          data: {
            detectedDocType: run.document.detectedDocType ?? result.detectedType,
            typeMismatch: run.document.typeMismatch || Boolean(evaluation.typeMismatch),
          },
        });
      }

      // 5. Run bookkeeping — usage, safe metadata and warnings only (no prompts or images)
      batches[String(batchNumber)] = {
        pageNumbers: batchPages,
        usage: result.usage,
        latencyMs,
        warnings: result.warnings,
      };
      const nextMetadata: RunMetadata = {
        usage: addUsage(metadata.usage, result.usage),
        providerMetadata: result.providerMetadata ?? metadata.providerMetadata,
        warnings: [...new Set([...(metadata.warnings ?? []), ...result.warnings])],
        batches,
      };
      if (storeRawResponse && rawResponseContent) {
        nextMetadata.rawContent = rawResponseContent.slice(0, 20_000);
      }
      const totalLatency = (run.latencyMs ?? 0) + (latencyMs ?? 0);

      const updatedRun = await tx.extractionRun.update({
        where: { id: run.id },
        data: {
          status: isFinal ? "COMPLETED" : "PROCESSING",
          completedAt: isFinal ? new Date() : null,
          latencyMs: totalLatency,
          rawResponse: nextMetadata as Prisma.InputJsonValue,
        },
      });

      if (!isFinal) return { run: updatedRun, replayed: false as const };

      // 6. Finalize: document status from the persisted review state of this run.
      const needsReview =
        (await tx.extractedField.count({ where: { extractionRunId: run.id, reviewStatus: "REQUIRES_REVIEW" } })) > 0 ||
        (await tx.documentPage.count({ where: { documentId: run.documentId, isReadable: false } })) > 0 ||
        run.document.typeMismatch ||
        Boolean(evaluation.typeMismatch);

      await tx.document.update({
        where: { id: run.documentId },
        data: { extractionStatus: needsReview ? "REVIEW_REQUIRED" : "EXTRACTED" },
      });

      const shipment = await settleShipmentAfterRun(tx, run.document.shipmentId, run.id, { bumpRevision: true });

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
              documentType: run.document.selectedDocType,
              documentVersion: run.documentVersion,
              batches: Object.keys(batches).length,
              latencyMs: totalLatency,
              revision: shipment.currentRevision,
            },
          },
        });
      }

      return { run: updatedRun, replayed: false as const };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Rebuilds the ExtractionAdapterOutput of a completed run from the database, so an idempotent
   * replay returns the stored result without calling the metered provider again.
   */
  async getExtractionRunResult(runId: string): Promise<ExtractionAdapterOutput | null> {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: {
        document: { include: { pages: { orderBy: { pageNumber: "asc" } } } },
        fields: true,
        lineItems: { orderBy: [{ batchNumber: "asc" }, { lineNumber: "asc" }] },
      },
    });

    if (!run || !run.document) return null;

    const metadata = readMetadata(run.rawResponse);
    const fields: NormalizedField[] = run.fields.map((f) => ({
      fieldKey: f.fieldKey,
      value: f.currentValue,
      unit: f.unit,
      modelConfidence: f.modelConfidence !== null ? Number(f.modelConfidence) : null,
      confidenceLabel: "model estimate",
      sourceQuote: f.sourceQuote,
      pageNumber: f.pageNumber,
      reviewStatus: f.reviewStatus as NormalizedField["reviewStatus"],
      reviewReason: f.reviewReason,
    }));

    const lineItems: NormalizedLineItem[] = run.lineItems.map((item) => ({
      lineNumber: item.lineNumber,
      description: item.description,
      hsnCode: item.hsnCode,
      quantity: item.quantity !== null ? item.quantity.toString() : null,
      quantityUnit: item.quantityUnit,
      unitPrice: item.unitPrice !== null ? item.unitPrice.toString() : null,
      currency: item.currency,
      lineTotal: item.lineTotal !== null ? item.lineTotal.toString() : null,
      modelConfidence: item.modelConfidence !== null ? Number(item.modelConfidence) : null,
      confidenceLabel: "model estimate",
      sourceQuote: item.sourceQuote,
      pageNumber: item.pageNumber,
      reviewReason: item.reviewReason,
    }));

    const pageReadability: PageReadability[] = run.document.pages.map((p) => ({
      pageNumber: p.pageNumber,
      isReadable: p.isReadable,
      reviewNote: p.reviewNote,
    }));

    return {
      documentType: run.document.selectedDocType as DocumentType,
      detectedType: (run.document.detectedDocType as DocumentType) ?? null,
      typeMismatch: run.document.typeMismatch,
      pageReadability,
      provider: run.provider as "groq" | "openrouter",
      model: run.model,
      fields,
      lineItems,
      usage: metadata.usage,
      providerMetadata: {
        provider: run.provider as "groq" | "openrouter",
        model: run.model,
        promptVersion: run.promptVersion,
        schemaVersion: SCHEMA_VERSION,
        latencyMs: run.latencyMs ?? undefined,
      },
      warnings: metadata.warnings ?? [],
    };
  }

  /**
   * 3. Record a failure with a safe code and message. The run (and any batches already saved on
   * it) stays in history; a retry is a new run linked through retryOfRunId.
   */
  async recordExtractionFailure(params: RecordExtractionFailureParams) {
    const { runId, errorCode, errorMessage, latencyMs } = params;

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.extractionRun.findUnique({
        where: { id: runId },
        include: { document: true },
      });
      if (!run || run.status !== "PROCESSING") return null;

      const failedRun = await tx.extractionRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorCode,
          errorMessage: errorMessage.slice(0, 300),
          completedAt: new Date(),
          latencyMs: (run.latencyMs ?? 0) + (latencyMs ?? 0),
        },
      });

      await tx.document.update({
        where: { id: run.documentId },
        data: { extractionStatus: "FAILED" },
      });

      await settleShipmentAfterRun(tx, run.document.shipmentId, run.id, { bumpRevision: false });

      if (run.requestedById) {
        await tx.auditEvent.create({
          data: {
            shipmentId: run.document.shipmentId,
            actorId: run.requestedById,
            action: "EXTRACTION_FAILED",
            entityType: "ExtractionRun",
            entityId: run.id,
            metadata: { documentId: run.documentId, errorCode },
          },
        });
      }

      return failedRun;
    }, TRANSACTION_OPTIONS);
  }

  /** Marks PROCESSING runs older than STALE_RUN_AFTER_MS on a shipment's documents as FAILED. */
  async expireStaleRuns(shipmentId: string, now = new Date()) {
    const stale = await this.prisma.extractionRun.findMany({
      where: {
        status: "PROCESSING",
        startedAt: { lt: new Date(now.getTime() - STALE_RUN_AFTER_MS) },
        document: { shipmentId },
      },
      select: { id: true },
    });
    for (const run of stale) {
      await this.recordExtractionFailure({
        runId: run.id,
        errorCode: "ABANDONED",
        errorMessage: "The extraction did not finish (the page may have been closed). Retry the extraction.",
      });
    }
    return stale.length;
  }

  /**
   * 4. Create (or return) one run per current document for a shipment extraction request,
   * keyed by document version, model and prompt so repeated requests do not duplicate runs.
   */
  async createShipmentExtractionRuns(params: {
    shipmentId: string;
    requestedById: string;
    provider: string;
    model: string;
  }) {
    const { shipmentId, requestedById, provider, model } = params;
    const currentDocuments = await this.prisma.document.findMany({ where: { shipmentId, isCurrent: true } });

    if (currentDocuments.length === 0) {
      throw new ExtractionError("No current documents to extract. Upload documents first.", "DOCUMENT_NOT_FOUND", 400);
    }

    const runs = [];
    for (const doc of currentDocuments) {
      const { run } = await this.createOrGetExtractionRun({
        documentId: doc.id,
        requestedById,
        provider,
        model,
        pageCount: doc.pageCount || 1,
        idempotencyKey: initialExtractionKey({ documentId: doc.id, documentVersion: doc.documentVersion, provider, model }),
      });
      runs.push(run);
    }
    return runs;
  }

  /**
   * 5. Whether every required slot has a completed run (AI or manual fallback) and no
   * document-level blocker. Partial completion is reported, never hidden.
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
    const label = (slot: DocumentType) => slot.replaceAll("_", " ");

    const docMap = new Map(currentDocuments.map((doc) => [doc.selectedDocType as DocumentType, doc]));

    for (const slot of REQUIRED_SLOTS) {
      const doc = docMap.get(slot);
      if (!doc) {
        missingSlots.push(slot);
        blockingReasons.push(`Missing mandatory ${label(slot)} document.`);
        continue;
      }

      const latestRun = doc.extractionRuns[0];
      if (!latestRun) {
        pendingSlots.push(slot);
        blockingReasons.push(`${label(slot)} has not been extracted yet.`);
        continue;
      }
      if (latestRun.status === "FAILED") {
        failedSlots.push(slot);
        blockingReasons.push(`${label(slot)} extraction failed: ${latestRun.errorCode ?? "ERROR"}. Retry or enter the values manually.`);
        continue;
      }
      if (latestRun.status === "PROCESSING" || latestRun.status === "QUEUED") {
        pendingSlots.push(slot);
        blockingReasons.push(`${label(slot)} extraction is currently in progress.`);
        continue;
      }

      completedSlots.push(slot);
      if (doc.typeMismatch) {
        blockingReasons.push(`Document type mismatch on ${label(slot)}: detected ${doc.detectedDocType ?? "UNKNOWN"}.`);
      }
      const unreadable = doc.pages.filter((p) => !p.isReadable && !p.manualEntryRequired).map((p) => p.pageNumber);
      if (unreadable.length > 0) {
        blockingReasons.push(`Unreadable page(s) ${unreadable.join(", ")} on ${label(slot)} need to be marked for manual entry.`);
      }
    }

    return {
      isReadyForReview:
        completedSlots.length === REQUIRED_SLOTS.length &&
        pendingSlots.length === 0 &&
        missingSlots.length === 0 &&
        failedSlots.length === 0 &&
        blockingReasons.length === 0,
      completedSlots,
      pendingSlots,
      missingSlots,
      failedSlots,
      blockingReasons,
    };
  }
}

/**
 * Server-side shipment state after a run ends: EXTRACTING while any other current document's
 * latest run is still PROCESSING, otherwise NEEDS_REVIEW. A completed run bumps the revision.
 * Exported shipments are never modified.
 */
async function settleShipmentAfterRun(
  tx: Tx,
  shipmentId: string,
  finishedRunId: string,
  options: { bumpRevision: boolean },
) {
  const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  if (shipment.status === "EXPORTED") return shipment;

  const stillProcessing = await tx.extractionRun.count({
    where: {
      id: { not: finishedRunId },
      status: "PROCESSING",
      document: { shipmentId, isCurrent: true },
    },
  });

  const nextStatus = stillProcessing > 0 ? "EXTRACTING" : shipment.status === "EXTRACTING" || options.bumpRevision ? "NEEDS_REVIEW" : shipment.status;

  if (!options.bumpRevision && nextStatus === shipment.status) return shipment;

  return tx.shipment.update({
    where: { id: shipmentId },
    data: {
      status: nextStatus,
      ...(options.bumpRevision ? { currentRevision: { increment: 1 } } : {}),
    },
  });
}
