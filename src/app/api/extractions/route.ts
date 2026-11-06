import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { ProviderError } from "@/lib/errors";
import { ExtractionService } from "@/lib/ai/extraction.service";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { documentTypes } from "@/lib/ai/types";
import { PROMPT_VERSION } from "@/lib/ai/extraction-prompts";
import { ExtractionPersistenceService } from "@/lib/ai/persistence.service";
import { logExtractionAttempt } from "@/lib/ai/logger";

const extractionRequestSchema = z.object({
  documentId: z.string().uuid(),
  documentType: z.enum(documentTypes),
  runId: z.string().uuid().optional(),
  idempotencyKey: z.string().optional(),
  retryOfRunId: z.string().uuid().optional(),
  batchNumber: z.number().int().nonnegative().default(0),
  isFinal: z.boolean().default(true),
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

export async function POST(request: Request) {
  let extractionRunId: string | undefined;
  let currentShipmentId: string | undefined;
  let currentModelId: string | undefined;

  const prisma = getPrisma();
  const persistenceService = new ExtractionPersistenceService(prisma);

  try {
    const { appUser } = await requireAppUser();
    const input = extractionRequestSchema.parse(await request.json());

    const document = await prisma.document.findFirst({
      where: {
        id: input.documentId,
        selectedDocType: input.documentType,
        isCurrent: true,
        shipment:
          appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
    });

    if (!document) throw new Error("Document not found or inaccessible.");
    currentShipmentId = document.shipmentId;

    const provider = createAIProvider();
    currentModelId = provider.model;

    // 1. Create or retrieve extraction run
    let runId = input.runId;
    let isExisting = false;
    let existingRun: {
      id: string;
      status: string;
      model: string;
      promptVersion: string;
      latencyMs: number | null;
    } | null = null;

    if (!runId) {
      const res = await persistenceService.createOrGetExtractionRun({
        documentId: document.id,
        requestedById: appUser.id,
        provider: provider.name,
        model: provider.model,
        promptVersion: PROMPT_VERSION,
        pageCount: input.pages.length,
        idempotencyKey: input.idempotencyKey,
        retryOfRunId: input.retryOfRunId,
      });
      runId = res.run.id;
      isExisting = Boolean(res.isExisting);
      existingRun = res.run;
    }
    extractionRunId = runId;

    // 2. Idempotency check: if this run has already completed, return existing results without re-calling provider
    if (isExisting && existingRun?.status === "COMPLETED") {
      const cachedResult = await persistenceService.getExtractionRunResult(runId);
      if (cachedResult) {
        logExtractionAttempt({
          runId,
          shipmentId: document.shipmentId,
          modelId: existingRun.model,
          promptVersion: existingRun.promptVersion,
          latencyMs: existingRun.latencyMs ?? 0,
        });
        return NextResponse.json({ runId, result: cachedResult, isFinal: true, cached: true });
      }
    }

    // 3. Perform AI extraction
    const startTime = Date.now();
    const result = await new ExtractionService(provider).extract({
      documentType: input.documentType,
      pages: input.pages,
    });
    const latencyMs = Date.now() - startTime;

    // 4. Atomically persist results
    await persistenceService.saveExtractionResult({
      runId,
      result,
      batchNumber: input.batchNumber,
      isFinal: input.isFinal,
      latencyMs,
    });

    // 5. Structured safe logging: run ID, shipment ID, model ID, prompt version, latency
    logExtractionAttempt({
      runId,
      shipmentId: document.shipmentId,
      modelId: provider.model,
      promptVersion: PROMPT_VERSION,
      latencyMs,
    });

    return NextResponse.json({ runId, result, isFinal: input.isFinal });
  } catch (error) {
    const errorCode = error instanceof ProviderError ? error.code : "EXTRACTION_FAILED";
    const errorMessage = error instanceof Error ? error.message : "Extraction failed.";

    if (extractionRunId) {
      try {
        await persistenceService.recordExtractionFailure({
          runId: extractionRunId,
          errorCode,
          errorMessage,
        });
      } catch {
        // Preserve original extraction error
      }

      if (currentShipmentId && currentModelId) {
        logExtractionAttempt({
          runId: extractionRunId,
          shipmentId: currentShipmentId,
          modelId: currentModelId,
          promptVersion: PROMPT_VERSION,
          latencyMs: 0,
          errorCode,
        });
      }
    }
    return apiError(error);
  }
}
