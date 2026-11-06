import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { processManagerDecision } from "@/lib/manager/decision";

const decisionPayloadSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().max(1000).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

/**
 * Week 5 Step 2: Manager Decision Route
 *
 * Dedicated endpoint for Manager decision (APPROVE / REJECT).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireRole("MANAGER");
    const { id } = await context.params;
    const body = await request.json();
    const input = decisionPayloadSchema.parse(body);

    const result = await processManagerDecision({
      shipmentId: id,
      managerUser: appUser,
      decision: input.decision,
      comment: input.comment,
      expectedRevision: input.expectedRevision,
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

