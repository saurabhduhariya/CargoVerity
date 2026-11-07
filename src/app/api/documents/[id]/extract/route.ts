import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { startDocumentExtraction } from "@/lib/ai/extraction-workflow";

const documentExtractSchema = z
  .object({
    retry: z.boolean().default(false),
    // Accepted for compatibility; the server always retries the latest run of the document.
    retryOfRunId: z.string().uuid().optional(),
  })
  .default({ retry: false });

/**
 * Week 3 Steps 5–6: start (or idempotently return) the extraction run for a current document.
 * `retry: true` creates a new run linked to the latest one instead of overwriting history.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: documentId } = await context.params;

    const text = await request.text();
    let bodyData: unknown = {};
    if (text.trim().length > 0) {
      try {
        bodyData = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Invalid JSON request payload.", code: "INVALID_JSON" }, { status: 400 });
      }
    }
    const input = documentExtractSchema.parse(bodyData);

    const { run, isExisting } = await startDocumentExtraction(getPrisma(), {
      documentId,
      actor: appUser,
      provider: createAIProvider(),
      retry: input.retry,
    });

    return NextResponse.json({
      success: true,
      documentId,
      runId: run.id,
      status: run.status,
      retryOfRunId: run.retryOfRunId,
      provider: run.provider,
      model: run.model,
      existing: isExisting,
    });
  } catch (error) {
    return apiError(error);
  }
}
