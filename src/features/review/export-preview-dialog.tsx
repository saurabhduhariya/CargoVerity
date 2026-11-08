"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Download, RefreshCw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/feedback-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatExportBlocker,
  type ExportPreviewData,
  type ExportRecordSummary,
} from "@/lib/export/preview";
import { displayDate } from "./review-presentation";

export type ExportPreviewDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
  shipmentReference: string;
  shipmentRevision: number;
  shipmentStatus: string;
  hasUnsavedChanges?: boolean;
  /** Null means the export succeeded but its complete server receipt could not be read. */
  onExportSuccess?: (record: ExportRecordSummary | null) => void;
  onRequestRefresh?: () => void;
};

/** UI guard only. The download endpoint re-evaluates all authoritative server gates. */
export function canDownloadExport(
  preview: ExportPreviewData | null | undefined,
  revision: number,
  status: string,
  hasUnsavedChanges: boolean,
): boolean {
  return Boolean(
    preview?.ready && preview.allowed && preview.blockers.length === 0 &&
    preview.currentRevision === revision && preview.approvedRevision === revision &&
    ["APPROVED", "EXPORTED"].includes(status) &&
    ["APPROVED", "EXPORTED"].includes(preview.shipmentStatus) &&
    preview.fileName && preview.checksumSha256 && preview.headers?.length && Array.isArray(preview.rows) &&
    !hasUnsavedChanges,
  );
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalChecksum(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[a-f\d]{64}$/i.test(value));
}

function nonnegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isServerExportRecord(value: unknown): value is ExportRecordSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ExportRecordSummary>;
  return typeof record.id === "string" && typeof record.profileId === "string" &&
    (record.profileVersion === undefined || nullableString(record.profileVersion)) &&
    nonnegativeInteger(record.revision) && typeof record.createdAt === "string" &&
    !Number.isNaN(new Date(record.createdAt).getTime()) && nullableString(record.exportedBy) &&
    optionalChecksum(record.checksumSha256) && optionalString(record.fileName) &&
    (record.rowCount === undefined || record.rowCount === null || nonnegativeInteger(record.rowCount));
}

export function isExportPreviewResponse(body: unknown): body is ExportPreviewData {
  if (!body || typeof body !== "object") return false;
  const data = body as Partial<ExportPreviewData>;
  return typeof data.ready === "boolean" && typeof data.allowed === "boolean" &&
    Array.isArray(data.blockers) && data.blockers.every((value) => typeof value === "string") &&
    Number.isInteger(data.currentRevision) && typeof data.shipmentStatus === "string" &&
    typeof data.profileId === "string" && typeof data.profileVersion === "string" &&
    typeof data.assumptionLabel === "string" &&
    (data.approvedRevision === null || Number.isInteger(data.approvedRevision)) &&
    nullableString(data.approvedAt) && nullableString(data.approvedBy) &&
    optionalString(data.fileName) && optionalChecksum(data.checksumSha256) && optionalString(data.error) &&
    (data.recentExport === null || isServerExportRecord(data.recentExport)) &&
    (data.rowCount === undefined || nonnegativeInteger(data.rowCount)) &&
    (data.previewRowLimit === undefined || nonnegativeInteger(data.previewRowLimit)) &&
    (data.blockerDetails === undefined || (Array.isArray(data.blockerDetails) && data.blockerDetails.every((entry) =>
      entry && typeof entry === "object" && typeof entry.code === "string" && optionalString(entry.detail)))) &&
    (data.headers === undefined || (Array.isArray(data.headers) && data.headers.every((header) => typeof header === "string"))) &&
    (data.rows === undefined || (Array.isArray(data.rows) && data.rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"))));
}

export function exportSnapshotMatches(preview: ExportPreviewData, metadata: {
  checksum: string | null; profile: string | null; fileName: string | undefined; contentType: string | null;
}, actualChecksum: string): boolean {
  return metadata.checksum === preview.checksumSha256 && actualChecksum === preview.checksumSha256 &&
    metadata.fileName === preview.fileName && metadata.profile === `${preview.profileId}@${preview.profileVersion}` &&
    Boolean(metadata.contentType?.includes("text/csv"));
}

export function latestServerExportRecord(cached: ExportRecordSummary | null | undefined, recent: ExportRecordSummary | null | undefined) {
  if (!cached) return recent;
  if (!recent) return cached;
  return new Date(recent.createdAt).getTime() >= new Date(cached.createdAt).getTime() ? recent : cached;
}

type ChecksumCopyFeedback = { copiedHash: string | null; error: string | null };

/** Clipboard feedback is independent of export warnings and receipts. */
export async function copyExportChecksum(hash: string): Promise<ChecksumCopyFeedback> {
  try {
    await navigator.clipboard.writeText(hash);
    return { copiedHash: hash, error: null };
  } catch {
    return { copiedHash: null, error: "Clipboard access was unavailable. Select and copy the full checksum below." };
  }
}

type PreviewState = { key: string; data?: ExportPreviewData; error?: string };
type DownloadFeedback = { kind: "success" | "warning" | "error"; message: string };

export function ExportPreviewDialog({
  isOpen,
  onClose,
  shipmentId,
  shipmentReference,
  shipmentRevision,
  shipmentStatus,
  hasUnsavedChanges = false,
  onExportSuccess,
  onRequestRefresh,
}: ExportPreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const downloadInFlight = useRef(false);
  const downloadUrlRef = useRef<string | null>(null);
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<PreviewState | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<DownloadFeedback | null>(null);
  const [invalidatedKey, setInvalidatedKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ shipmentId: string; record: ExportRecordSummary } | null>(null);
  const [checksumCopy, setChecksumCopy] = useState<ChecksumCopyFeedback | null>(null);
  const [previousOpen, setPreviousOpen] = useState(isOpen);
  if (previousOpen !== isOpen) {
    setPreviousOpen(isOpen);
    if (isOpen) {
      setAttempt((value) => value + 1);
      setLoaded(null);
      setFeedback(null);
      setChecksumCopy(null);
    }
  }
  const key = `${shipmentId}|${shipmentRevision}|${shipmentStatus}|${attempt}`;
  const current = loaded?.key === key ? loaded : null;
  const preview = current?.data ?? null;
  const loading = isOpen && !current;
  const record = latestServerExportRecord(receipt?.shipmentId === shipmentId ? receipt.record : null, preview?.recentExport);
  const canDownload = !loading && !downloading && invalidatedKey !== key &&
    canDownloadExport(preview, shipmentRevision, shipmentStatus, hasUnsavedChanges);
  const revisionChanged = preview && preview.currentRevision !== shipmentRevision;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/shipments/${shipmentId}/export?preview=1`, {
          cache: "no-store",
          signal: abort.signal,
        });
        const body: unknown = await response.json();
        // A guarded 422 is a valid preview. Authentication and transport failures are not.
        if ((!response.ok && response.status !== 422) || !isExportPreviewResponse(body)) {
          const error = body && typeof body === "object" && "error" in body ? String(body.error) : "The server did not return a valid export preview.";
          throw new Error(error);
        }
        if (!abort.signal.aborted) setLoaded({ key, data: body });
      } catch (error) {
        if (!abort.signal.aborted) setLoaded({ key, error: error instanceof Error ? error.message : "Export preview could not be loaded." });
      }
    })();
    return () => abort.abort();
  }, [isOpen, key, shipmentId]);

  async function readReceipt(eventId: string | null): Promise<ExportRecordSummary | null> {
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/export?preview=1`, { cache: "no-store" });
      const body: unknown = await response.json();
      if ((response.ok || response.status === 422) && isExportPreviewResponse(body)) {
        const recent = body.recentExport;
        if (eventId && recent?.id === eventId) return recent;
      }
    } catch {
      // The event ID in the CSV response is real; never invent actor, revision or timestamp data.
    }
    return null;
  }

  async function downloadCsv() {
    if (!canDownload || !preview || downloadInFlight.current) return;
    downloadInFlight.current = true;
    setDownloading(true);
    setFeedback(null);
    let serverExported = false;
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/export`, { cache: "no-store" });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string; blockers?: string[]; blockerDetails?: ExportPreviewData["blockerDetails"] } | null;
        if (error?.blockers) {
          setLoaded({ key, data: { ...preview, ready: false, allowed: false, blockers: error.blockers, blockerDetails: error.blockerDetails } });
        }
        throw new Error(error?.error ?? "The server blocked this export. Refresh the preflight and review the current blockers.");
      }
      serverExported = true;
      const checksum = response.headers.get("X-Checksum-Sha256");
      const profile = response.headers.get("X-Export-Profile");
      const eventId = response.headers.get("X-Export-Event-Id");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = disposition.match(/filename="?([^";]+)"?/)?.[1];
      const blob = await response.blob();
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const actualChecksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const snapshotMatches = exportSnapshotMatches(preview, { checksum, profile, fileName, contentType: response.headers.get("Content-Type") }, actualChecksum);
      const savedReceipt = await readReceipt(eventId);
      if (savedReceipt) setReceipt({ shipmentId, record: savedReceipt });

      if (snapshotMatches && fileName) {
        if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
        const downloadUrl = URL.createObjectURL(blob);
        downloadUrlRef.current = downloadUrl;
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setFeedback({
          kind: savedReceipt ? "success" : "warning",
          message: savedReceipt
            ? "CSV download started. The server export receipt is shown below."
            : `CSV download started, but the complete audit receipt could not be read.${eventId ? ` Server event: ${eventId}.` : ""} Refresh the preflight to retrieve it.`,
        });
      } else {
        setInvalidatedKey(key);
        setFeedback({ kind: "warning", message: "The server exported a different saved snapshot than this preview. No file was downloaded. Refresh the workspace and preflight before continuing; the server export event is retained." });
      }
      onExportSuccess?.(savedReceipt);
    } catch (error) {
      setInvalidatedKey(key);
      setFeedback({
        kind: "error",
        message: `${error instanceof Error ? `${error.message} ` : "The export response was interrupted. "}Refresh the workspace and preflight to check the server record before retrying.`,
      });
      if (serverExported) onExportSuccess?.(null);
      else onRequestRefresh?.();
    } finally {
      downloadInFlight.current = false;
      setDownloading(false);
    }
  }

  async function copyChecksum(hash: string) {
    setChecksumCopy(await copyExportChecksum(hash));
  }

  function refreshPreflight() {
    if (downloading) return;
    setFeedback(null);
    setChecksumCopy(null);
    setAttempt((value) => value + 1);
  }

  return (
    <dialog
      ref={dialogRef}
      data-testid="export-preview-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={downloading || undefined}
      onCancel={(event) => { event.preventDefault(); if (!downloadInFlight.current) onClose(); }}
      onClose={(event) => { if (isOpen && !event.currentTarget.open) onClose(); }}
      className="fixed inset-0 m-auto w-[calc(100vw_-_2rem)] max-w-3xl overflow-hidden rounded-dialog border-0 bg-surface p-0 text-foreground shadow-overlay backdrop:bg-foreground/35"
    >
      <div className="flex max-h-[calc(100dvh_-_2rem)] min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-semibold">Export preview</h2>
            <p id={`${id}-description`} className="mt-1 break-words text-sm text-foreground-secondary">
              <span className="font-mono">{shipmentReference}</span> · Saved revision {shipmentRevision}
            </p>
          </div>
          <Button ref={closeRef} type="button" variant="ghost" size="icon" disabled={downloading} aria-label="Close export preview" onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {loading ? <FeedbackState kind="loading" title="Checking export readiness" description="Reading approval, current checks and the saved revision from the server." className="py-4" /> : current?.error ? (
            <FeedbackState kind="error" title="Export preview unavailable" description={current.error} className="py-4" action={<Button type="button" variant="outline" onClick={refreshPreflight}>Retry preflight</Button>} />
          ) : null}

          {hasUnsavedChanges ? <div role="alert" className="rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning">Download is blocked while there are unsaved drafts or a pending workspace refresh. Close this preview, then save, discard or refresh your review.</div> : null}
          {revisionChanged ? <div role="alert" className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning"><p>The server is on revision {preview.currentRevision}; this workspace shows revision {shipmentRevision}. No download is allowed until you review the latest revision.</p><Button type="button" variant="outline" size="sm" onClick={onRequestRefresh}>Refresh latest shipment</Button></div> : null}
          {feedback ? <p role={feedback.kind === "success" ? "status" : "alert"} className={feedback.kind === "success" ? "text-sm text-success" : feedback.kind === "warning" ? "break-words text-sm text-warning" : "break-words text-sm text-danger"}>{feedback.message}</p> : null}
          {checksumCopy?.error ? <p role="alert" className="break-words text-sm text-danger">{checksumCopy.error}</p> : null}

          {preview ? <>
            <section className={`space-y-2 rounded-control border p-3 ${preview.ready && preview.allowed && preview.blockers.length === 0 ? "border-neutral-border bg-neutral-surface text-neutral" : "border-warning-border bg-warning-surface text-warning"}`} aria-label="Export readiness">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">{preview.ready && preview.allowed && preview.blockers.length === 0 ? "Ready to export" : "Export is blocked"}</h3><Badge variant="outline">{preview.profileId} · v{preview.profileVersion}</Badge></div>
              <p className="text-sm">{preview.ready && preview.allowed && preview.blockers.length === 0 ? `Revision ${preview.approvedRevision} is approved. The download is verified against this preview.` : `Resolve ${preview.blockers.length} issue${preview.blockers.length === 1 ? "" : "s"} below before downloading.`}</p>
            </section>

            <section className="space-y-3" aria-label="Approval and revision">
              <h3 className="text-base font-semibold">Approval and revision</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div><dt className="text-foreground-secondary">Shipment status</dt><dd className="mt-1"><StatusBadge status={preview.shipmentStatus} /></dd></div>
                <div><dt className="text-foreground-secondary">Approved revision</dt><dd className="mt-1 font-mono">{preview.approvedRevision === null ? "Not approved" : preview.approvedRevision}</dd></div>
                <div><dt className="text-foreground-secondary">Approved at</dt><dd className="mt-1">{preview.approvedAt ? displayDate(preview.approvedAt) : "Not approved"}</dd></div>
                <div><dt className="text-foreground-secondary">Approved by</dt><dd className="mt-1 break-words">{preview.approvedBy ?? "No manager approval"}</dd></div>
              </dl>
            </section>

            {!preview.ready || !preview.allowed || preview.blockers.length > 0 ? <section className="space-y-3 border-t border-border pt-4" aria-label="Export blockers">
              <h3 className="text-base font-semibold text-danger">Export blocked · {preview.blockers.length} issue{preview.blockers.length === 1 ? "" : "s"}</h3>
              <ul className="space-y-3">{preview.blockers.map((code, index) => {
                const blocker = formatExportBlocker(code);
                const detail = preview.blockerDetails?.find((entry) => entry.code === code)?.detail;
                return <li key={`${code}-${index}`} className="space-y-1 border-t border-border pt-3 text-sm">
                  <h4 className="font-medium">{blocker.title}</h4>
                  <p className="text-foreground-secondary">{blocker.description}</p>
                  {detail ? <p className="break-words text-danger">{detail}</p> : null}
                  <p className="break-words font-mono text-xs text-muted-foreground">{code}</p>
                </li>;
              })}</ul>
            </section> : null}

            <section className="space-y-2 border-t border-border pt-4" aria-label="Export profile assumption"><h3 className="text-base font-semibold">Import layout</h3><p className="text-sm leading-6 text-foreground-secondary">{preview.assumptionLabel}</p></section>

            {preview.headers ? <section className="space-y-3 border-t border-border pt-4" aria-label="CSV preview">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">CSV preview</h3><p className="text-sm text-foreground-secondary">{preview.rowCount === undefined ? "Total row count not recorded" : `${preview.rowCount} rows`} · {preview.headers.length} columns{preview.rowCount !== undefined && preview.rows && preview.rowCount > preview.rows.length ? ` · showing first ${preview.rows.length}` : ""}</p></div>
              <Table containerLabel="Scrollable CSV preview" containerClassName="max-h-72" className="w-max min-w-full font-mono">
                <TableHeader><TableRow>{preview.headers.map((header, index) => <TableHead key={`${header}-${index}`} className="whitespace-nowrap">{header}</TableHead>)}</TableRow></TableHeader>
                <TableBody>{preview.rows?.length ? preview.rows.map((row, rowIndex) => <TableRow key={rowIndex}>{row.map((cell, columnIndex) => <TableCell key={columnIndex} className="max-w-80 break-words">{cell || <span className="font-sans text-muted-foreground">Empty</span>}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={preview.headers.length}>No export rows were returned.</TableCell></TableRow>}</TableBody>
              </Table>
              {preview.checksumSha256 ? <p className="break-all text-sm text-foreground-secondary">Preview SHA-256: <span className="font-mono">{preview.checksumSha256}</span></p> : null}
            </section> : null}
          </> : null}

          {record ? <section className="space-y-3 border-t border-border pt-4" aria-label="Server export receipt">
            <h3 className="text-base font-semibold">Most recent server export</h3>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-foreground-secondary">File</dt><dd className="mt-1 break-words font-mono">{record.fileName ?? "Not recorded"}</dd></div>
              <div><dt className="text-foreground-secondary">Recorded at</dt><dd className="mt-1">{displayDate(record.createdAt)}</dd></div>
              <div><dt className="text-foreground-secondary">Profile / revision</dt><dd className="mt-1 break-words font-mono">{record.profileId}{record.profileVersion ? ` · v${record.profileVersion}` : ""} · rev {record.revision}{record.rowCount !== null && record.rowCount !== undefined ? ` · ${record.rowCount} rows` : ""}</dd></div>
              <div><dt className="text-foreground-secondary">Exported by</dt><dd className="mt-1 break-words">{record.exportedBy ?? "Not recorded"}</dd></div>
            </dl>
            <p className="break-words font-mono text-xs text-muted-foreground">Event {record.id}</p>
            {record.checksumSha256 ? <div className="space-y-2"><p className="break-all text-sm"><span className="text-foreground-secondary">SHA-256: </span><span className="font-mono">{record.checksumSha256}</span></p><Button type="button" variant="outline" size="sm" onClick={() => void copyChecksum(record.checksumSha256!)}>{checksumCopy?.copiedHash === record.checksumSha256 ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}{checksumCopy?.copiedHash === record.checksumSha256 ? "Checksum copied" : "Copy checksum"}</Button></div> : null}
          </section> : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border p-4 sm:px-6">
          <Button type="button" variant="outline" size="sm" disabled={loading || downloading} onClick={refreshPreflight}><RefreshCw className="size-4" aria-hidden="true" />Refresh preflight</Button>
          <Button type="button" size="sm" disabled={!canDownload} loading={downloading} onClick={() => void downloadCsv()}><Download className="size-4" aria-hidden="true" />{shipmentStatus === "EXPORTED" ? "Re-download CSV" : "Download CSV"}</Button>
        </footer>
      </div>
    </dialog>
  );
}
