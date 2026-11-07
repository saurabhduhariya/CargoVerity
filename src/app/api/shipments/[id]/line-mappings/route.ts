import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { createLineMapping, listActiveLineMappings } from "@/lib/crosschecks/line-mapping";
import { getPrisma } from "@/lib/db";
import { ReviewError } from "@/lib/errors";

/**
 * GET  /api/shipments/[id]/line-mappings  -> active Executive line mappings
 * POST /api/shipments/[id]/line-mappings  -> map an Invoice line to a Packing List line
 *   Body: { invoiceLineId, packingListLineId, reason, expectedRevision, replace? }
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();
    const shipment = await prisma.shipment.findFirst({
      where: { id, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
      select: { id: true },
    });
    if (!shipment) throw new ReviewError("Shipment not found or inaccessible.", "SHIPMENT_NOT_FOUND", 404);
    return NextResponse.json({ mappings: await listActiveLineMappings(prisma, shipment.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const result = await createLineMapping(getPrisma(), {
      shipmentId: id,
      actor: { id: appUser.id, role: appUser.role },
      body: await request.json(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
