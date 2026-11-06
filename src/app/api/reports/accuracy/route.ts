import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getAccuracyReport } from "@/lib/reports/accuracy";

/**
 * Week 5 Step 6: Accuracy and Supplier Reports API
 *
 * GET /api/reports/accuracy
 *
 * Gathers current extracted fields and human reviews from accessible shipments,
 * computes exact evaluated, correct, corrected, manual entry and unreviewed counts,
 * and groups metrics by field key and normalized supplier.
 */
export async function GET(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const prisma = getPrisma();

    const { searchParams } = new URL(request.url);
    const benchmarkMode = searchParams.get("benchmark") === "1";

    const report = await getAccuracyReport(prisma, appUser, {
      isLabelledBenchmark: benchmarkMode,
    });

    return NextResponse.json(report);
  } catch (error) {
    return apiError(error);
  }
}
