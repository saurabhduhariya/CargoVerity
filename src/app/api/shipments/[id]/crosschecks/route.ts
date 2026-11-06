import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { runCrossChecks, selectLatestCrossCheckDocuments } from "@/lib/crosschecks";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();
    const shipment = await prisma.shipment.findFirst({
      where: { id, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
      include: {
        documents: {
          where: { isCurrent: true },
          orderBy: { createdAt: "desc" },
          include: {
            extractionRuns: {
              where: { status: "COMPLETED" },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { fields: true, lineItems: true },
            },
          },
        },
      },
    });

    if (!shipment) throw new Error("Shipment not found or inaccessible.");

    const documents = selectLatestCrossCheckDocuments(shipment.documents.flatMap((document) => {
      const run = document.extractionRuns[0];
      if (!run) return [];
      return [{
        docType: document.docType,
        fields: Object.fromEntries(
          run.fields.map((field) => [
            field.fieldKey,
            {
              id: field.id,
              value: field.currentValue,
              unit: field.unit,
              sourceQuote: field.sourceQuote,
            },
          ]),
        ),
        lineItems: run.lineItems.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          description: item.description,
          quantity: item.quantity?.toString() ?? null,
          quantityUnit: item.quantityUnit,
          unitPrice: item.unitPrice?.toString() ?? null,
          lineTotal: item.lineTotal?.toString() ?? null,
          currency: item.currency,
          sourceQuote: item.sourceQuote,
        })),
      }];
    }));
    const results = runCrossChecks(documents);

    await prisma.crossCheckResult.createMany({
      data: results.map((check) => ({
        shipmentId: shipment.id,
        revision: shipment.currentRevision,
        ruleKey: check.ruleKey,
        status: check.status,
        details: check.details as Prisma.InputJsonValue,
      })),
    });

    return NextResponse.json({ revision: shipment.currentRevision, results });
  } catch (error) {
    return apiError(error);
  }
}
