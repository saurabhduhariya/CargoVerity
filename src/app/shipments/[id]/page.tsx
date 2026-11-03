import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

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
      documents: { orderBy: { createdAt: "desc" }, select: { id: true, type: true, status: true, fileName: true } },
    },
  });

  if (!shipment) notFound();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap gap-4 text-sm font-medium"><Link className="text-blue-700" href="/dashboard">← Back to dashboard</Link><Link className="text-blue-700" href="/dashboard">Continue to upload documents →</Link></div>
        <Card>
          <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-3"><span>{shipment.reference}</span><Badge>{shipment.status.replaceAll("_", " ")}</Badge></CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
            <div><p className="text-slate-500">Supplier</p><p className="font-medium text-slate-900">{shipment.supplier?.name ?? "Not assigned"}</p></div>
            <div><p className="text-slate-500">Importer</p><p className="font-medium text-slate-900">{shipment.importerName ?? "Not supplied"}</p></div>
            <div><p className="text-slate-500">Current revision</p><p className="font-medium text-slate-900">{shipment.currentRevision}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {shipment.documents.length === 0 ? <p className="text-sm text-slate-500">No documents uploaded yet.</p> : shipment.documents.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div><p className="font-medium text-slate-900">{document.type.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{document.fileName}</p></div>
                <div className="flex items-center gap-3"><Badge>{document.status.replaceAll("_", " ")}</Badge>{document.status === "REVIEW_REQUIRED" ? <Link className="text-sm font-medium text-blue-700" href={`/review/${document.id}`}>Open review →</Link> : null}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
