import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { confirmOrReviewField } from "@/lib/review/field-actions";

/**
 * POST /api/fields/[id]/review
 * Confirm, correct or manually enter a field value (Week 4 Step 7).
 * Body: { status: "CONFIRMED" | "CORRECTED" | "MANUAL_ENTRY", value?, reason?, expectedRevision }.
 * All rules (pre-approval states, required expectedRevision with 409 on stale, atomic
 * transaction, recompute after commit) live in `@/lib/review/field-actions`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const result = await confirmOrReviewField(getPrisma(), {
      fieldId: id,
      actor: { id: appUser.id, role: appUser.role },
      body: await request.json(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
