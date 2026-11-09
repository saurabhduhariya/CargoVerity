import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { confirmFields } from "@/lib/review/field-actions";

/**
 * POST /api/documents/[id]/fields/confirm
 * Confirms several saved field values of one document at once ("Confirm all").
 * Body: { fieldIds: string[], expectedRevision }. Rules live in `@/lib/review/field-actions`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const result = await confirmFields(getPrisma(), {
      documentId: id,
      actor: { id: appUser.id, role: appUser.role },
      body: await request.json(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
