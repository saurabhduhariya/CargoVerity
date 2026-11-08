import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Typography } from "@/components/ui/typography";
import { requirePageAppUser } from "@/lib/auth-page";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ShipmentDocumentSlots } from "@/features/documents/shipment-document-slots";

export const instant = false;

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { appUser } = await requirePageAppUser(`/shipments/${encodeURIComponent(id)}`);
  const prisma = getPrisma();
  const env = getEnv();
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

  // Field counts come from each document's latest COMPLETED run, not from every run in history.
  const completedRuns = await prisma.extractionRun.findMany({
    where: { documentId: { in: shipment.documents.map((d) => d.id) }, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { documentId: true, fields: { select: { reviewStatus: true, reviewReason: true } } },
  });
  const fieldsByDocument = new Map<string, Array<{ reviewStatus: string; reviewReason: string | null }>>();
  for (const run of completedRuns) {
    if (!fieldsByDocument.has(run.documentId)) fieldsByDocument.set(run.documentId, run.fields);
  }

  const initialDocuments = shipment.documents.map((d) => {
    const latestRun = d.extractionRuns[0] ?? null;
    const fields = fieldsByDocument.get(d.id) ?? [];
    const reviewRequiredCount = fields.filter(
      (f) => f.reviewStatus === "REQUIRES_REVIEW",
    ).length;
    const lowConfidenceCount = fields.filter((f) => f.reviewReason === "LOW_MODEL_CONFIDENCE").length;
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
      extractedFieldCount: fields.filter((f) => f.reviewStatus !== "NOT_PRESENT").length,
      reviewRequiredCount,
      lowConfidenceCount,
      unreadablePageCount,
      manualPagesCount,
    };
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="shipments" email={appUser.email} role={appUser.role} />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 outline-none sm:px-6 sm:py-6 lg:px-8">
        <section aria-labelledby="shipment-title" className="space-y-4">
          <Link className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-control px-1 text-sm text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/dashboard"><ArrowLeft aria-hidden="true" className="size-4" />Shipments</Link>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Typography id="shipment-title" variant="page-title" className="break-words font-mono text-[22px] [overflow-wrap:anywhere]">{shipment.reference}</Typography>
              <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={shipment.status} /><span className="font-mono text-xs text-muted-foreground">rev {shipment.currentRevision}</span></div>
            </div>
            <Link href={`/review/${shipment.id}`} className="inline-flex min-h-[var(--control-height)] items-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Open review<ArrowRight aria-hidden="true" className="size-4" /></Link>
          </div>
          <dl className="grid gap-x-8 gap-y-2 border-y border-border py-3 text-sm sm:grid-cols-3">
            {([["Supplier", shipment.supplier?.name ?? "Not assigned"], ["Importer", shipment.importerName ?? "Not supplied"], ["Exporter", shipment.exporterName ?? "Not supplied"]] as const).map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2 sm:block"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium sm:mt-0.5">{value}</dd></div>)}
          </dl>
        </section>
        <ShipmentDocumentSlots
          shipmentId={shipment.id}
          shipmentReference={shipment.reference}
          initialRevision={shipment.currentRevision}
          initialShipmentStatus={shipment.status}
          initialDocuments={initialDocuments}
          limits={{
            maxPdfBytes: env.MAX_PDF_BYTES,
            maxImageBytes: env.MAX_IMAGE_BYTES,
            maxPdfPages: env.MAX_PDF_PAGES,
          }}
        />
      </main>
    </div>
  );
}
