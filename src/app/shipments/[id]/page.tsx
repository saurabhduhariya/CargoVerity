import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ArrowLeft, ArrowRight, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <nav aria-label="Shipment navigation" className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3"><Package aria-hidden="true" className="size-5 text-primary" /><Link href="/dashboard" className="rounded-control font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">CargoVerity</Link><Badge>Synthetic demo</Badge></div>
          <span className="text-xs text-muted-foreground">{appUser.role === "MANAGER" ? "Manager" : "Executive"}</span>
        </nav>
      </header>
      <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-control text-sm text-foreground-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/dashboard"><ArrowLeft aria-hidden="true" className="size-4" />Back to operations queue</Link>
        <section aria-labelledby="shipment-title" className="space-y-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <Typography id="shipment-title" variant="page-title" className="col-span-2 break-words font-mono [overflow-wrap:anywhere] sm:col-span-1">{shipment.reference}</Typography>
            <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-2"><StatusBadge status={shipment.status} /><span className="font-mono text-xs text-muted-foreground">rev {shipment.currentRevision}</span></div>
            <Link href={`/review/${shipment.id}`} className="col-start-2 row-start-2 inline-flex min-h-11 items-center gap-2 rounded-control border border-control-border bg-surface px-3 text-sm font-medium hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:row-start-1 sm:px-4">Review workspace<ArrowRight aria-hidden="true" className="size-4" /></Link>
          </div>
          <dl className="grid gap-2 border-y border-border py-3 text-sm sm:grid-cols-3 sm:gap-4 sm:py-4">
            <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2 sm:block"><dt className="text-muted-foreground">Supplier</dt><dd className="break-words font-medium sm:mt-1">{shipment.supplier?.name ?? "Not assigned"}</dd></div>
            <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2 sm:block"><dt className="text-muted-foreground">Importer</dt><dd className="break-words font-medium sm:mt-1">{shipment.importerName ?? "Not supplied"}</dd></div>
            <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2 sm:block"><dt className="text-muted-foreground">Exporter</dt><dd className="break-words font-medium sm:mt-1">{shipment.exporterName ?? "Not supplied"}</dd></div>
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
      </div>
    </main>
  );
}
