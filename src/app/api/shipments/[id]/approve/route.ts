import { handleDecisionRequest } from "@/lib/manager/decision-route";

/**
 * Backwards-compatible alias of POST /api/shipments/[id]/decision.
 * Same body and rules: an explicit `decision` and `expectedRevision` are required, so a bare
 * POST can no longer approve a shipment.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDecisionRequest(request, context);
}
