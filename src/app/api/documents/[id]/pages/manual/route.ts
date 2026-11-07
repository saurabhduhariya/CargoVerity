import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { markPageForManualEntry } from "@/lib/ai/manual-fallback";

/**
 * Week 3 Step 5: an Executive or Manager marks (or clears) a page for manual entry.
 * Bumps the shipment revision, which invalidates prior approval and cross-checks.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: documentId } = await context.params;
    const { page, shipment } = await markPageForManualEntry(getPrisma(), {
      documentId,
      actor: appUser,
      body: await request.json(),
    });
    return NextResponse.json({ page, revision: shipment.currentRevision, shipmentStatus: shipment.status });
  } catch (error) {
    return apiError(error);
  }
}
