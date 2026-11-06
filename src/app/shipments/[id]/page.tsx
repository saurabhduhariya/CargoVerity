import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { ShipmentDocumentSlots } from "@/features/documents/shipment-document-slots";

export const instant = false;

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { appUser } = await requireAppUser();
  const { id } = await params;
  const prisma = getPrisma();
  const shipment = await prisma.shipment.findFirst({
    where: { id, ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }) },
    include: {
      supplier: true,
      documents: {
        where: { isCurrent: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          docType: true,
          documentVersion: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          pageCount: true,
          extractionStatus: true,
          createdAt: true,
          isCurrent: true,
        },
      },
    },
  });

  if (!shipment) notFound();

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
              <Badge>{shipment.status.replaceAll("_", " ")}</Badge>
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

        {/* Week 2 Step 5: Three Document Slots and Synthetic Demo Loader */}
        <ShipmentDocumentSlots
          shipmentId={shipment.id}
          shipmentReference={shipment.reference}
          initialRevision={shipment.currentRevision}
          initialDocuments={shipment.documents.map((d) => ({
            ...d,
            createdAt: d.createdAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}

