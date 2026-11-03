"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Field = { id: string; fieldKey: string; modelValue: string | null; currentValue: string | null; unit: string | null; modelConfidence: string | number | null; sourceQuote: string | null; pageNumber: number | null; reviewStatus: string };
type DocumentData = { id: string; shipmentId: string; originalFileName: string; docType: string; documentVersion: number; signedUrl: string; fields: Field[]; lineItems: Array<{ id: string; description: string | null; quantity: string | null; lineTotal: string | null; sourceQuote: string | null; pageNumber: number | null }> };
type ExportPreview = { fileName: string; headers: string[]; rows: string[][] };

export function ReviewPanel({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Array<{ ruleKey: string; status: string }>>([]);
  const [preview, setPreview] = useState<ExportPreview | null>(null);

  async function load() {
    const response = await fetch(`/api/documents/${documentId}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Could not load document."); return; }
    setDocument({ ...data.document, signedUrl: data.signedUrl, fields: data.document.extractionRuns?.[0]?.fields ?? [], lineItems: data.document.extractionRuns?.[0]?.lineItems ?? [] });
  }

  useEffect(() => {
    let active = true;
    void fetch(`/api/documents/${documentId}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) {
          setMessage(data.error ?? "Could not load document.");
          return;
        }
        setDocument({ ...data.document, signedUrl: data.signedUrl, fields: data.document.extractionRuns?.[0]?.fields ?? [], lineItems: data.document.extractionRuns?.[0]?.lineItems ?? [] });
      })
      .catch(() => { if (active) setMessage("Could not load document."); });
    return () => { active = false; };
  }, [documentId]);

  async function reviewField(field: Field, status: "CONFIRMED" | "CORRECTED") {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/fields/${field.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, value: values[field.id] ?? field.currentValue, reason: reason[field.id] ?? (status === "CONFIRMED" ? undefined : "Reviewer correction") }) });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "Could not save review.");
    else {
      await load();
      setMessage(status === "CONFIRMED" ? "Field confirmed." : "Correction saved.");
    }
    setBusy(false);
  }

  async function runChecks() {
    if (!document) return;
    setBusy(true);
    const response = await fetch(`/api/shipments/${document.shipmentId}/crosschecks`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "Could not run cross-checks.");
    else { setChecks(data.results); setMessage("Cross-checks saved as an immutable revision."); }
    setBusy(false);
  }

  async function approveShipment() {
    if (!document) return;
    setBusy(true);
    const response = await fetch(`/api/shipments/${document.shipmentId}/approve`, { method: "POST" });
    const data = await response.json();
    setMessage(response.ok ? "Manager approval recorded for the current revision." : data.error ?? "Manager approval was not recorded.");
    setBusy(false);
  }

  async function previewExport() {
    if (!document) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/shipments/${document.shipmentId}/export?preview=1`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) setMessage(data.error ?? "Could not prepare CSV preview.");
      else {
        setPreview(data as ExportPreview);
        setMessage(`CSV preview ready: ${data.rows.length} rows.`);
      }
    } catch {
      setMessage("Could not prepare CSV preview.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport() {
    if (!document) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/shipments/${document.shipmentId}/export`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json();
        setMessage(data.error ?? "Could not download CSV.");
        return;
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      const fileName = contentDisposition?.match(/filename="([^"]+)"/)?.[1] ?? preview?.fileName ?? "shipment-export.csv";
      const objectUrl = window.URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(objectUrl);
      setMessage("CSV downloaded.");
    } catch {
      setMessage("Could not download CSV.");
    } finally {
      setBusy(false);
    }
  }

  if (!document) return <Card><CardContent className="p-6 text-sm text-slate-600">{message ?? "Loading evidence…"}</CardContent></Card>;

  return <div className="space-y-6"><Card><CardHeader><CardTitle className="flex items-center justify-between"><span>{document.originalFileName}</span><a className="inline-flex items-center gap-2 text-sm font-medium text-blue-700" href={document.signedUrl} target="_blank" rel="noreferrer">Open original <ExternalLink className="size-4" /></a></CardTitle></CardHeader><CardContent><Badge>{document.docType.replaceAll("_", " ")}</Badge><p className="mt-3 text-sm text-slate-600">Source version {document.documentVersion}. AI values remain visible beside reviewer corrections. Source quotes and page references are retained.</p></CardContent></Card>
    {message ? <p role="alert" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p> : null}
    <Card><CardHeader><CardTitle>Fields requiring human verification</CardTitle></CardHeader><CardContent className="space-y-4">{document.fields.length === 0 ? <p className="text-sm text-slate-500">No extracted fields were stored.</p> : document.fields.map((field) => { const confidence = Number(field.modelConfidence); const low = !field.sourceQuote || !Number.isFinite(confidence) || confidence < 0.85; return <div key={field.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-950">{field.fieldKey}</p><div className="flex items-center gap-2"><Badge className={low ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>{low ? "Review needed" : "Evidence present"}</Badge><Badge>{field.reviewStatus}</Badge></div></div><div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><div><label className="text-xs font-medium text-slate-500">Current value</label><Input className="mt-1" value={values[field.id] ?? field.currentValue ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} /></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void reviewField(field, "CONFIRMED")}>Confirm</Button><Button size="sm" disabled={busy} onClick={() => void reviewField(field, "CORRECTED")}><Save className="size-3" /> Save correction</Button></div></div><div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><p><span className="font-semibold">AI value:</span> {field.modelValue ?? "Missing"}</p><p><span className="font-semibold">Confidence:</span> {Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "Not supplied"}</p><p className="sm:col-span-2"><span className="font-semibold">Source:</span> {field.sourceQuote ?? "No source quote supplied"}{field.pageNumber ? ` · page ${field.pageNumber}` : ""}</p></div><Input className="mt-3" placeholder="Correction reason (required for changes)" value={reason[field.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [field.id]: event.target.value }))} /></div>; })}</CardContent></Card>
     <Card>
       <CardHeader><CardTitle>Deterministic cross-checks</CardTitle></CardHeader>
       <CardContent>
         <div className="flex flex-wrap gap-3">
           <Button onClick={() => void runChecks()} disabled={busy}><RefreshCw className="size-4" /> Run cross-checks</Button>
           <Button variant="outline" onClick={() => void approveShipment()} disabled={busy}>Manager approve</Button>
           <Button variant="outline" onClick={() => void (preview ? downloadExport() : previewExport())} disabled={busy}>{preview ? "Download guarded CSV" : "Preview CSV before download"}</Button>
         </div>
         {checks.length > 0 ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{checks.map((check) => <div key={check.ruleKey} className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{check.ruleKey.replaceAll("_", " ")}</span><Badge>{check.status}</Badge></div>)}</div> : <p className="mt-4 text-sm text-slate-500">Cross-checks have not been run for the current revision.</p>}
         {preview ? <div className="mt-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-900">CSV preview · {preview.rows.length} rows</p><p className="text-xs text-slate-500">{preview.fileName}</p></div><div className="max-h-96 overflow-auto rounded-lg border border-slate-200"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{preview.headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700">{header}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 50).map((row, rowIndex) => <tr key={`${rowIndex}-${row[2] ?? "row"}`} className="border-t border-slate-200">{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} className="max-w-xs px-3 py-2 align-top text-slate-700">{cell || "—"}</td>)}</tr>)}</tbody></table></div>{preview.rows.length > 50 ? <p className="text-xs text-slate-500">Showing the first 50 rows.</p> : null}</div> : null}
       </CardContent>
     </Card></div>;
}
