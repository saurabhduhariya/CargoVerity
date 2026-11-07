import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createCrossCheckRun } from "@/lib/crosschecks/service";
import { saveManualField } from "@/lib/ai/manual-fallback";

/**
 * Week 3 Step 5 & Week 4 Step 7: explicitly save a manually entered field value where manual
 * entry is unlocked (see `saveManualField`), then recompute cross-checks for the new revision.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: documentId } = await context.params;
    const prisma = getPrisma();

    const { field, shipment } = await saveManualField(prisma, {
      documentId,
      actor: appUser,
      body: await request.json(),
    });

    let crossCheckResults = null;
    try {
      const run = await createCrossCheckRun({
        shipmentId: shipment.id,
        requestedById: appUser.id,
        triggeredBy: "FIELD_MANUAL_ENTRY",
        prismaClient: prisma,
      });
      crossCheckResults = run.results;
    } catch {
      // A failed recompute leaves the check run stale, which blocks submission (fails safe).
    }

    return NextResponse.json({
      field,
      revision: shipment.currentRevision,
      shipmentStatus: shipment.status,
      crossChecks: crossCheckResults,
    });
  } catch (error) {
    return apiError(error);
  }
}
