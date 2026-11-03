import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireRole("MANAGER");
    const { id } = await context.params;
    const prisma = getPrisma();
    const shipment = await prisma.shipment.findFirst({ where: { id } });
    if (!shipment) throw new Error("Shipment not found.");

    const checks = await prisma.crossCheckResult.findMany({
      where: { shipmentId: id, revision: shipment.currentRevision },
      include: { resolutions: true },
    });
    if (checks.length === 0) throw new Error("Run cross-checks before manager approval.");
    const unresolved = checks.filter((check) =>
      ["MISMATCH", "INCOMPLETE"].includes(check.status) && check.resolutions.length === 0,
    );
    if (unresolved.length > 0) throw new Error("Unresolved cross-checks require review before approval.");

    const approval = await prisma.approval.upsert({
      where: { shipmentId_revision: { shipmentId: id, revision: shipment.currentRevision } },
      update: { approvedById: appUser.id, approvedAt: new Date() },
      create: { shipmentId: id, revision: shipment.currentRevision, approvedById: appUser.id },
    });
    await prisma.shipment.update({ where: { id }, data: { status: "APPROVED" } });
    await prisma.auditEvent.create({ data: { shipmentId: id, actorId: appUser.id, action: "SHIPMENT_APPROVED", entityType: "Shipment", entityId: id } });

    return NextResponse.json({ approval });
  } catch (error) {
    return apiError(error);
  }
}
