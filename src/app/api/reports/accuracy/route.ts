import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getAccuracyReport } from "@/lib/reports/accuracy";

/**
 * GET /api/reports/accuracy
 *
 * Week 5 Step 6: accuracy and supplier report over current documents and their latest completed
 * extraction (Executives see their own shipments, Managers all shipments). Groups by field key
 * and supplier with numerator, denominator and sample size on every percentage.
 *
 * The dataset label is decided on the server. There is no client-controllable "benchmark" switch:
 * the stored data is the synthetic demo set until the client's labelled 200-shipment benchmark is
 * loaded and flagged server-side.
 */
export async function GET() {
  try {
    const { appUser } = await requireAppUser();
    const report = await getAccuracyReport(getPrisma(), appUser);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
