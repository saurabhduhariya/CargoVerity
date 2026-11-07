import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { evaluateExport, previewBody, recordExport } from "@/lib/export/export-service";

/**
 * Week 5 Steps 4-5: Guarded CSV export.
 *
 * GET ?preview=1 -> readiness, exact blockers, approved revision/timestamp, profile + assumption
 *                   label, and the first rows of the CSV produced by the same mapping.
 * GET            -> the CSV (text/csv, safe filename). Blocked: 422 with blockers.
 *
 * Gates (src/lib/export/export-service.ts): shipment access, APPROVED (or EXPORTED re-download)
 * status, manager approval for exactly the current revision, current documents with a completed
 * extraction, required export fields valid, a cross-check run for the current revision with no
 * unresolved failures and no exceptions awaiting sign-off, a registered profile. The export record
 * (profile id/version, checksum, file name, row count, actor, revision) is written atomically with
 * a conditional status update.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();
    const actor = { id: appUser.id, role: appUser.role };

    const evaluation = await evaluateExport(prisma, actor, id);

    if (new URL(request.url).searchParams.get("preview") === "1") {
      return NextResponse.json(previewBody(evaluation), {
        status: evaluation.ready ? 200 : 422,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!evaluation.ready || !evaluation.output) {
      return NextResponse.json(
        {
          error: `Export blocked: ${evaluation.blockers.join(", ")}.`,
          code: "EXPORT_BLOCKED",
          blockers: evaluation.blockers,
          blockerDetails: evaluation.blockerDetails,
        },
        { status: 422 },
      );
    }

    const exportEvent = await recordExport(prisma, actor, evaluation);

    return new NextResponse(evaluation.output.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${evaluation.fileName}"`,
        "Cache-Control": "no-store",
        "X-Checksum-Sha256": evaluation.output.checksumSha256,
        "X-Export-Event-Id": exportEvent.id,
        "X-Export-Profile": `${evaluation.profile.id}@${evaluation.profile.version}`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
