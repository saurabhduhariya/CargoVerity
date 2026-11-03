import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { canExport } from "@/lib/export/guard";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();
    const shipment = await prisma.shipment.findFirst({
      where: { id, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
      include: {
        documents: {
          include: {
            extractionRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { fields: true, lineItems: true } },
          },
        },
      },
    });
    if (!shipment) throw new Error("Shipment not found or inaccessible.");

    const approval = await prisma.approval.findUnique({ where: { shipmentId_revision: { shipmentId: id, revision: shipment.currentRevision } } });
    const checks = await prisma.crossCheckResult.findMany({ where: { shipmentId: id, revision: shipment.currentRevision } });
    const guard = canExport({
      hasManagerApproval: Boolean(approval),
      approvedRevision: approval?.revision ?? null,
      currentRevision: shipment.currentRevision,
      unresolvedStatuses: checks.filter((check) => ["MISMATCH", "INCOMPLETE"].includes(check.status)).map((check) => check.status as "MISMATCH" | "INCOMPLETE"),
      profileId: getEnv().EXPORT_PROFILE_ID,
    });
    if (!guard.allowed) throw new Error(`Export blocked: ${guard.reasons.join(", ")}.`);

    const rows: Array<Array<unknown>> = [["shipment_reference", "document_type", "field_key", "value", "unit", "source_quote", "page_number"]];
    for (const document of shipment.documents) {
      const run = document.extractionRuns[0];
      if (!run) continue;
      for (const field of run.fields) rows.push([shipment.reference, document.type, field.fieldKey, field.currentValue, field.unit, field.sourceQuote, field.pageNumber]);
      for (const item of run.lineItems) rows.push([shipment.reference, document.type, `line_item_${item.lineNumber}`, item.description, item.quantityUnit, item.sourceQuote, item.pageNumber]);
    }
    await prisma.exportEvent.create({ data: { shipmentId: id, exportedById: appUser.id, profileId: getEnv().EXPORT_PROFILE_ID, revision: shipment.currentRevision } });
    await prisma.shipment.update({ where: { id }, data: { status: "EXPORTED" } });

    return new NextResponse(rows.map((row) => row.map(csvCell).join(",")).join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${shipment.reference}-${getEnv().EXPORT_PROFILE_ID}.csv"` },
    });
  } catch (error) {
    return apiError(error);
  }
}
