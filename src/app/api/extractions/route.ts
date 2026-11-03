import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { ProviderError } from "@/lib/errors";
import { ExtractionService } from "@/lib/ai/extraction.service";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { documentTypes } from "@/lib/ai/types";

const extractionRequestSchema = z.object({
  documentId: z.string().uuid(),
  documentType: z.enum(documentTypes),
  runId: z.string().uuid().optional(),
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

  try {
    const { appUser } = await requireAppUser();
    const input = extractionRequestSchema.parse(await request.json());
    const prisma = getPrisma();
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
    const run = input.runId
      ? await prisma.extractionRun.findFirst({
          where: { id: input.runId, documentId: document.id },
        })
      : await prisma.extractionRun.create({
          data: {
            documentId: document.id,
            provider: provider.name,
            model: provider.model,
            promptVersion: "customs-v1",
            status: "PROCESSING",
            pageCount: input.pages.length,
            startedAt: new Date(),
          },
        });

    if (!run) throw new Error("Extraction run not found.");
    extractionRunId = run.id;
    await prisma.document.update({
      where: { id: document.id },
      data: { extractionStatus: "PROCESSING", pageCount: input.pages.length },
    });

    const result = await new ExtractionService(provider).extract({
      documentType: input.documentType,
      pages: input.pages,
    });

    await prisma.$transaction(async (transaction) => {
      for (const field of result.fields) {
        const existing = await transaction.extractedField.findUnique({
          where: { extractionRunId_fieldKey: { extractionRunId: run.id, fieldKey: field.fieldKey } },
        });
        const shouldReplace = !existing ||
          existing.currentValue === null ||
          (field.modelConfidence ?? 0) > Number(existing.modelConfidence ?? 0);
        if (!existing) {
          await transaction.extractedField.create({ data: { documentId: document.id, extractionRunId: run.id, fieldKey: field.fieldKey, modelValue: field.value, currentValue: field.value, unit: field.unit, modelConfidence: field.modelConfidence, sourceQuote: field.sourceQuote, pageNumber: field.pageNumber } });
        } else if (shouldReplace) {
          await transaction.extractedField.update({ where: { id: existing.id }, data: { modelValue: field.value, currentValue: field.value, unit: field.unit, modelConfidence: field.modelConfidence, sourceQuote: field.sourceQuote, pageNumber: field.pageNumber } });
        }
      }
      await transaction.lineItem.createMany({
        data: result.lineItems.map((item) => ({
          documentId: document.id,
          extractionRunId: run.id,
          batchNumber: input.batchNumber,
          lineNumber: item.lineNumber,
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
        })),
      });
      if (input.isFinal) {
        await transaction.extractionRun.update({
          where: { id: run.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        await transaction.document.update({
          where: { id: document.id },
          data: { extractionStatus: "REVIEW_REQUIRED" },
        });
      } else {
        await transaction.extractionRun.update({
          where: { id: run.id },
          data: { pageCount: { increment: input.pages.length } },
        });
      }
    });

    return NextResponse.json({ runId: run.id, result, isFinal: input.isFinal });
  } catch (error) {
    if (extractionRunId) {
      try {
        await getPrisma().$transaction([
          getPrisma().extractionRun.update({
            where: { id: extractionRunId },
            data: {
              status: "FAILED",
              errorCode: error instanceof ProviderError ? error.code : "EXTRACTION_FAILED",
              errorMessage: error instanceof Error ? error.message : "Extraction failed.",
              completedAt: new Date(),
            },
          }),
        ]);
      } catch {
        // Preserve the original extraction error; database failure is logged by platform tooling.
      }
    }
    return apiError(error);
  }
}
