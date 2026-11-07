import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { correctField } from "@/lib/review/field-actions";

/**
 * POST /api/fields/[id]/correction
 * Correct a field value (Week 4 Step 7). Body: { value, reason, expectedRevision }.
 * Shares the transactional rules of `@/lib/review/field-actions`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const result = await correctField(getPrisma(), {
      fieldId: id,
      actor: { id: appUser.id, role: appUser.role },
      body: await request.json(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
