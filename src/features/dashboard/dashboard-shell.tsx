"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Plus, RefreshCw, ShipWheel } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentUpload } from "@/features/documents/document-upload";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Shipment = { id: string; reference: string; status: string; currentRevision: number; importerName: string | null; exporterName: string | null; supplier: { id: string; name: string } | null; documents: Array<{ id: string; type: string; status: string; fileName: string }> };

export function DashboardShell({ email }: { email: string }) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [reference, setReference] = useState("");
  const [importerName, setImporterName] = useState("");
  const [exporterName, setExporterName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function loadShipments() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (supplierFilter) params.set("supplierId", supplierFilter);
    const response = await fetch(`/api/shipments?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "Could not load shipments.");
    else setShipments(data.shipments);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (supplierFilter) params.set("supplierId", supplierFilter);

    void fetch(`/api/shipments?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) setError(data.error ?? "Could not load shipments.");
        else setShipments(data.shipments);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("Could not load shipments.");
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, [search, statusFilter, supplierFilter]);

  async function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/shipments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, importerName, exporterName, supplierName }) });
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "Could not create shipment.");
    else { setReference(""); setImporterName(""); setExporterName(""); setSupplierName(""); router.push(`/shipments/${data.shipment.id}`); }
  }

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">CargoVerity</p><p className="mt-1 text-sm text-slate-500">Executive workbench · {email}</p></div><Button variant="ghost" size="sm" onClick={signOut}><LogOut className="size-4" /> Sign out</Button></div></header>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Shipment workbench</h1><p className="mt-2 text-slate-600">Create a synthetic shipment, upload source documents and review model evidence before any export.</p></div>
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4 text-blue-700" /> New shipment</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={createShipment}><div className="space-y-2"><Label htmlFor="reference">Shipment reference</Label><Input id="reference" placeholder="SHP-DEMO-002" value={reference} onChange={(event) => setReference(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="supplier">Supplier</Label><Input id="supplier" placeholder="Mumbai Components Pvt. Ltd." value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="importer">Importer</Label><Input id="importer" value={importerName} onChange={(event) => setImporterName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="exporter">Exporter</Label><Input id="exporter" value={exporterName} onChange={(event) => setExporterName(event.target.value)} /></div><Button type="submit"><ShipWheel className="size-4" /> Create shipment</Button></form></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center justify-between">Shipment queue <Button variant="ghost" size="sm" onClick={() => void loadShipments()}><RefreshCw className="size-4" /></Button></CardTitle></CardHeader><CardContent><div className="mb-4 grid gap-3 sm:grid-cols-3"><Input aria-label="Search shipments" placeholder="Search reference or supplier" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter shipment status" className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="IN_REVIEW">In review</option><option value="APPROVED">Approved</option><option value="EXPORTED">Exported</option></select><select aria-label="Filter supplier" className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}><option value="">All suppliers</option>{Array.from(new Map(shipments.filter((shipment) => shipment.supplier).map((shipment) => [shipment.supplier!.id, shipment.supplier!.name])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>{loading ? <p className="text-sm text-slate-500">Loading shipments…</p> : shipments.length === 0 ? <p className="text-sm text-slate-500">No shipments yet. Create a synthetic shipment to begin.</p> : <div className="space-y-3">{shipments.map((shipment) => <div key={shipment.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><div><Link className="font-semibold text-slate-950 hover:text-blue-700" href={`/shipments/${shipment.id}`}>{shipment.reference}</Link><p className="mt-1 text-sm text-slate-500">{shipment.supplier?.name || "Supplier pending"} · {shipment.importerName || "Importer pending"}</p><p className="mt-1 text-xs text-slate-500">Revision {shipment.currentRevision}</p></div><Badge>{shipment.status.replaceAll("_", " ")}</Badge></div>{shipment.documents.some((document) => document.status === "REVIEW_REQUIRED") ? <div className="mt-3 flex flex-wrap gap-2">{shipment.documents.filter((document) => document.status === "REVIEW_REQUIRED").map((document) => <Link key={document.id} className="text-sm font-medium text-blue-700 hover:text-blue-800" href={`/review/${document.id}`}>Review {document.type.replaceAll("_", " ")} →</Link>)}</div> : null}</div>)}</div>}</CardContent></Card>
        </div>
        {shipments.length > 0 ? <DocumentUpload shipments={shipments.map(({ id, reference }) => ({ id, reference }))} /> : null}
      </div>
    </main>
  );
}
