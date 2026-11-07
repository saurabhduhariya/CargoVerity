"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCheck,
  FileSpreadsheet,
  Info,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExportPreviewData,
  ExportRecordSummary,
  formatExportBlocker,
} from "@/lib/export/preview";

export type ExportPreviewDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
  shipmentReference: string;
  shipmentRevision: number;
  shipmentStatus: string;
  onExportSuccess?: (record: ExportRecordSummary) => void;
};

export function ExportPreviewDialog({
  isOpen,
  onClose,
  shipmentId,
  shipmentReference,
  shipmentRevision,
  shipmentStatus,
  onExportSuccess,
}: ExportPreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewData, setPreviewData] = useState<ExportPreviewData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedChecksum, setCopiedChecksum] = useState(false);
  const [recentExportRecord, setRecentExportRecord] =
    useState<ExportRecordSummary | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/shipments/${shipmentId}/export?preview=1`,
      );
      const data = (await response.json()) as ExportPreviewData;

      if (!response.ok && !data.blockers) {
        setErrorMessage(data.error ?? "Failed to load export preview.");
      } else {
        setPreviewData(data);
        if (data.recentExport && !recentExportRecord) {
          setRecentExportRecord(data.recentExport);
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load export preview.",
      );
    } finally {
      setLoading(false);
    }
  }, [shipmentId, recentExportRecord]);

  // Synchronize modal state with native <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
        void loadPreview();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen, loadPreview]);

  async function handleDownloadCsv() {
    if (!previewData?.ready || downloading) return;

    setDownloading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/export`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error ?? "Export blocked by server guard evaluation.",
        );
      }

      const csvContent = await response.text();
      const checksum = response.headers.get("X-Checksum-Sha256") ?? "";
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileNameMatch = disposition.match(/filename="?([^";]+)"?/);
      const fileName =
        fileNameMatch?.[1] ?? `${shipmentReference}-demo-v1-rev${shipmentRevision}.csv`;

      // Trigger standard browser download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      // Show the export record the server stored (re-load the guarded preview to read it back).
      const fallback: ExportRecordSummary = {
        id: response.headers.get("X-Export-Event-Id") ?? `export-${Date.now()}`,
        profileId: previewData.profileId,
        profileVersion: previewData.profileVersion,
        revision: shipmentRevision,
        createdAt: new Date().toISOString(),
        exportedBy: null,
        checksumSha256: checksum || previewData.checksumSha256,
        fileName,
        rowCount: previewData.rowCount ?? null,
      };
      let record = fallback;
      try {
        const refreshed = await fetch(`/api/shipments/${shipmentId}/export?preview=1`, { cache: "no-store" });
        const refreshedData = (await refreshed.json()) as ExportPreviewData;
        if (refreshedData.recentExport) record = refreshedData.recentExport;
        setPreviewData(refreshedData);
      } catch {
        // Keep the header-derived record.
      }

      setRecentExportRecord(record);
      onExportSuccess?.(record);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not complete CSV download.",
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleCopyChecksum(hash: string) {
    if (!hash) return;
    void navigator.clipboard.writeText(hash);
    setCopiedChecksum(true);
    setTimeout(() => setCopiedChecksum(false), 2000);
  }

  // Backdrop light dismiss helper
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const isOutside =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;
    if (isOutside) {
      dialog.close();
      onClose();
    }
  };

  const isApproved =
    previewData?.approvedRevision !== null &&
    previewData?.approvedRevision !== undefined &&
    previewData.approvedRevision === shipmentRevision &&
    (shipmentStatus === "APPROVED" || shipmentStatus === "EXPORTED");

  const isApprovalStale =
    previewData?.approvedRevision !== null &&
    previewData?.approvedRevision !== undefined &&
    previewData.approvedRevision !== shipmentRevision;

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="export-dialog-title"
      className="m-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="flex flex-col max-h-[90vh]">
        {/* Dialog Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <FileSpreadsheet className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="export-dialog-title"
                  className="text-lg font-bold text-slate-900"
                >
                  Export CSV Preview & Guard Verification
                </h2>
                <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-xs">
                  {previewData?.profileId ?? "demo-v1"} (v
                  {previewData?.profileVersion ?? "1.0.0"})
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Shipment Reference:{" "}
                <span className="font-mono font-medium text-slate-700">
                  {shipmentReference}
                </span>{" "}
                · Current Revision:{" "}
                <span className="font-semibold text-slate-700">
                  rev {shipmentRevision}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            aria-label="Close dialog"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Dialog Body (Scrollable) */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 text-sm">
          {/* Rule 1: Profile Assumption Label Banner */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-blue-900">
            <div className="flex items-start gap-3">
              <Info className="size-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs uppercase tracking-wider text-blue-700">
                    Export Profile Assumption
                  </span>
                  <Badge className="text-[10px] bg-white border border-blue-300 text-blue-800">
                    demo-v1
                  </Badge>
                </div>
                <p className="text-xs text-blue-800 leading-relaxed">
                  {previewData?.assumptionLabel ??
                    "[ASSUMPTION] Temporary export profile demo-v1; filing-software customs template awaiting client specification."}
                </p>
              </div>
            </div>
          </div>

          {/* Rule 2: Current Approved Revision & Timestamp */}
          <Card className="border-slate-200">
            <CardHeader className="bg-slate-50/70 py-3 px-4 border-b border-slate-200">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                <span>Manager Approval & Revision Integrity</span>
                {isApproved ? (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                    Approved Revision Match
                  </Badge>
                ) : isApprovalStale ? (
                  <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-xs">
                    Approval Stale
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
                    Pending Approval
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block">Workflow Status</span>
                <span className="font-semibold text-slate-800 capitalize">
                  {shipmentStatus.replaceAll("_", " ").toLowerCase()}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Approved Revision</span>
                <span className="font-mono font-semibold text-slate-800">
                  {previewData?.approvedRevision !== null &&
                  previewData?.approvedRevision !== undefined
                    ? `rev ${previewData.approvedRevision}`
                    : "Not approved"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Approval Timestamp</span>
                <span className="text-slate-800">
                  {previewData?.approvedAt
                    ? new Date(previewData.approvedAt).toLocaleString()
                    : "Pending"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Approved By</span>
                <span className="text-slate-800 truncate block">
                  {previewData?.approvedBy ?? "Pending manager action"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Rule 3: Exact Blockers When Export is Unavailable */}
          {previewData && !previewData.ready && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="size-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-3 w-full">
                  <div>
                    <h3 className="font-bold text-rose-950 text-sm">
                      Export Unavailable — {previewData.blockers.length} Guard Blocker
                      {previewData.blockers.length > 1 ? "s" : ""}
                    </h3>
                    <p className="text-xs text-rose-800">
                      The export route enforces strict server-side gating. The
                      following requirements must be resolved before customs CSV
                      generation is unlocked:
                    </p>
                  </div>

                  <div className="grid gap-2">
                    {previewData.blockers.map((blockerKey) => {
                      const formatted = formatExportBlocker(blockerKey);
                      const detail = previewData.blockerDetails?.find((b) => b.code === blockerKey)?.detail;
                      return (
                        <div
                          key={blockerKey}
                          className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-white p-2.5 text-xs shadow-xs"
                        >
                          <AlertTriangle className="size-4 text-rose-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900 block">
                              {formatted.title}
                            </span>
                            <span className="text-slate-600">
                              {formatted.description}
                            </span>
                            {detail ? (
                              <span className="block text-slate-800 font-medium mt-0.5">{detail}</span>
                            ) : null}
                            <span className="text-[10px] text-slate-400 block font-mono mt-0.5">
                              Rule Code: {formatted.code}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Rule 5: Backend Readiness Confirmation */}
          {previewData?.ready && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
                <div className="space-y-0.5">
                  <h3 className="font-bold text-emerald-950 text-sm">
                    Backend Readiness Confirmed
                  </h3>
                  <p className="text-xs text-emerald-800">
                    All export guards passed cleanly: Manager approval is active,
                    revision matches, required documents are present, and all
                    cross-checks are resolved.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* General Error Message */}
          {errorMessage && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Rule 7: Post-Download Export Record */}
          {recentExportRecord && (
            <Card className="border-indigo-200 bg-indigo-50/30">
              <CardHeader className="bg-indigo-50/60 py-3 px-4 border-b border-indigo-100 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-indigo-600" />
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                    Export Record & Audit Event
                  </CardTitle>
                </div>
                <Badge className="bg-emerald-600 text-white text-xs">
                  EXPORTED
                </Badge>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-500 block">Exported File</span>
                    <span className="font-mono font-medium text-slate-800">
                      {recentExportRecord.fileName ?? "shipment-export.csv"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Export Timestamp</span>
                    <span className="text-slate-800">
                      {new Date(recentExportRecord.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Profile & Version</span>
                    <span className="text-slate-800">
                      {recentExportRecord.profileId}
                      {recentExportRecord.profileVersion ? ` v${recentExportRecord.profileVersion}` : ""} (rev{" "}
                      {recentExportRecord.revision})
                      {typeof recentExportRecord.rowCount === "number" ? ` · ${recentExportRecord.rowCount} rows` : ""}
                      {recentExportRecord.exportedBy ? ` · by ${recentExportRecord.exportedBy}` : ""}
                    </span>
                  </div>
                </div>

                {recentExportRecord.checksumSha256 && (
                  <div className="rounded-lg bg-slate-100 p-2.5 flex items-center justify-between gap-2 border border-slate-200">
                    <div className="truncate">
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">
                        SHA-256 Checksum
                      </span>
                      <span className="font-mono text-xs text-slate-800 truncate block">
                        {recentExportRecord.checksumSha256}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs bg-white shrink-0"
                      onClick={() =>
                        handleCopyChecksum(recentExportRecord.checksumSha256!)
                      }
                    >
                      {copiedChecksum ? (
                        <>
                          <Check className="size-3 text-emerald-600 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3 mr-1" />
                          Copy Hash
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Rule 4: Small CSV Preview from Same Server Mapping */}
          {previewData?.headers && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    CSV Table Preview
                  </h3>
                  <Badge className="text-[10px] bg-white border border-slate-300 text-slate-600">
                    {previewData.headers.length} Columns · {previewData.rowCount ?? 0}{" "}
                    Row{(previewData.rowCount ?? 0) === 1 ? "" : "s"}
                    {previewData.rows && (previewData.rowCount ?? 0) > previewData.rows.length
                      ? ` (showing first ${previewData.rows.length})`
                      : ""}
                  </Badge>
                </div>
                {previewData.checksumSha256 && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Precomputed SHA-256:{" "}
                    <span className="text-slate-700">
                      {previewData.checksumSha256.slice(0, 16)}...
                    </span>
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs max-h-72">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 text-slate-400 font-normal">#</th>
                      {previewData.headers.map((header) => (
                        <th
                          key={header}
                          className="py-2 px-3 whitespace-nowrap font-bold text-slate-800 border-r border-slate-200 last:border-r-0"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewData.rows && previewData.rows.length > 0 ? (
                      previewData.rows.map((row, rowIndex) => (
                        <tr
                          key={rowIndex}
                          className="hover:bg-slate-50 transition odd:bg-white even:bg-slate-50/40"
                        >
                          <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">
                            {rowIndex + 1}
                          </td>
                          {row.map((cell, colIndex) => (
                            <td
                              key={colIndex}
                              className="py-1.5 px-3 whitespace-nowrap text-slate-700 border-r border-slate-100 last:border-r-0"
                            >
                              {cell === "" ? (
                                <span className="text-slate-300 italic">null</span>
                              ) : (
                                cell
                              )}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={previewData.headers.length + 1}
                          className="py-8 text-center text-slate-400 italic font-sans"
                        >
                          No line items extracted to display in preview table.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Dialog Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadPreview()}
            disabled={loading || downloading}
            className="text-xs"
          >
            <RefreshCw
              className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Verifying..." : "Refresh Preflight"}
          </Button>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              disabled={downloading}
              className="text-xs"
            >
              Close
            </Button>

            {/* Rule 5 & 6: Download only enabled when backend readiness is confirmed */}
            <Button
              size="sm"
              onClick={() => void handleDownloadCsv()}
              disabled={!previewData?.ready || downloading}
              className={`text-xs font-semibold px-4 ${
                previewData?.ready
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              {downloading ? (
                <>
                  <RefreshCw className="size-3.5 mr-1.5 animate-spin" />
                  Generating CSV...
                </>
              ) : recentExportRecord ? (
                <>
                  <FileCheck className="size-3.5 mr-1.5" />
                  Re-download Guarded CSV
                </>
              ) : (
                <>
                  <Download className="size-3.5 mr-1.5" />
                  Download Guarded CSV
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
