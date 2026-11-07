import "server-only";

import { z } from "zod";

import type { PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import { PROMPT_VERSION } from "@/lib/ai/extraction-prompts";
import { ExtractionService } from "@/lib/ai/extraction.service";
import { logExtractionAttempt } from "@/lib/ai/logger";
import {
  ExtractionPersistenceService,
  initialExtractionKey,
  retryExtractionKey,
} from "@/lib/ai/persistence.service";
import { normalizeProviderError } from "@/lib/ai/response-validator";
import { documentTypes, type AIProvider, type ExtractionAdapterOutput, type PageImage } from "@/lib/ai/types";
import { detectContentMimeType } from "@/lib/documents/validation";
import { getEnv } from "@/lib/env";
import { ExtractionError, ProviderError } from "@/lib/errors";

/**
 * Week 3: server-side extraction workflow shared by the Route Handlers.
 *
 * 1. `startDocumentExtraction` creates (or idempotently returns) the run for the current
 *    document version. The same request twice returns the same run; a completed run is served
 *    from the database without calling the provider.
 * 2. The browser renders the stored PDF with PDF.js and posts bounded page batches to
 *    `runExtractionBatch`, naming the run. The server checks the run belongs to that document
 *    and user scope, validates the images, decides whether the batch is final from the page
 *    count measured at upload, and skips the provider for a batch it already stored.
 */

export type ExtractionActor = { id: string; role: "EXECUTIVE" | "MANAGER" };

/** Extraction changes field values; once submitted/approved/exported the shipment is frozen. */
const EXTRACTION_BLOCKED_STATUSES: readonly ShipmentStatus[] = ["READY_FOR_APPROVAL", "APPROVED", "EXPORTED"];

function scopeFor(actor: ExtractionActor) {
  return actor.role === "MANAGER" ? undefined : { createdById: actor.id };
}

function assertExtractionAllowed(status: ShipmentStatus) {
  if (EXTRACTION_BLOCKED_STATUSES.includes(status)) {
    throw new ExtractionError(
      status === "EXPORTED"
        ? "This shipment has been exported; its documents can no longer be re-extracted."
        : "This shipment is submitted or approved. Reject it or replace the document before re-running extraction.",
      "EXTRACTION_LOCKED",
      409,
    );
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Start                                                                                        */
/* ------------------------------------------------------------------------------------------ */

export async function startDocumentExtraction(
  prisma: PrismaClient,
  params: { documentId: string; actor: ExtractionActor; provider: AIProvider; retry?: boolean },
) {
  const persistence = new ExtractionPersistenceService(prisma);
  const document = await prisma.document.findFirst({
    where: { id: params.documentId, isCurrent: true, shipment: scopeFor(params.actor) },
    include: { shipment: true },
  });
  if (!document) {
    throw new ExtractionError("Document not found or inaccessible.", "DOCUMENT_NOT_FOUND", 404);
  }
  assertExtractionAllowed(document.shipment.status);

  await persistence.expireStaleRuns(document.shipmentId);

  const latestRun = await prisma.extractionRun.findFirst({
    where: { documentId: document.id, documentVersion: document.documentVersion },
    orderBy: { createdAt: "desc" },
  });

  let idempotencyKey: string;
  let retryOfRunId: string | undefined;
  if (params.retry && latestRun) {
    if (latestRun.status === "PROCESSING") {
      // A repeated retry click while the retry is running resumes it instead of starting another.
      return { run: latestRun, isExisting: true, document };
    }
    idempotencyKey = retryExtractionKey(latestRun.id);
    retryOfRunId = latestRun.id;
  } else if (latestRun) {
    // Without an explicit retry the most recent run (in progress, completed, failed or manual)
    // is returned as-is: repeated "Run extraction" clicks never create a new metered run.
    return { run: latestRun, isExisting: true, document };
  } else {
    idempotencyKey = initialExtractionKey({
      documentId: document.id,
      documentVersion: document.documentVersion,
      provider: params.provider.name,
      model: params.provider.model,
    });
  }

  const { run, isExisting } = await persistence.createOrGetExtractionRun({
    documentId: document.id,
    requestedById: params.actor.id,
    provider: params.provider.name,
    model: params.provider.model,
    promptVersion: PROMPT_VERSION,
    pageCount: document.pageCount ?? 1,
    idempotencyKey,
    retryOfRunId,
  });

  if (run.status === "PROCESSING") {
    await prisma.shipment.updateMany({
      where: { id: document.shipmentId, status: { notIn: [...EXTRACTION_BLOCKED_STATUSES] } },
      data: { status: "EXTRACTING" },
    });
  }

  return { run, isExisting, document };
}

/* ------------------------------------------------------------------------------------------ */
/* Batch                                                                                        */
/* ------------------------------------------------------------------------------------------ */

export const extractionBatchSchema = z.object({
  documentId: z.string().uuid(),
  documentType: z.enum(documentTypes),
  runId: z.string().uuid().optional(),
  retry: z.boolean().optional(),
  batchNumber: z.number().int().nonnegative().max(100).default(0),
  // Accepted for compatibility; the server decides finality from the stored page count.
  isFinal: z.boolean().optional(),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().positive(),
        imageBase64: z.string().min(100).max(12_000_000),
        mimeType: z.enum(["image/jpeg", "image/png"]),
      }),
    )
    .min(1)
    .max(3),
});

/** Base64 must decode to a real JPEG/PNG of the declared type within the image size limit. */
export function assertValidPageImages(pages: PageImage[], maxImageBytes = getEnv().MAX_IMAGE_BYTES) {
  for (const page of pages) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(page.imageBase64)) {
      throw new ExtractionError(`Page ${page.pageNumber} is not valid base64 image data.`, "INVALID_IMAGE", 400);
    }
    const bytes = Buffer.from(page.imageBase64, "base64");
    if (bytes.byteLength > maxImageBytes) {
      throw new ExtractionError(`Page ${page.pageNumber} image is larger than the allowed size.`, "INVALID_IMAGE", 413);
    }
    if (detectContentMimeType(new Uint8Array(bytes.subarray(0, 16))) !== page.mimeType) {
      throw new ExtractionError(`Page ${page.pageNumber} is not a ${page.mimeType} image.`, "INVALID_IMAGE", 400);
    }
  }
}

/** Pages must be unique, ascending, within the stored page count and match the batch slot. */
export function assertValidBatchPages(pageNumbers: number[], batchNumber: number, pageCount: number, batchSize: number) {
  const expectedStart = batchNumber * batchSize + 1;
  const expected = Array.from(
    { length: Math.max(0, Math.min(batchSize, pageCount - expectedStart + 1)) },
    (_, i) => expectedStart + i,
  );
  if (expected.length === 0 || pageNumbers.join(",") !== expected.join(",")) {
    throw new ExtractionError(
      `Batch ${batchNumber} must contain pages ${expected.length ? expected.join(", ") : "(none)"} of ${pageCount}.`,
      "INVALID_PAGES",
      400,
    );
  }
  return expected[expected.length - 1] === pageCount;
}

export async function runExtractionBatch(
  prisma: PrismaClient,
  params: {
    actor: ExtractionActor;
    body: unknown;
    provider: AIProvider;
    extractionService?: ExtractionService;
  },
) {
  const input = extractionBatchSchema.parse(params.body);
  const persistence = new ExtractionPersistenceService(prisma);

  const document = await prisma.document.findFirst({
    where: {
      id: input.documentId,
      selectedDocType: input.documentType,
      isCurrent: true,
      shipment: scopeFor(params.actor),
    },
    include: { shipment: true },
  });
  if (!document) {
    throw new ExtractionError("Document not found or inaccessible.", "DOCUMENT_NOT_FOUND", 404);
  }

  // Resolve the run: it must belong to exactly this document version.
  let run;
  if (input.runId) {
    run = await prisma.extractionRun.findFirst({
      where: { id: input.runId, documentId: document.id, documentVersion: document.documentVersion },
    });
    if (!run) throw new ExtractionError("Extraction run not found for this document.", "RUN_NOT_FOUND", 404);
  } else {
    run = (await startDocumentExtraction(prisma, {
      documentId: document.id,
      actor: params.actor,
      provider: params.provider,
      retry: input.retry,
    })).run;
  }

  if (run.status === "COMPLETED") {
    const cached = await persistence.getExtractionRunResult(run.id);
    logExtractionAttempt({
      runId: run.id,
      shipmentId: document.shipmentId,
      modelId: run.model,
      promptVersion: run.promptVersion,
      latencyMs: 0,
    });
    return { runId: run.id, result: cached, isFinal: true, cached: true };
  }
  if (run.status !== "PROCESSING") {
    throw new ExtractionError("This extraction run has ended. Start a retry to extract again.", "RUN_CLOSED", 409);
  }
  assertExtractionAllowed(document.shipment.status);

  const batchSize = Math.min(getEnv().MAX_AI_IMAGES_PER_REQUEST, 3);
  const pageCount = document.pageCount ?? input.pages.length;
  const pageNumbers = input.pages.map((page) => page.pageNumber);
  const isFinal = assertValidBatchPages(pageNumbers, input.batchNumber, pageCount, batchSize);
  assertValidPageImages(input.pages);

  // Batch already stored (client retry after a network drop): no second provider call.
  if (await persistence.getCompletedBatch(run.id, input.batchNumber)) {
    return { runId: run.id, result: null, isFinal, cached: true };
  }

  const startTime = Date.now();
  let result: ExtractionAdapterOutput;
  try {
    result = await (params.extractionService ?? new ExtractionService(params.provider)).extract({
      documentType: input.documentType,
      pages: input.pages,
      idempotencyKey: `${run.id}:batch:${input.batchNumber}`,
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorCode = error instanceof ProviderError ? error.code : "EXTRACTION_FAILED";
    await persistence
      .recordExtractionFailure({ runId: run.id, errorCode, errorMessage: normalizeProviderError(error), latencyMs })
      .catch(() => undefined);
    logExtractionAttempt({
      runId: run.id,
      shipmentId: document.shipmentId,
      modelId: run.model,
      promptVersion: run.promptVersion,
      latencyMs,
      errorCode,
    });
    throw error instanceof ProviderError
      ? error
      : new ProviderError("Extraction failed. Retry, or enter the values manually.", "REQUEST_FAILED");
  }
  const latencyMs = Date.now() - startTime;

  await persistence.saveExtractionResult({
    runId: run.id,
    result,
    batchNumber: input.batchNumber,
    pageNumbers,
    isFinal,
    latencyMs,
  });

  logExtractionAttempt({
    runId: run.id,
    shipmentId: document.shipmentId,
    modelId: run.model,
    promptVersion: run.promptVersion,
    latencyMs,
  });

  return { runId: run.id, result, isFinal, cached: false };
}
