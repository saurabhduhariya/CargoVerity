import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageAppUser } from "@/lib/auth-page";
import { getPrisma } from "@/lib/db";
import { ShipmentDocumentSlots } from "@/features/documents/shipment-document-slots";

export const instant = false;

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { appUser } = await requirePageAppUser(`/shipments/${encodeURIComponent(id)}`);
  const prisma = getPrisma();
  const shipment = await prisma.shipment.findFirst({
    where: { id, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
    include: {
      supplier: true,
      documents: {
        where: { isCurrent: true },
        orderBy: { createdAt: "desc" },
        include: {
          extractionRuns: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              provider: true,
              model: true,
              errorCode: true,
              errorMessage: true,
              completedAt: true,
            },
          },
          fields: {
            select: {
              id: true,
              reviewStatus: true,
            },
          },
          pages: {
            select: {
              id: true,
              pageNumber: true,
              isReadable: true,
              manualEntryRequired: true,
            },
          },
        },
      },
    },
  });

  if (!shipment) notFound();

  const initialDocuments = shipment.documents.map((d) => {
    const latestRun = d.extractionRuns[0] ?? null;
    const reviewRequiredCount = d.fields.filter(
      (f) => f.reviewStatus === "REQUIRES_REVIEW",
    ).length;
    const unreadablePageCount = d.pages.filter(
      (p) => !p.isReadable && !p.manualEntryRequired,
    ).length;
    const manualPagesCount = d.pages.filter((p) => p.manualEntryRequired).length;

    return {
      id: d.id,
      docType: d.docType,
      documentVersion: d.documentVersion,
      originalFileName: d.originalFileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      pageCount: d.pageCount,
      extractionStatus: d.extractionStatus,
      createdAt: d.createdAt.toISOString(),
      isCurrent: d.isCurrent,
      typeMismatch: d.typeMismatch,
      detectedDocType: d.detectedDocType,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            provider: latestRun.provider,
            model: latestRun.model,
            errorCode: latestRun.errorCode,
            errorMessage: latestRun.errorMessage,
            completedAt: latestRun.completedAt ? latestRun.completedAt.toISOString() : null,
          }
        : null,
      extractedFieldCount: d.fields.length,
      reviewRequiredCount,
      unreadablePageCount,
      manualPagesCount,
    };
  });

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm font-medium">
          <Link className="text-blue-700 hover:text-blue-800" href="/dashboard">
            ← Back to dashboard
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">
              Role: <strong className="text-slate-700">{appUser.role}</strong>
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-lg">{shipment.reference}</span>
              <div className="flex items-center gap-2">
                <Link
                  href={`/review/${shipment.id}`}
                  className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Review Workspace →
                </Link>
                <Badge>{shipment.status.replaceAll("_", " ")}</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-slate-500">Supplier</p>
              <p className="font-medium text-slate-900">{shipment.supplier?.name ?? "Not assigned"}</p>
            </div>
            <div>
              <p className="text-slate-500">Importer</p>
              <p className="font-medium text-slate-900">{shipment.importerName ?? "Not supplied"}</p>
            </div>
            <div>
              <p className="text-slate-500">Exporter</p>
              <p className="font-medium text-slate-900">{shipment.exporterName ?? "Not supplied"}</p>
            </div>
            <div>
              <p className="text-slate-500">Current revision</p>
              <p className="font-medium text-slate-900">rev {shipment.currentRevision}</p>
            </div>
          </CardContent>
        </Card>

        {/* Week 2 & 3: Three Document Slots, Synthetic Demo Loader, and Extraction Flow */}
        <ShipmentDocumentSlots
          shipmentId={shipment.id}
          shipmentReference={shipment.reference}
          initialRevision={shipment.currentRevision}
          initialShipmentStatus={shipment.status}
          initialDocuments={initialDocuments}
        />
      </div>
    </main>
  );
}

