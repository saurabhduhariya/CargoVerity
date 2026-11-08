"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, ArrowRight, Boxes, ChevronDown, ExternalLink, FileUp, LoaderCircle, Play, ReceiptText, RefreshCw, RotateCcw, ShieldAlert, Ship } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Typography } from "@/components/ui/typography";
import { formatBytes } from "@/lib/utils";
import { buildLoginPath } from "@/lib/auth-paths";
import { ExtractionRequestError, runDocumentExtraction } from "@/lib/extraction/client-runner";
import type { DocumentType } from "@/lib/ai/types";
import { formatQueueDate } from "@/features/dashboard/queue-presentation";
import { DocumentDropzone } from "./document-dropzone";

export type DocumentSlotItem = {
  id: string;
  docType: DocumentType;
  documentVersion: number;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  extractionStatus: string;
  createdAt: string | Date;
  isCurrent: boolean;
  typeMismatch?: boolean;
  detectedDocType?: string | null;
  latestRun?: { id: string; status: string; provider: string; model: string; errorCode: string | null; errorMessage: string | null; completedAt: string | Date | null } | null;
  extractedFieldCount?: number;
  reviewRequiredCount?: number;
  lowConfidenceCount?: number;
  unreadablePageCount?: number;
  manualPagesCount?: number;
};

export type SlotExtractionState = "NOT_EXTRACTED" | "EXTRACTING" | "EXTRACTED" | "NEEDS_REVIEW" | "MANUAL_ENTRY" | "FAILED";
export function deriveSlotExtractionState(doc: Pick<DocumentSlotItem, "extractionStatus" | "latestRun" | "reviewRequiredCount">): SlotExtractionState {
  if (doc.latestRun?.status === "PROCESSING" || doc.extractionStatus === "PROCESSING") return "EXTRACTING";
  if (doc.latestRun?.provider === "manual") return "MANUAL_ENTRY";
  if (doc.extractionStatus === "FAILED" || doc.latestRun?.status === "FAILED") return "FAILED";
  if (doc.extractionStatus === "EXTRACTED") return "EXTRACTED";
  if (doc.extractionStatus === "REVIEW_REQUIRED") return doc.reviewRequiredCount === 0 ? "EXTRACTED" : "NEEDS_REVIEW";
  return "NOT_EXTRACTED";
}

const STATE_BADGES = {
  NOT_EXTRACTED: { label: "Not extracted", variant: "default" },
  EXTRACTING: { label: "Extracting…", variant: "info" },
  EXTRACTED: { label: "Extracted", variant: "info" },
  NEEDS_REVIEW: { label: "Extracted · review needed", variant: "warning" },
  MANUAL_ENTRY: { label: "Manual entry", variant: "default" },
  FAILED: { label: "Extraction failed", variant: "error" },
} as const;

export type UploadLimits = { maxPdfBytes: number; maxImageBytes: number; maxPdfPages: number };
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { maxPdfBytes: 10_485_760, maxImageBytes: 7_000_000, maxPdfPages: 50 };
export type ShipmentDocumentSlotsProps = {
  shipmentId: string; shipmentReference: string; initialRevision: number; initialShipmentStatus?: string;
  initialDocuments: DocumentSlotItem[]; limits?: UploadLimits;
};

const SLOT_CONFIGS = [
  { type: "INVOICE", title: "Commercial Invoice", shortCode: "CI", icon: ReceiptText, description: "Parties, prices & line items" },
  { type: "PACKING_LIST", title: "Packing List", shortCode: "PL", icon: Boxes, description: "Packages, quantities & weights" },
  { type: "BILL_OF_LADING", title: "Bill of Lading", shortCode: "BL", icon: Ship, description: "Containers, ports & transport" },
] as const;
export const ACCEPTED_TYPES_DESCRIPTION = "PDF, PNG, JPEG";
export function describeUploadLimits(limits: UploadLimits) {
  return `PDF up to ${formatBytes(limits.maxPdfBytes)} and ${limits.maxPdfPages} pages · PNG/JPEG up to ${formatBytes(limits.maxImageBytes)}`;
}

/** A declaration only: the server verifies actual stored bytes, size, and PDF pages. */
export function declaredMimeForFile(file: { name: string; type: string }) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "application/pdf" as const;
  if (file.type === "image/png" || name.endsWith(".png")) return "image/png" as const;
  if (file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg" as const;
  return null;
}

/** Private signed upload, genuine byte progress, no upsert. Completion validates server-side. */
export function uploadFileToSignedUrl(signedUploadUrl: string, file: Blob, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUploadUrl);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(); }
      else if (xhr.status === 413 || /maximum allowed size|too large/i.test(xhr.responseText)) reject(new Error(formatPlainLanguageError("FILE_OVERSIZED")));
      else if (xhr.status === 415 || /mime type/i.test(xhr.responseText)) reject(new Error(formatPlainLanguageError("INVALID_MIME")));
      else reject(new Error("The file could not be uploaded to private storage. Check your connection and try again."));
    };
    xhr.onerror = () => reject(new Error("The file could not be uploaded to private storage. Check your connection and try again."));
    xhr.send(file);
  });
}

export function formatPlainLanguageError(code?: string, rawMessage?: string): string {
  switch (code) {
    case "STALE_REVISION": return "The shipment revision is out of date because it was modified elsewhere. Please refresh the page.";
    case "DUPLICATE_CONTENT": return "This exact document file has already been uploaded for this slot.";
    case "DUPLICATE_COMPLETION": return "This document upload has already been processed.";
    case "REPLACEMENT_REQUIRED": return "A document is already present in this slot. Please check 'Replace existing document' to confirm replacement.";
    case "FILE_OVERSIZED": return "The file is larger than the maximum allowed size for its type. See the limits shown on the slot.";
    case "INVALID_STORAGE_KEY": return "This upload could not be matched to the shipment. Please upload the file again.";
    case "SHIPMENT_LOCKED": return "This shipment has been exported, so its documents can no longer be changed.";
    case "STORAGE_UNAVAILABLE": return "Private storage is temporarily unavailable. Please try again shortly.";
    case "AUTHENTICATION_REQUIRED": return "Your session has expired. Please sign in again.";
    case "ACCOUNT_NOT_PROVISIONED":
    case "FORBIDDEN": return "Your account is not allowed to change this shipment.";
    case "EMPTY_FILE": return "The selected file is empty (0 bytes). Please choose a valid file.";
    case "CORRUPTED_PDF": return "The PDF file is corrupted or could not be parsed by the system.";
    case "PAGE_LIMIT_EXCEEDED": return "The PDF has more pages than the limit shown on the slot. Split it or upload the relevant pages.";
    case "PASSWORD_PROTECTED_PDF": return "Password-protected PDFs are not supported. Please remove the password and try again.";
    case "INVALID_MAGIC_BYTES": return "The file contents do not match its declared file type. Ensure it is a genuine PDF or image.";
    case "INVALID_MIME": return "Only PDF (.pdf), PNG (.png), and JPEG (.jpg, .jpeg) documents are accepted.";
    case "OBJECT_NOT_FOUND": return "The file was not found in private storage. Please try uploading again.";
    case "UNAUTHORIZED": return "You do not have permission to modify this shipment.";
    case "PROVIDER_UNAVAILABLE":
    case "UNAVAILABLE": return "The AI extraction provider is temporarily unavailable. Retry shortly or enter the values manually.";
    case "RATE_LIMITED":
    case "RATE_LIMIT": return "Provider rate limit reached. Wait a moment before retrying, or enter the values manually.";
    case "QUOTA_EXCEEDED": return "The AI provider's quota or credit is used up. Enter the values manually, or retry after the quota resets.";
    case "TIMEOUT": return "Extraction request timed out before the model could finish. Please retry.";
    case "INVALID_RESPONSE": return "The AI returned output that failed validation, so nothing was saved from it. Retry, or enter the values manually.";
    case "AUTHENTICATION": return "The AI provider rejected the server's credentials. Ask an administrator to check the configuration.";
    case "ABANDONED": return "The previous extraction did not finish (the page may have been closed). Retry the extraction.";
    case "EXTRACTION_LOCKED": return "This shipment is submitted, approved or exported, so extraction cannot be re-run.";
    case "EXTRACTION_IN_PROGRESS": return "An extraction for this document is already running.";
    case "RUN_CLOSED": return "The last extraction run has ended. Use Retry extraction to start a new run.";
    default:
      if (rawMessage && !/^\s*[[{]/.test(rawMessage)) return rawMessage;
      return "An unexpected error occurred during document upload.";
  }
}

type UploadProgress = { phase: "authorizing" | "uploading" | "validating"; percent: number | null };
export function uploadProgressLabel(progress: UploadProgress) {
  if (progress.phase === "authorizing") return "Authorizing private upload…";
  if (progress.phase === "validating") return "Upload transferred. Validating file and saving revision…";
  return `Uploading to private storage… ${progress.percent ?? 0}%`;
}
const emptySlots = <T,>(value: T): Record<DocumentType, T> => ({ INVOICE: value, PACKING_LIST: value, BILL_OF_LADING: value });
const evidenceLink = "inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function ShipmentDocumentSlots({ shipmentId, shipmentReference, initialRevision, initialShipmentStatus = "DRAFT", initialDocuments, limits = DEFAULT_UPLOAD_LIMITS }: ShipmentDocumentSlotsProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [currentRevision, setCurrentRevision] = useState(initialRevision);
  const [shipmentStatus, setShipmentStatus] = useState(initialShipmentStatus);
  const [serverSnapshot, setServerSnapshot] = useState(initialDocuments);
  // Refresh can bring a replacement or review from another session. Never keep an obsolete slot.
  if (serverSnapshot !== initialDocuments) {
    setServerSnapshot(initialDocuments); setDocuments(initialDocuments);
    setCurrentRevision(initialRevision); setShipmentStatus(initialShipmentStatus);
  }
  const [slotFiles, setSlotFiles] = useState(emptySlots<File | null>(null));
  const [slotUploading, setSlotUploading] = useState(emptySlots<UploadProgress | null>(null));
  const [slotErrors, setSlotErrors] = useState(emptySlots<string | null>(null));
  const [slotMessages, setSlotMessages] = useState(emptySlots<string | null>(null));
  const [slotReplacementModes, setSlotReplacementModes] = useState(emptySlots(false));
  const [replacementConfirmed, setReplacementConfirmed] = useState(emptySlots(false));
  const [extractingAll, setExtractingAll] = useState(false);
  const [slotExtracting, setSlotExtracting] = useState(emptySlots<string | null>(null));
  const [retryModalTarget, setRetryModalTarget] = useState<{ type: DocumentType | "ALL"; revision: number; documentIds: string[] } | null>(null);
  const [statusPolling, setStatusPolling] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [previewingDocId, setPreviewingDocId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sampleScenario, setSampleScenario] = useState("SHP-24811");
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleMessage, setSampleMessage] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const pollingRef = useRef(false);

  const getActiveDoc = (type: DocumentType) => documents.find((doc) => doc.docType === type && doc.isCurrent);
  const currentDocs = documents.filter((doc) => doc.isCurrent);
  const totalUploaded = SLOT_CONFIGS.filter((slot) => getActiveDoc(slot.type)).length;
  const allThreeUploaded = totalUploaded === 3;
  const completedCount = currentDocs.filter((doc) => ["EXTRACTED", "NEEDS_REVIEW", "MANUAL_ENTRY"].includes(deriveSlotExtractionState(doc))).length;
  const failedCount = currentDocs.filter((doc) => deriveSlotExtractionState(doc) === "FAILED").length;
  const processingCount = currentDocs.filter((doc) => deriveSlotExtractionState(doc) === "EXTRACTING" || Boolean(slotExtracting[doc.docType])).length;
  const anyUploading = Object.values(slotUploading).some(Boolean);
  const busy = anyUploading || extractingAll || processingCount > 0 || loadingSample;
  const uploadLocked = shipmentStatus === "EXPORTED";
  const extractionLocked = ["READY_FOR_APPROVAL", "APPROVED", "EXPORTED"].includes(shipmentStatus);
  const reviewFlags = currentDocs.reduce((count, doc) => count + (doc.reviewRequiredCount ?? 0) + (doc.unreadablePageCount ?? 0), 0);

  const redirectOnAuthFailure = useCallback((response: Response, data: { code?: string }) => {
    if (response.status === 401) router.replace(buildLoginPath({ reason: "session-expired" }));
    else if (response.status === 403 && data.code === "ACCOUNT_NOT_PROVISIONED") router.replace(buildLoginPath({ reason: "not-provisioned" }));
  }, [router]);

  const pollStatus = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true; setStatusPolling(true);
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/extract`, { cache: "no-store" });
      const data = await response.json();
      redirectOnAuthFailure(response, data);
      if (!response.ok) throw new Error(formatPlainLanguageError(data.code, data.error));
      setStatusError(null);
      if (data.shipmentStatus) setShipmentStatus(data.shipmentStatus);
      if (data.shipmentRevision) setCurrentRevision(data.shipmentRevision);
      if (Array.isArray(data.documents)) setDocuments((previous) => previous.map((doc) => {
        const found = data.documents.find((item: { documentId: string }) => item.documentId === doc.id);
        return found ? { ...doc, extractionStatus: found.extractionStatus, typeMismatch: found.typeMismatch, detectedDocType: found.detectedDocType, latestRun: found.latestRun, extractedFieldCount: found.extractedFieldCount, reviewRequiredCount: found.reviewRequiredCount, lowConfidenceCount: found.lowConfidenceCount, unreadablePageCount: found.unreadablePageCount, manualPagesCount: found.manualPagesCount } : doc;
      }));
    } catch (err) { setStatusError(err instanceof Error ? err.message : "Could not refresh extraction status. Try again."); }
    finally { pollingRef.current = false; setStatusPolling(false); }
  }, [shipmentId, redirectOnAuthFailure]);

  useEffect(() => {
    if (!processingCount && !extractingAll) return;
    const timer = setInterval(() => void pollStatus(), 2500);
    return () => clearInterval(timer);
  }, [processingCount, extractingAll, pollStatus]);

  async function extractSlot(type: DocumentType, retry: boolean) {
    const doc = getActiveDoc(type);
    if (!doc) return;
    setSlotErrors((previous) => ({ ...previous, [type]: null }));
    setSlotExtracting((previous) => ({ ...previous, [type]: "Starting extraction…" }));
    try {
      await runDocumentExtraction({ documentId: doc.id, documentType: type, mimeType: doc.mimeType, retry, onProgress: (step) => setSlotExtracting((previous) => ({ ...previous, [type]: step })) });
    } catch (err) {
      if (err instanceof ExtractionRequestError && err.code === "AUTHENTICATION_REQUIRED") router.replace(buildLoginPath({ reason: "session-expired" }));
      const message = err instanceof ExtractionRequestError ? formatPlainLanguageError(err.code, err.message) : err instanceof Error ? err.message : "Extraction failed. Retry or enter values manually.";
      setSlotErrors((previous) => ({ ...previous, [type]: message }));
    } finally { setSlotExtracting((previous) => ({ ...previous, [type]: null })); }
  }

  async function handleExtraction(type: DocumentType | "ALL", retry = false) {
    if (mutationRef.current || busy || extractionLocked || (type === "ALL" && !allThreeUploaded)) return;
    mutationRef.current = true;
    if (type === "ALL") setExtractingAll(true);
    try {
      for (const slot of SLOT_CONFIGS) {
        if (type !== "ALL" && type !== slot.type) continue;
        const doc = getActiveDoc(slot.type);
        if (!doc) continue;
        const state = deriveSlotExtractionState(doc);
        if (!retry && state !== "NOT_EXTRACTED" && state !== "EXTRACTING") continue;
        await extractSlot(slot.type, retry);
      }
    } finally { await pollStatus(); router.refresh(); setExtractingAll(false); mutationRef.current = false; }
  }

  function openRetry(type: DocumentType | "ALL") {
    setRetryModalTarget({ type, revision: currentRevision, documentIds: currentDocs.filter((doc) => type === "ALL" || doc.docType === type).map((doc) => doc.id) });
  }
  function confirmRetry() {
    const target = retryModalTarget;
    setRetryModalTarget(null);
    if (!target) return;
    const ids = currentDocs.filter((doc) => target.type === "ALL" || doc.docType === target.type).map((doc) => doc.id);
    if (target.revision !== currentRevision || target.documentIds.length !== ids.length || target.documentIds.some((id) => !ids.includes(id)) || busy || extractionLocked) {
      setStatusError("The shipment changed since this retry was opened. Refresh and review the current documents before retrying.");
      return;
    }
    void handleExtraction(target.type, true);
  }

  async function handlePreview(documentId: string) {
    setPreviewingDocId(documentId); setPreviewError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}`, { cache: "no-store" });
      const data = await response.json();
      redirectOnAuthFailure(response, data);
      if (!response.ok || !data.signedUrl) throw new Error(data.error ?? "Could not generate a secure preview. Try again.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) { setPreviewError(err instanceof Error ? err.message : "Could not open the authorized preview."); }
    finally { setPreviewingDocId(null); }
  }

  function resetSlotUI(type: DocumentType) {
    setSlotFiles((previous) => ({ ...previous, [type]: null }));
    setSlotReplacementModes((previous) => ({ ...previous, [type]: false }));
    setReplacementConfirmed((previous) => ({ ...previous, [type]: false }));
    setSlotErrors((previous) => ({ ...previous, [type]: null }));
  }
  async function handleUpload(type: DocumentType) {
    if (mutationRef.current || busy || uploadLocked) return;
    const file = slotFiles[type];
    const isReplacing = slotReplacementModes[type];
    const fail = (message: string) => setSlotErrors((previous) => ({ ...previous, [type]: message }));
    if (!file) { fail("Please select a file to upload."); return; }
    if (isReplacing && !replacementConfirmed[type]) { fail("Please check the confirmation box to authorize replacing the active document."); return; }
    const declaredMimeType = declaredMimeForFile(file);
    if (!declaredMimeType) { fail(formatPlainLanguageError("INVALID_MIME")); return; }
    const maxBytes = declaredMimeType === "application/pdf" ? limits.maxPdfBytes : limits.maxImageBytes;
    if (file.size === 0) { fail(formatPlainLanguageError("EMPTY_FILE")); return; }
    if (file.size > maxBytes) { fail(`The file exceeds the maximum allowed size of ${formatBytes(maxBytes)}.`); return; }
    mutationRef.current = true;
    setSlotErrors((previous) => ({ ...previous, [type]: null }));
    setSlotMessages((previous) => ({ ...previous, [type]: null }));
    const progress = (value: UploadProgress | null) => setSlotUploading((previous) => ({ ...previous, [type]: value }));
    try {
      progress({ phase: "authorizing", percent: null });
      const authorization = await fetch(`/api/shipments/${shipmentId}/documents/upload-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSizeBytes: file.size, documentType: type, declaredMimeType, expectedRevision: currentRevision }) });
      const upload = await authorization.json();
      redirectOnAuthFailure(authorization, upload);
      if (!authorization.ok) throw new Error(formatPlainLanguageError(upload.code, upload.error));
      progress({ phase: "uploading", percent: 0 });
      await uploadFileToSignedUrl(upload.signedUploadUrl, file, declaredMimeType, (percent) => progress({ phase: "uploading", percent }));
      progress({ phase: "validating", percent: null });
      const completion = await fetch(`/api/shipments/${shipmentId}/documents/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: upload.documentId, storageKey: upload.storageKey, originalFileName: file.name, declaredMimeType, documentType: type, expectedRevision: currentRevision, allowReplacement: isReplacing }) });
      const data = await completion.json();
      redirectOnAuthFailure(completion, data);
      if (!completion.ok) throw new Error(formatPlainLanguageError(data.code, data.error));
      const newDoc: DocumentSlotItem = { id: data.document.id, docType: type, documentVersion: data.document.documentVersion, originalFileName: data.document.originalFileName, mimeType: data.document.mimeType, sizeBytes: data.document.sizeBytes, pageCount: data.document.pageCount ?? null, extractionStatus: data.document.extractionStatus, createdAt: data.document.createdAt, isCurrent: true };
      setDocuments((previous) => [...previous.map((doc) => doc.docType === type ? { ...doc, isCurrent: false } : doc), newDoc]);
      if (data.shipmentRevision) setCurrentRevision(data.shipmentRevision);
      resetSlotUI(type);
      setSlotMessages((previous) => ({ ...previous, [type]: `Version ${newDoc.documentVersion} saved. Ready to extract.` }));
      await pollStatus(); router.refresh();
    } catch (err) { fail(err instanceof Error ? err.message : "Upload failed. Select the file and try again."); }
    finally { progress(null); mutationRef.current = false; }
  }

  async function handleLoadSample() {
    if (mutationRef.current || busy || uploadLocked) return;
    mutationRef.current = true; setLoadingSample(true); setSampleError(null); setSampleMessage(null);
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/load-sample`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: sampleScenario, expectedRevision: currentRevision }) });
      const data = await response.json();
      redirectOnAuthFailure(response, data);
      if (!response.ok) throw new Error(data.code === "DUPLICATE_CONTENT" ? "These synthetic documents are already loaded for this shipment." : formatPlainLanguageError(data.code, data.error));
      if (Array.isArray(data.documents)) {
        const loaded: DocumentSlotItem[] = data.documents.map((doc: DocumentSlotItem) => ({ ...doc, isCurrent: true }));
        setDocuments((previous) => [...previous.filter((doc) => !loaded.some((item) => item.docType === doc.docType)), ...loaded]);
      }
      if (data.shipment?.currentRevision) setCurrentRevision(data.shipment.currentRevision);
      if (data.shipment?.status) setShipmentStatus(data.shipment.status);
      setSampleMessage(`${sampleScenario} sample documents loaded. Ready to extract.`);
      router.refresh();
    } catch (err) { setSampleError(err instanceof Error ? err.message : "Could not load synthetic documents. Try again."); }
    finally { setLoadingSample(false); mutationRef.current = false; }
  }

  return <div className="space-y-6">
    <ConfirmDialog open={Boolean(retryModalTarget)} onClose={() => setRetryModalTarget(null)} onConfirm={confirmRetry} title="Confirm AI extraction retry" confirmLabel="Confirm & run retry" description="Retrying uses the configured provider's API quota and may incur costs. Earlier extraction runs and review history are preserved. Re-running can change review flags and shipment readiness.">
      <p className="text-sm text-foreground-secondary">{retryModalTarget?.type === "ALL" ? "All three current documents will be re-extracted." : "Only the selected current document will be re-extracted."} Review the new output before submitting.</p>
    </ConfirmDialog>

    <section aria-label={`Documents for ${shipmentReference}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <Typography id="documents-heading" variant="section-title">Documents</Typography>
          <p className="mt-0.5 text-sm text-foreground-secondary"><span className="font-mono tabular-nums text-foreground">{totalUploaded}/3</span> uploaded · <span className="font-mono tabular-nums text-foreground">{completedCount}/3</span> extracted{processingCount > 0 ? ` · ${processingCount} processing` : ""}<span className="text-muted-foreground"> · </span><span className={failedCount > 0 ? "text-danger" : reviewFlags > 0 && completedCount === 3 ? "text-warning" : undefined}>{uploadLocked ? "Exported. Documents are read-only." : extractionLocked ? "Extraction is locked for the submitted revision." : totalUploaded < 3 ? `Missing ${SLOT_CONFIGS.filter((slot) => !getActiveDoc(slot.type)).map((slot) => slot.title).join(", ")}.` : failedCount > 0 ? `${failedCount} extraction${failedCount === 1 ? "" : "s"} failed. Retry or enter values manually.` : processingCount > 0 ? "Extracting…" : completedCount === 3 ? `${reviewFlags} field${reviewFlags === 1 ? "" : "s"} to review.` : "Ready to extract."}</span></p>
        </div>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="icon" aria-label="Refresh status" title="Refresh status" loading={statusPolling} onClick={() => { void pollStatus(); router.refresh(); }}>{statusPolling ? null : <RefreshCw aria-hidden="true" className="size-4" />}</Button><Button type="button" variant={completedCount === 3 ? "outline" : "default"} disabled={!allThreeUploaded || busy || extractionLocked} onClick={() => completedCount === 3 || failedCount > 0 ? openRetry("ALL") : void handleExtraction("ALL")}><Play aria-hidden="true" className="size-4" />{processingCount > 0 || extractingAll ? "Extracting documents…" : completedCount === 3 ? "Re-run extraction" : failedCount > 0 ? "Retry extraction" : "Run extraction (3 documents)"}</Button></div>
      </div>
      {statusError ? <div role="alert" className="rounded-panel border border-danger-border bg-danger-surface p-4 text-sm text-danger">{statusError}<Button type="button" variant="link" onClick={() => { void pollStatus(); router.refresh(); }}>Refresh and retry</Button></div> : null}
      {previewError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger-border bg-danger-surface p-4 text-sm text-danger"><p>{previewError}</p><Button type="button" variant="ghost" onClick={() => setPreviewError(null)}>Dismiss</Button></div> : null}

      <div className="grid items-stretch gap-3 lg:grid-cols-3">
        {SLOT_CONFIGS.map((slot) => {
          const activeDoc = getActiveDoc(slot.type);
          const isReplacing = slotReplacementModes[slot.type];
          const upload = slotUploading[slot.type];
          const selectedFile = slotFiles[slot.type];
          const extractingStep = slotExtracting[slot.type];
          const state = activeDoc ? deriveSlotExtractionState(activeDoc) : "NOT_EXTRACTED";
          const badge = STATE_BADGES[extractingStep ? "EXTRACTING" : state];
          const error = slotErrors[slot.type];
          const reviewHref = activeDoc ? `/review/${activeDoc.id}` : `/review/${shipmentId}`;
          return <section key={slot.type} data-testid={`slot-${slot.type}`} aria-labelledby={`slot-title-${slot.type}`} aria-busy={Boolean(upload || extractingStep) || undefined} className="flex min-w-0 flex-col rounded-panel border border-border bg-surface">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5"><slot.icon aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.5} /><Typography as="h3" id={`slot-title-${slot.type}`} className="min-w-0 truncate font-semibold">{slot.title}</Typography><span className="ml-auto flex shrink-0 items-center gap-2">{activeDoc && !isReplacing ? <><span className="font-mono text-xs text-muted-foreground">Version {activeDoc.documentVersion}</span><Badge data-testid={`extraction-state-${slot.type}`} variant={badge.variant}>{badge.label}</Badge></> : isReplacing ? <span className="text-xs text-warning">Replacing</span> : <span className="text-xs text-muted-foreground">Not uploaded</span>}</span></div>
            <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
              {activeDoc && !isReplacing ? <>
                <div className="min-w-0"><p className="break-all text-sm font-medium">{activeDoc.originalFileName}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{formatBytes(activeDoc.sizeBytes)} · {activeDoc.pageCount ? `${activeDoc.pageCount} ${activeDoc.pageCount === 1 ? "page" : "pages"}` : activeDoc.mimeType} · {formatQueueDate(activeDoc.createdAt)}</p></div>
                {extractingStep || state === "EXTRACTING" ? <div role="status" className="flex items-start gap-2 rounded-control bg-info-surface p-3 text-sm text-info"><LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" /><p>{extractingStep ?? "Extraction in progress. Waiting for the provider's saved result…"}</p></div> : null}
                {activeDoc.typeMismatch ? <div className="space-y-2 rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning"><p className="flex items-start gap-2 font-medium"><AlertTriangle aria-hidden="true" className="size-4 shrink-0" />Document type mismatch</p><p>Expected {slot.title}; the model detected {activeDoc.detectedDocType ?? "an unknown type"}. This is a model estimate.</p><Link href={reviewHref} className={evidenceLink}>Inspect evidence<ArrowRight aria-hidden="true" className="size-4" /></Link><Button type="button" variant="outline" disabled={busy || uploadLocked} onClick={() => { setSlotReplacementModes((previous) => ({ ...previous, [slot.type]: true })); setSlotErrors((previous) => ({ ...previous, [slot.type]: null })); }}>Re-upload document</Button></div> : null}
                {(activeDoc.unreadablePageCount ?? 0) > 0 ? <div className="rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning"><p>{activeDoc.unreadablePageCount} unreadable page(s) flagged.</p><Link href={reviewHref} className={evidenceLink}>Inspect & enter manually<ArrowRight aria-hidden="true" className="size-4" /></Link></div> : null}
                {["EXTRACTED", "NEEDS_REVIEW", "MANUAL_ENTRY"].includes(state) || (activeDoc.extractedFieldCount ?? 0) > 0 ? <div className="space-y-1 rounded-control bg-background px-3 py-2.5"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><p data-testid={`field-count-${slot.type}`} className="text-sm font-medium">{activeDoc.extractedFieldCount ?? 0} {state === "MANUAL_ENTRY" ? "fields available" : "fields extracted"}</p><p className={`text-sm ${(activeDoc.reviewRequiredCount ?? 0) > 0 ? "font-medium text-warning" : "text-foreground-secondary"}`}>{activeDoc.reviewRequiredCount ?? 0} fields require review</p></div>{(activeDoc.lowConfidenceCount ?? 0) > 0 ? <p data-testid={`low-confidence-${slot.type}`} className="text-xs text-foreground-secondary">{activeDoc.lowConfidenceCount} low-confidence model estimate(s); saved review decisions take precedence.</p> : null}<Link href={reviewHref} className={evidenceLink}>Review fields<ArrowRight aria-hidden="true" className="size-4" /></Link></div> : null}
                {state === "FAILED" && !extractingStep ? <div role="alert" className="space-y-2 rounded-control border border-danger-border bg-danger-surface p-3 text-sm text-danger"><p className="font-medium">Extraction failed ({activeDoc.latestRun?.errorCode ?? "ERROR"})</p><p>{formatPlainLanguageError(activeDoc.latestRun?.errorCode ?? undefined, activeDoc.latestRun?.errorMessage ?? undefined)}</p><Link href={reviewHref} className={evidenceLink}>Enter values manually<ArrowRight aria-hidden="true" className="size-4" /></Link></div> : null}
                <div className="order-first flex flex-wrap gap-2 lg:order-none lg:mt-auto"><Button type="button" variant={state === "NOT_EXTRACTED" ? "default" : "outline"} size="sm" disabled={busy || extractionLocked} onClick={() => state === "NOT_EXTRACTED" ? void handleExtraction(slot.type) : openRetry(slot.type)}>{state === "NOT_EXTRACTED" ? <Play aria-hidden="true" className="size-4" /> : <RotateCcw aria-hidden="true" className="size-4" />}{state === "NOT_EXTRACTED" ? "Run extraction" : "Retry extraction"}</Button><Button type="button" variant="outline" size="sm" loading={previewingDocId === activeDoc.id} onClick={() => void handlePreview(activeDoc.id)}><ExternalLink aria-hidden="true" className="size-4" />Preview</Button><Button type="button" variant="ghost" size="sm" disabled={busy || uploadLocked} onClick={() => { setSlotReplacementModes((previous) => ({ ...previous, [slot.type]: true })); setSlotErrors((previous) => ({ ...previous, [slot.type]: null })); setSlotMessages((previous) => ({ ...previous, [slot.type]: null })); }}>Replace</Button></div>
              </> : <>
                {isReplacing ? <div className="space-y-3 rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning"><p className="flex items-start gap-2 font-medium"><ShieldAlert aria-hidden="true" className="size-4 shrink-0" />Replace version {activeDoc?.documentVersion}</p><p>Creates a new version and resets approval. The previous document stays in history.</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={replacementConfirmed[slot.type]} disabled={busy || uploadLocked} onChange={(event) => setReplacementConfirmed((previous) => ({ ...previous, [slot.type]: event.target.checked }))} className="size-4 shrink-0" />Confirm document replacement</label></div> : null}
                <DocumentDropzone id={`file-input-${slot.type}`} title={isReplacing ? "Select replacement file" : "Upload document"} file={selectedFile} disabled={busy || uploadLocked} invalid={Boolean(error)} describedBy={`upload-limits-${slot.type}${error ? ` slot-error-${slot.type}` : ""}`} onSelect={(file) => { setSlotFiles((previous) => ({ ...previous, [slot.type]: file })); setSlotErrors((previous) => ({ ...previous, [slot.type]: null })); }} onError={(message) => setSlotErrors((previous) => ({ ...previous, [slot.type]: message }))} />
                {upload ? <div className="space-y-2 rounded-control bg-info-surface p-3"><p role="status" className="text-sm text-info">{uploadProgressLabel(upload)}</p><progress aria-label={`${slot.title} upload progress`} max={100} value={upload.phase === "uploading" ? upload.percent ?? 0 : undefined} className="h-2 w-full accent-primary" /><p className="text-xs text-info">{upload.phase === "validating" ? "A completed transfer is not yet a saved document." : "The file is sent directly to private storage."}</p></div> : null}
                <div className="mt-auto flex flex-wrap gap-2"><Button type="button" size="sm" loading={Boolean(upload)} disabled={!selectedFile || (busy && !upload) || uploadLocked} onClick={() => void handleUpload(slot.type)}><FileUp aria-hidden="true" className="size-4" />{isReplacing ? "Upload Replacement" : "Upload Document"}</Button>{isReplacing ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => resetSlotUI(slot.type)}>Cancel</Button> : null}</div>
              </>}
              {error && (state !== "FAILED" || error !== formatPlainLanguageError(activeDoc?.latestRun?.errorCode ?? undefined, activeDoc?.latestRun?.errorMessage ?? undefined)) ? <p id={`slot-error-${slot.type}`} role="alert" data-testid={`slot-error-${slot.type}`} className="flex items-start gap-2 rounded-control border border-danger-border bg-danger-surface p-3 text-sm text-danger"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>{error}</span></p> : null}
              {slotMessages[slot.type] && !isReplacing ? <p role="status" className="text-sm text-success">{slotMessages[slot.type]}</p> : null}
              {!activeDoc || isReplacing ? <p id={`upload-limits-${slot.type}`} data-testid={`upload-limits-${slot.type}`} className="text-xs text-muted-foreground">{ACCEPTED_TYPES_DESCRIPTION} · {describeUploadLimits(limits)}</p> : null}
            </div>
          </section>;
        })}
      </div>
    </section>

    <details className="group rounded-panel border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 rounded-control px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>Load synthetic sample documents</span><span className="flex items-center gap-2"><Badge>Synthetic demo</Badge><ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180" /></span></summary>
      <div className="space-y-4 border-t border-border p-4 sm:p-5"><p className="max-w-prose text-sm text-foreground-secondary">Documents generated from the brief&rsquo;s sample data. Not for customs filing.</p><div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor="sample-scenario-select">Sample scenario</Label><Select id="sample-scenario-select" value={sampleScenario} disabled={busy || uploadLocked} onChange={(event) => setSampleScenario(event.target.value)}><option value="SHP-24811">SHP-24811 — LED Panels (45 kg discrepancy)</option><option value="SHP-24812">SHP-24812 — Sweden Ball Valves (consistent)</option><option value="SHP-24813">SHP-24813 — Standard shipment</option><option value="SHP-24814">SHP-24814 — Low-confidence scenario</option><option value="SHP-24815">SHP-24815 — Unreadable scan scenario</option></Select></div><Button type="button" variant="outline" loading={loadingSample} disabled={busy || uploadLocked} onClick={() => void handleLoadSample()}><FileUp aria-hidden="true" className="size-4" />Load synthetic documents</Button></div>{sampleMessage ? <p role="status" className="text-sm text-success">{sampleMessage}</p> : null}{sampleError ? <p role="alert" className="text-sm text-danger">{sampleError}</p> : null}</div>
    </details>
  </div>;
}
