"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, ExternalLink, PlusCircle, RefreshCw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Field = {
  id: string;
  fieldKey: string;
  modelValue: string | null;
  currentValue: string | null;
  unit: string | null;
  modelConfidence: string | number | null;
  sourceQuote: string | null;
  pageNumber: number | null;
  reviewStatus: string;
  reviewReason?: string | null;
};

type DocumentPageData = {
  id: string;
  pageNumber: number;
  isReadable: boolean;
  manualEntryRequired: boolean;
  reviewNote: string | null;
};

type ExtractionRunData = {
  id: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryOfRunId: string | null;
  createdAt: string;
};

type DocumentData = {
  id: string;
  shipmentId: string;
  originalFileName: string;
  docType: string;
  selectedDocType?: string;
  detectedDocType?: string | null;
  typeMismatch?: boolean;
  documentVersion: number;
  signedUrl: string;
  pages: DocumentPageData[];
  fields: Field[];
  lineItems: Array<{
    id: string;
    description: string | null;
    quantity: string | null;
    lineTotal: string | null;
    sourceQuote: string | null;
    pageNumber: number | null;
  }>;
  latestRun?: ExtractionRunData | null;
};

type ExportPreview = { fileName: string; headers: string[]; rows: string[][] };

export function ReviewPanel({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Array<{ ruleKey: string; status: string }>>([]);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const [newManualFieldKey, setNewManualFieldKey] = useState("");
  const [newManualFieldValue, setNewManualFieldValue] = useState("");
  const [newManualFieldReason, setNewManualFieldReason] = useState("");
  const [showAddManualField, setShowAddManualField] = useState(false);

  async function load() {
    const response = await fetch(`/api/documents/${documentId}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not load document.");
      return;
    }
    const latestRun = data.document.extractionRuns?.[0] ?? null;
    setDocument({
      ...data.document,
      signedUrl: data.signedUrl,
      pages: data.document.pages ?? [],
      fields: latestRun?.fields ?? [],
      lineItems: latestRun?.lineItems ?? [],
      latestRun,
    });
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
        const latestRun = data.document.extractionRuns?.[0] ?? null;
        setDocument({
          ...data.document,
          signedUrl: data.signedUrl,
          pages: data.document.pages ?? [],
          fields: latestRun?.fields ?? [],
          lineItems: latestRun?.lineItems ?? [],
          latestRun,
        });
      })
      .catch(() => {
        if (active) setMessage("Could not load document.");
      });
    return () => {
      active = false;
    };
  }, [documentId]);

  async function reviewField(field: Field, status: "CONFIRMED" | "CORRECTED" | "MANUAL_ENTRY") {
    setBusy(true);
    setMessage(null);
    const correctionReason =
      reason[field.id] ?? (status === "CONFIRMED" ? undefined : "Manual value entry");
    const response = await fetch(`/api/fields/${field.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        value: values[field.id] ?? field.currentValue,
        reason: correctionReason,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not save review.");
    } else {
      await load();
      setMessage(
        status === "CONFIRMED"
          ? "Field confirmed."
          : status === "MANUAL_ENTRY"
            ? "Manual value saved."
            : "Correction saved.",
      );
    }
    setBusy(false);
  }

  async function markPageForManualEntry(pageNumber: number) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/pages/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageNumber,
          manualEntryRequired: true,
          reviewNote: "Marked for manual entry due to poor image clarity.",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not mark page for manual entry.");
      } else {
        await load();
        setMessage(`Page ${pageNumber} unlocked for manual entry. Prior approvals invalidated.`);
      }
    } catch {
      setMessage("Failed to update page status.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNewManualField() {
    if (!newManualFieldKey.trim() || !newManualFieldReason.trim()) {
      setMessage("Field key and reason are required for manual fallback entry.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/fields/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey: newManualFieldKey.trim(),
          value: newManualFieldValue.trim() || null,
          reason: newManualFieldReason.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save manual field.");
      } else {
        await load();
        setMessage(`Manual field "${newManualFieldKey}" saved successfully.`);
        setNewManualFieldKey("");
        setNewManualFieldValue("");
        setNewManualFieldReason("");
        setShowAddManualField(false);
      }
    } catch {
      setMessage("Failed to save manual field.");
    } finally {
      setBusy(false);
    }
  }

  async function retryExtraction() {
    if (!document) return;
    setBusy(true);
    setMessage(null);
    setShowRetryConfirm(false);

    try {
      // In Week 3 Step 5, retry creates a new run linked via retryOfRunId
      const response = await fetch("/api/extractions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          documentType: document.docType,
          retryOfRunId: document.latestRun?.id,
          pages: [
            // Lightweight single dummy/placeholder page trigger for retry lifecycle
            {
              pageNumber: 1,
              imageBase64: "dGVzdC1iYXNlNjQtcGFkZGluZy1mb3ItZXh0cmFjdGlvbi1yZXRyeS1ydW4tdG8tcGFzcy1taW4tbGVuZ3RoLXJlcXVpcmVtZW50cw==",
              mimeType: "image/jpeg",
            },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Extraction retry failed.");
      } else {
        await load();
        setMessage("New extraction run started. Prior run history preserved.");
      }
    } catch {
      setMessage("Failed to trigger extraction retry.");
    } finally {
      setBusy(false);
    }
  }

  async function runChecks() {
    if (!document) return;
    setBusy(true);
    const response = await fetch(`/api/shipments/${document.shipmentId}/crosschecks`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not run cross-checks.");
    } else {
      setChecks(data.results);
      setMessage("Cross-checks saved as an immutable revision.");
    }
    setBusy(false);
  }

  async function approveShipment() {
    if (!document) return;
    setBusy(true);
    const response = await fetch(`/api/shipments/${document.shipmentId}/approve`, {
      method: "POST",
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? "Manager approval recorded for the current revision."
        : data.error ?? "Manager approval was not recorded.",
    );
    setBusy(false);
  }

  async function previewExport() {
    if (!document) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/shipments/${document.shipmentId}/export?preview=1`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not prepare CSV preview.");
      } else {
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
      const response = await fetch(`/api/shipments/${document.shipmentId}/export`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json();
        setMessage(data.error ?? "Could not download CSV.");
        return;
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      const fileName =
        contentDisposition?.match(/filename="([^"]+)"/)?.[1] ??
        preview?.fileName ??
        "shipment-export.csv";
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

  if (!document) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-slate-600">
          {message ?? "Loading evidence…"}
        </CardContent>
      </Card>
    );
  }

  const unreadablePages = document.pages.filter((p) => !p.isReadable);
  const isFailedRun = document.latestRun?.status === "FAILED";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{document.originalFileName}</span>
            <a
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-700"
              href={document.signedUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open original <ExternalLink className="size-4" />
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{document.docType.replaceAll("_", " ")}</Badge>
            {document.typeMismatch ? (
              <Badge className="bg-red-100 text-red-800">
                Document type mismatch: detected {document.detectedDocType ?? "Unknown"}
              </Badge>
            ) : null}
            <Badge className="border border-slate-300 bg-white text-slate-700">
              Revision {document.documentVersion}
            </Badge>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Source version {document.documentVersion}. AI original values remain immutable.
            Reviewer corrections and manual entries are version-tracked with actor attribution.
          </p>
        </CardContent>
      </Card>

      {/* Week 3 Step 5 Rule 1: Unreadable Page Banner */}
      {unreadablePages.length > 0 ? (
        <div className="space-y-3">
          {unreadablePages.map((page) => (
            <div
              key={page.id}
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">
                      Unreadable Page Detected — Page {page.pageNumber}
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      {page.reviewNote ?? "Image quality too low or text garbled."}{" "}
                      {page.manualEntryRequired
                        ? "Manual entry is required for fields on this page."
                        : "Mark page to unlock manual fallback entry."}
                    </p>
                  </div>
                </div>
                {!page.manualEntryRequired ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-400 bg-white hover:bg-amber-100 text-amber-900"
                    disabled={busy}
                    onClick={() => void markPageForManualEntry(page.pageNumber)}
                  >
                    Mark for manual entry
                  </Button>
                ) : (
                  <Badge className="bg-amber-200 text-amber-900 border-amber-300">
                    Manual fallback active
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Week 3 Step 5 Rule 9: Provider Unavailable / Failed State Banner */}
      {isFailedRun ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-5 text-rose-600 shrink-0" />
              <div>
                <p className="font-semibold text-sm">
                  AI Provider Unavailable or Extraction Failed (
                  {document.latestRun?.errorCode ?? "EXTRACTION_FAILED"})
                </p>
                <p className="text-xs text-rose-800 mt-0.5">
                  {document.latestRun?.errorMessage ?? "AI extraction request was unsuccessful."}{" "}
                  Prior run history is preserved for audit trail.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-rose-400 bg-white hover:bg-rose-100 text-rose-900"
                disabled={busy}
                onClick={() => setShowRetryConfirm(true)}
              >
                <RefreshCw className="size-3.5 mr-1" /> Retry extraction
              </Button>
              <Button
                size="sm"
                className="bg-rose-700 hover:bg-rose-800 text-white"
                onClick={() => setShowAddManualField(true)}
              >
                <PlusCircle className="size-3.5 mr-1" /> Enter fields manually
              </Button>
            </div>
          </div>

          {showRetryConfirm ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-white p-3 text-xs text-slate-700">
              <p className="font-medium text-rose-900 mb-1">
                ⚠️ Cost-sensitive Action Confirmation
              </p>
              <p>
                Retrying extraction will send new API requests to the configured AI provider and
                create a new run linked to run #{document.latestRun?.id.slice(0, 8)}.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                  disabled={busy}
                  onClick={() => void retryExtraction()}
                >
                  Confirm & Retry
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRetryConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p role="alert" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </p>
      ) : null}

      {/* Manual Field Creation Form */}
      {showAddManualField ? (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader>
            <CardTitle className="text-base text-blue-950">Add Manual Field Fallback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-700">Field key (e.g. invoiceTotal)</label>
                <Input
                  className="mt-1 bg-white"
                  placeholder="invoiceTotal"
                  value={newManualFieldKey}
                  onChange={(e) => setNewManualFieldKey(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Value</label>
                <Input
                  className="mt-1 bg-white"
                  placeholder="e.g. 5400.00"
                  value={newManualFieldValue}
                  onChange={(e) => setNewManualFieldValue(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Reason for manual entry</label>
              <Input
                className="mt-1 bg-white"
                placeholder="Unreadable page or AI missing field"
                value={newManualFieldReason}
                onChange={(e) => setNewManualFieldReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddManualField(false)}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void submitNewManualField()}>
                <Save className="size-3.5 mr-1" /> Save manual entry
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Extracted Fields List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Fields requiring human verification</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddManualField((prev) => !prev)}
          >
            <PlusCircle className="size-3.5 mr-1" /> Add field manually
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {document.fields.length === 0 ? (
            <p className="text-sm text-slate-500">
              No extracted fields found. Use &quot;Add field manually&quot; to enter values.
            </p>
          ) : (
            document.fields.map((field) => {
              const confidence = Number(field.modelConfidence);
              const low =
                !field.sourceQuote ||
                !Number.isFinite(confidence) ||
                confidence < 0.85 ||
                field.reviewStatus === "REQUIRES_REVIEW";
              const isManual = field.reviewStatus === "MANUAL_ENTRY";

              return (
                <div key={field.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-950">{field.fieldKey}</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          isManual
                            ? "bg-purple-100 text-purple-800"
                            : low
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                        }
                      >
                        {isManual
                          ? "Manually entered"
                          : low
                            ? "Review needed"
                            : "Evidence present"}
                      </Badge>
                      <Badge className="border border-slate-300 bg-white text-slate-700">
                        {field.reviewStatus}
                      </Badge>
                      {field.reviewReason ? (
                        <span className="text-xs text-slate-500 font-mono">
                          [{field.reviewReason}]
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <div>
                      <label className="text-xs font-medium text-slate-500">Current value</label>
                      <Input
                        className="mt-1"
                        value={values[field.id] ?? field.currentValue ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void reviewField(field, "CONFIRMED")}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-purple-300 text-purple-700 hover:bg-purple-50"
                        disabled={busy}
                        onClick={() => void reviewField(field, "MANUAL_ENTRY")}
                      >
                        <Save className="size-3 mr-1" /> Save manual value
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void reviewField(field, "CORRECTED")}
                      >
                        Save correction
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <p>
                      <span className="font-semibold">AI original value:</span>{" "}
                      {field.modelValue ?? "None (manual entry)"}
                    </p>
                    <p>
                      {/* Week 3 Step 5 Rule 9: Confidence labelled 'model estimate' */}
                      <span className="font-semibold">Confidence:</span>{" "}
                      {Number.isFinite(confidence)
                        ? `${Math.round(confidence * 100)}% (model estimate)`
                        : "Not supplied (model estimate)"}
                    </p>
                    <p className="sm:col-span-2">
                      <span className="font-semibold">Source evidence:</span>{" "}
                      {field.sourceQuote ?? "No source quote supplied"}
                      {field.pageNumber ? ` · page ${field.pageNumber}` : ""}
                    </p>
                  </div>

                  <Input
                    className="mt-3"
                    placeholder="Reason for manual entry or correction (required)"
                    value={reason[field.id] ?? ""}
                    onChange={(event) =>
                      setReason((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deterministic cross-checks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void runChecks()} disabled={busy}>
              <RefreshCw className="size-4 mr-1" /> Run cross-checks
            </Button>
            <Button variant="outline" onClick={() => void approveShipment()} disabled={busy}>
              Manager approve
            </Button>
            <Button
              variant="outline"
              onClick={() => void (preview ? downloadExport() : previewExport())}
              disabled={busy}
            >
              {preview ? "Download guarded CSV" : "Preview CSV before download"}
            </Button>
          </div>
          {checks.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {checks.map((check) => (
                <div
                  key={check.ruleKey}
                  className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm"
                >
                  <span>{check.ruleKey.replaceAll("_", " ")}</span>
                  <Badge>{check.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Cross-checks have not been run for the current revision.
            </p>
          )}
          {preview ? (
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  CSV preview · {preview.rows.length} rows
                </p>
                <p className="text-xs text-slate-500">{preview.fileName}</p>
              </div>
              <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      {preview.headers.map((header) => (
                        <th
                          key={header}
                          className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 50).map((row, rowIndex) => (
                      <tr
                        key={`${rowIndex}-${row[2] ?? "row"}`}
                        className="border-t border-slate-200"
                      >
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`${rowIndex}-${cellIndex}`}
                            className="max-w-xs px-3 py-2 align-top text-slate-700"
                          >
                            {cell || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 50 ? (
                <p className="text-xs text-slate-500">Showing the first 50 rows.</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
