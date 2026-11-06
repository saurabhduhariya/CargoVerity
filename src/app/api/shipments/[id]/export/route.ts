import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { canExport, selectLatestCrossChecks } from "@/lib/export/guard";
import { buildDemoV1Export } from "@/lib/export/csv";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();
    const shipment = await prisma.shipment.findFirst({
      where: { id, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
      include: {
        supplier: true,
        documents: {
          where: { isCurrent: true },
          include: {
            extractionRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { fields: true, lineItems: true } },
          },
        },
      },
    });
    if (!shipment) throw new Error("Shipment not found or inaccessible.");

    const approval = await prisma.approval.findUnique({
      where: { shipmentId_revision: { shipmentId: id, revision: shipment.currentRevision } },
      include: { approvedBy: { select: { email: true, fullName: true } } },
    });
    const checks = await prisma.crossCheckResult.findMany({ where: { shipmentId: id, revision: shipment.currentRevision } });
    const latestChecks = selectLatestCrossChecks(checks);
    const guard = canExport({
      hasManagerApproval: Boolean(approval),
      approvedRevision: approval?.revision ?? null,
      currentRevision: shipment.currentRevision,
      unresolvedStatuses: latestChecks.filter((check) => ["MISMATCH", "INCOMPLETE"].includes(check.status)).map((check) => check.status as "MISMATCH" | "INCOMPLETE"),
      profileId: getEnv().EXPORT_PROFILE_ID,
    });
    if (!guard.allowed) throw new Error(`Export blocked: ${guard.reasons.join(", ")}.`);

    const exportData = buildDemoV1Export(
      shipment.reference,
      shipment.documents.flatMap((document) => {
        const run = document.extractionRuns[0];
        return run ? [{ docType: document.docType, fields: run.fields, lineItems: run.lineItems }] : [];
      }),
      {
        supplierName: shipment.supplier?.name ?? null,
        importerName: shipment.importerName ?? null,
        approvedBy: approval?.approvedBy?.email ?? approval?.approvedBy?.fullName ?? null,
        approvedAt: approval?.approvedAt ?? null,
        approvedRevision: approval?.revision ?? null,
      },
    );

    if (new URL(request.url).searchParams.get("preview") === "1") {
      return NextResponse.json({
        fileName: `${shipment.reference}-${getEnv().EXPORT_PROFILE_ID}.csv`,
        headers: exportData.headers,
        rows: exportData.rows,
        profileId: exportData.profileId,
        profileVersion: exportData.profileVersion,
        assumptionLabel: exportData.assumptionLabel,
      });
    }

    await prisma.exportEvent.create({ data: { shipmentId: id, exportedById: appUser.id, profileId: getEnv().EXPORT_PROFILE_ID, revision: shipment.currentRevision } });
    await prisma.shipment.update({ where: { id }, data: { status: "EXPORTED" } });

    return new NextResponse(exportData.csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${shipment.reference}-${getEnv().EXPORT_PROFILE_ID}.csv"` },
    });
  } catch (error) {
    return apiError(error);
  }
}
