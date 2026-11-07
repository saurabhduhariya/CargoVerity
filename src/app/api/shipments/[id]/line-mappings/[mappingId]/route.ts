import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { removeLineMapping } from "@/lib/crosschecks/line-mapping";
import { getPrisma } from "@/lib/db";

/**
 * DELETE /api/shipments/[id]/line-mappings/[mappingId]
 * Supersedes (never deletes) an active mapping. Body: { expectedRevision, reason? }
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; mappingId: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id, mappingId } = await context.params;
    const text = await request.text();
    const result = await removeLineMapping(getPrisma(), {
      shipmentId: id,
      mappingId,
      actor: { id: appUser.id, role: appUser.role },
      body: text ? JSON.parse(text) : {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
