import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { runExtractionBatch } from "@/lib/ai/extraction-workflow";

/**
 * Week 3 Step 3: extract one bounded batch (1–3 rendered pages) of a current document into a
 * run that belongs to that document. See `runExtractionBatch` for the idempotency and
 * ownership rules. Errors return fixed messages and safe codes only.
 */
export async function POST(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const result = await runExtractionBatch(getPrisma(), {
      actor: appUser,
      body: await request.json(),
      provider: createAIProvider(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
