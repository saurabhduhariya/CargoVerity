import { handleDecisionRequest } from "@/lib/manager/decision-route";

/**
 * Week 5 Step 2: Manager decision route.
 * POST { decision: "APPROVE" | "REJECT", comment?, expectedRevision } — Manager only.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDecisionRequest(request, context);
}
