import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { resolveCheck } from "@/lib/crosschecks/resolution";
import { getPrisma } from "@/lib/db";

/**
 * POST /api/crosschecks/[id]/resolve
 * Body: { type, reason, evidence?, valuesConfirmed: true, expectedRevision }.
 * Types: ACCEPTED_EXCEPTION (needs evidence; manager sign-off clears approval/export),
 * SOURCE_CORRECTED and DOCUMENT_REPLACEMENT (alias DOCUMENT_REPLACED; audit links only).
 * Rules live in `@/lib/crosschecks/resolution`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const result = await resolveCheck(getPrisma(), {
      checkId: id,
      actor: { id: appUser.id, role: appUser.role },
      body: await request.json(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
