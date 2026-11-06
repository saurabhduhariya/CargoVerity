import { NextResponse } from "next/server";

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
 *
 * Requirements:
 * - Executive role required for submission (Rule 9).
 * - Server-side submission guard enforced (Rule 1).
 * - Exact blocking reasons returned for UI (Rule 11).
 * - Atomically moves shipment to READY_FOR_APPROVAL and logs audit event (Rule 10).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;

    const evaluation = await evaluateShipmentSubmission(id, appUser.role);
    return NextResponse.json(evaluation);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;

    const result = await submitShipmentForApproval(id, appUser);

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

