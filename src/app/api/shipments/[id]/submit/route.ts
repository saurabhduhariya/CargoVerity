import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import {
  evaluateShipmentSubmission,
  submitShipmentForApproval,
} from "@/lib/submission/guard";

/**
 * Week 5 Step 1: Submission Gates API Route
 *
 * GET: Evaluates submission readiness and returns exact blocking reasons.
 * POST: Submits the shipment for manager approval (moves to READY_FOR_APPROVAL).
 *   Optional body: { expectedRevision } — 409 when the shipment changed since it was loaded.
 *
 * - Executive role required for submission; Executives can only see/submit their own shipments.
 * - The server guard is re-evaluated on the locked shipment row before the status changes.
 * - Exact blocking reasons (codes + messages) are returned for the UI with HTTP 422.
 */
const submitSchema = z.object({ expectedRevision: z.number().int().positive().optional() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;

    const evaluation = await evaluateShipmentSubmission(id, appUser.role, { actorId: appUser.id });
    return NextResponse.json(evaluation);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const text = await request.text();
    const input = submitSchema.parse(text.trim() ? JSON.parse(text) : {});

    const result = await submitShipmentForApproval(id, appUser, { expectedRevision: input.expectedRevision });

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Shipment submission blocked by validation gates.",
          ...result.guardResult,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      shipment: result.shipment,
      guard: result.guardResult,
    });
  } catch (error) {
    return apiError(error);
  }
}
