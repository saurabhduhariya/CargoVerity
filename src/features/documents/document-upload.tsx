"use client";

import { useState } from "react";
import Link from "next/link";
import { FileUp, LoaderCircle, ScanSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/utils";
import type { DocumentType } from "@/lib/ai/types";

type ShipmentOption = { id: string; reference: string };

async function renderFilePages(file: File) {
  if (file.type === "image/png" || file.type === "image/jpeg") {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(image.width * scale));
    canvas.height = Math.max(1, Math.ceil(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return [{ pageNumber: 1, imageBase64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "", mimeType: "image/jpeg" as const }];
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > 50) throw new Error("This demo accepts at most 50 PDF pages.");
  const pages: Array<{ pageNumber: number; imageBase64: string; mimeType: "image/jpeg" }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const initialViewport = page.getViewport({ scale: 1.5 });
    const scale = Math.min(1.5, 1800 / Math.max(initialViewport.width, initialViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    pages.push({
      pageNumber,
      imageBase64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "",
      mimeType: "image/jpeg",
    });
  }

  return pages;
}

export function DocumentUpload({ shipments }: { shipments: ShipmentOption[] }) {
  const [shipmentId, setShipmentId] = useState(shipments[0]?.id ?? "");
  const [documentType, setDocumentType] = useState<DocumentType>("INVOICE");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ documentId: string; fields: number; lineItems: number; warnings: number } | null>(null);

  async function submit() {
    if (!file || !shipmentId) {
      setError("Select a shipment and a document first.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      setStatus("Uploading the original document to private storage…");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shipmentId", shipmentId);
      formData.append("documentType", documentType);
      const uploadResponse = await fetch("/api/documents", { method: "POST", body: formData });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadData.error ?? "Upload failed.");

      setStatus("Rendering pages locally with PDF.js…");
      const pages = await renderFilePages(file);
      let runId: string | undefined;
      let fieldCount = 0;
      let lineItemCount = 0;
      let warningCount = 0;

      for (let index = 0; index < pages.length; index += 3) {
        const batch = pages.slice(index, index + 3);
        setStatus(`Extracting pages ${batch[0]?.pageNumber}–${batch.at(-1)?.pageNumber} with the configured provider…`);
        const response = await fetch("/api/extractions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: uploadData.document.id,
            documentType,
            runId,
            batchNumber: Math.floor(index / 3),
            isFinal: index + 3 >= pages.length,
            pages: batch,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Extraction failed.");
        runId = data.runId;
        fieldCount += data.result.fields.length;
        lineItemCount += data.result.lineItems.length;
        warningCount += data.result.warnings.length;
      }

      setResult({ documentId: uploadData.document.id, fields: fieldCount, lineItems: lineItemCount, warnings: warningCount });
      setStatus("Extraction completed. Review the evidence before approval.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Document processing failed.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileUp className="size-4 text-blue-700" /> Upload and extract</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="shipment">Shipment</Label><select id="shipment" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={shipmentId} onChange={(event) => setShipmentId(event.target.value)}><option value="">Select shipment</option>{shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.reference}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="document-type">Document type</Label><select id="document-type" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}><option value="INVOICE">Commercial Invoice</option><option value="PACKING_LIST">Packing List</option><option value="BILL_OF_LADING">Bill of Lading</option></select></div>
        </div>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
          <Label htmlFor="document-file">PDF, PNG or JPEG</Label>
          <input id="document-file" className="mt-3 block w-full text-sm" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          {file ? <Badge className="mt-3">{file.name} · {formatBytes(file.size)}</Badge> : null}
        </div>
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {status ? <p className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800"><LoaderCircle className={busy ? "size-4 animate-spin" : "size-4"} />{status}</p> : null}
        {result ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-emerald-50 p-3 text-sm"><p className="font-semibold text-emerald-900">{result.fields}</p><p className="text-emerald-700">fields captured</p></div><div className="rounded-lg bg-slate-100 p-3 text-sm"><p className="font-semibold text-slate-900">{result.lineItems}</p><p className="text-slate-700">line items</p></div><div className="rounded-lg bg-amber-50 p-3 text-sm"><p className="font-semibold text-amber-900">{result.warnings}</p><p className="text-amber-700">review warnings</p></div></div><Link className="inline-flex text-sm font-medium text-blue-700 hover:text-blue-800" href={`/review/${result.documentId}`}>Open evidence review →</Link></div> : null}
        <Button type="button" onClick={submit} disabled={busy || !file || !shipmentId}><ScanSearch className="size-4" />{busy ? "Processing…" : "Upload and extract"}</Button>
      </CardContent>
    </Card>
  );
}
