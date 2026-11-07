import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { processManagerDecision } from "@/lib/manager/decision";

/** Body for POST /api/shipments/[id]/decision (and the /approve alias). */
export const decisionPayloadSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().max(1000).optional(),
  expectedRevision: z.number().int().positive(),
});

/** Shared handler: Manager role on the server, explicit decision, exact revision. */
export async function handleDecisionRequest(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireRole("MANAGER");
    const { id } = await context.params;
    const input = decisionPayloadSchema.parse(await request.json());

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
