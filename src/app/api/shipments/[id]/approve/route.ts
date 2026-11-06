import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { processManagerDecision } from "@/lib/manager/decision";

const approvePayloadSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]).default("APPROVE"),
  comment: z.string().trim().max(1000).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

/**
 * Week 5 Step 2: Manager Approval / Decision Route
 *
 * Enforces Manager role on server (Rule 6).
 * Supports approval and rejection with meaningful comments (Rules 7 & 8).
 * Atomically records approval and audit events (Rules 9 & 10).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireRole("MANAGER");
    const { id } = await context.params;

    let body = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional for standard approvals without exceptions
      body = {};
    }

    const input = approvePayloadSchema.parse(body);

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
