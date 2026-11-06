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

    const provider = createAIProvider();

    // 1. Create or retrieve extraction run
    let runId = input.runId;
    if (!runId) {
      const { run } = await persistenceService.createOrGetExtractionRun({
        documentId: document.id,
        requestedById: appUser.id,
        provider: provider.name,
        model: provider.model,
        promptVersion: PROMPT_VERSION,
        pageCount: input.pages.length,
        idempotencyKey: input.idempotencyKey,
        retryOfRunId: input.retryOfRunId,
      });
      runId = run.id;
    }
    extractionRunId = runId;

    // 2. Perform AI extraction
    const startTime = Date.now();
    const result = await new ExtractionService(provider).extract({
      documentType: input.documentType,
      pages: input.pages,
    });
    const latencyMs = Date.now() - startTime;

    // 3. Atomically persist results
    await persistenceService.saveExtractionResult({
      runId,
      result,
      batchNumber: input.batchNumber,
      isFinal: input.isFinal,
      latencyMs,
    });

    return NextResponse.json({ runId, result, isFinal: input.isFinal });
  } catch (error) {
    if (extractionRunId) {
      try {
        await persistenceService.recordExtractionFailure({
          runId: extractionRunId,
          errorCode: error instanceof ProviderError ? error.code : "EXTRACTION_FAILED",
          errorMessage: error instanceof Error ? error.message : "Extraction failed.",
        });
      } catch {
        // Preserve original extraction error
      }
    }
    return apiError(error);
  }
}
