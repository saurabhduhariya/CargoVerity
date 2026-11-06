"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { DocumentType } from "@/lib/ai/types";

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
};

export type ShipmentDocumentSlotsProps = {
  shipmentId: string;
  shipmentReference: string;
  initialRevision: number;
  initialDocuments: DocumentSlotItem[];
};

type SlotConfig = {
  type: DocumentType;
  title: string;
  shortCode: string;
  description: string;
  acceptedTypesDescription: string;
  limitsDescription: string;
};

const SLOT_CONFIGS: SlotConfig[] = [
  {
    type: "INVOICE",
    title: "Commercial Invoice",
    shortCode: "CI",
    description: "Itemized billing document with unit prices, totals, currencies, and line items.",
    acceptedTypesDescription: "PDF, PNG, JPEG",
    limitsDescription: "Max 10 MB (up to 50 pages) for PDF · Max 7 MB for images",
  },
  {
    type: "PACKING_LIST",
    title: "Packing List",
    shortCode: "PL",
    description: "Detailed inventory breakdown with package counts, gross/net weights, and SKU quantities.",
    acceptedTypesDescription: "PDF, PNG, JPEG",
    limitsDescription: "Max 10 MB (up to 50 pages) for PDF · Max 7 MB for images",
  },
  {
    type: "BILL_OF_LADING",
    title: "Bill of Lading",
    shortCode: "BL",
    description: "Carrier transport receipt with vessel name, container numbers, ports, and carrier weights.",
    acceptedTypesDescription: "PDF, PNG, JPEG",
    limitsDescription: "Max 10 MB (up to 50 pages) for PDF · Max 7 MB for images",
  },
];

export function formatPlainLanguageError(code?: string, rawMessage?: string): string {
  switch (code) {
    case "STALE_REVISION":
      return "The shipment revision is out of date because it was modified elsewhere. Please refresh the page.";
    case "DUPLICATE_CONTENT":
      return "This exact document file has already been uploaded for this slot.";
    case "DUPLICATE_COMPLETION":
      return "This document upload has already been processed.";
    case "REPLACEMENT_REQUIRED":
      return "A document is already present in this slot. Please check 'Replace existing document' to confirm replacement.";
    case "FILE_OVERSIZED":
      return "The file exceeds the maximum allowed size (10 MB for PDF, 7 MB for images).";
    case "EMPTY_FILE":
      return "The selected file is empty (0 bytes). Please choose a valid file.";
    case "CORRUPTED_PDF":
      return "The PDF file is corrupted or could not be parsed by the system.";
    case "PAGE_LIMIT_EXCEEDED":
      return "The PDF document exceeds the maximum limit of 50 pages.";
    case "PASSWORD_PROTECTED_PDF":
      return "Password-protected PDFs are not supported. Please remove the password and try again.";
    case "INVALID_MAGIC_BYTES":
      return "The file contents do not match its declared file type. Ensure it is a genuine PDF or image.";
    case "INVALID_MIME":
      return "Only PDF (.pdf), PNG (.png), and JPEG (.jpg, .jpeg) documents are accepted.";
    case "OBJECT_NOT_FOUND":
      return "The file was not found in private storage. Please try uploading again.";
    case "UNAUTHORIZED":
      return "You do not have permission to modify this shipment.";
    default:
      return rawMessage || "An unexpected error occurred during document upload.";
  }
}

export function ShipmentDocumentSlots({
  shipmentId,
  shipmentReference,
  initialRevision,
  initialDocuments,
}: ShipmentDocumentSlotsProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentSlotItem[]>(initialDocuments);
  const [currentRevision, setCurrentRevision] = useState(initialRevision);

  // Per-slot upload and error states
  const [slotFiles, setSlotFiles] = useState<Record<DocumentType, File | null>>({
    INVOICE: null,
    PACKING_LIST: null,
    BILL_OF_LADING: null,
  });
  const [slotUploading, setSlotUploading] = useState<Record<DocumentType, string | null>>({
    INVOICE: null,
    PACKING_LIST: null,
    BILL_OF_LADING: null,
  });
  const [slotErrors, setSlotErrors] = useState<Record<DocumentType, string | null>>({
    INVOICE: null,
    PACKING_LIST: null,
    BILL_OF_LADING: null,
  });
  const [slotReplacementModes, setSlotReplacementModes] = useState<Record<DocumentType, boolean>>({
    INVOICE: false,
    PACKING_LIST: false,
    BILL_OF_LADING: false,
  });
  const [replacementConfirmed, setReplacementConfirmed] = useState<Record<DocumentType, boolean>>({
    INVOICE: false,
    PACKING_LIST: false,
    BILL_OF_LADING: false,
  });

  // Preview loading states
  const [previewingDocId, setPreviewingDocId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Sample loader states
  const [sampleScenario, setSampleScenario] = useState<string>("SHP-24811");
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleMessage, setSampleMessage] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  // Find active document for a given slot type
  function getActiveDoc(type: DocumentType): DocumentSlotItem | undefined {
    return documents.find((doc) => doc.docType === type && doc.isCurrent);
  }

  // Handle preview generation using authorized signed URL (TTL 300s)
  async function handlePreview(documentId: string) {
    setPreviewingDocId(documentId);
    setPreviewError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await response.json();
      if (!response.ok || !data.signedUrl) {
        throw new Error(data.error ?? "Failed to generate secure preview URL.");
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : "Failed to generate authorized preview URL.",
      );
    } finally {
      setPreviewingDocId(null);
    }
  }

  // Upload handler exercising the two-step private storage capability
  async function handleUpload(type: DocumentType) {
    const file = slotFiles[type];
    if (!file) {
      setSlotErrors((prev) => ({ ...prev, [type]: "Please select a file to upload." }));
      return;
    }

    const isReplacing = slotReplacementModes[type];
    if (isReplacing && !replacementConfirmed[type]) {
      setSlotErrors((prev) => ({
        ...prev,
        [type]: "Please check the confirmation box to authorize replacing the active document.",
      }));
      return;
    }

    setSlotErrors((prev) => ({ ...prev, [type]: null }));

    // Client-side pre-validation
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    const isJpeg =
      file.type === "image/jpeg" ||
      file.name.toLowerCase().endsWith(".jpg") ||
      file.name.toLowerCase().endsWith(".jpeg");

    if (!isPdf && !isPng && !isJpeg) {
      setSlotErrors((prev) => ({
        ...prev,
        [type]: "Only PDF (.pdf), PNG (.png), and JPEG (.jpg, .jpeg) documents are accepted.",
      }));
      return;
    }

    const declaredMimeType = isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
    const extension = isPdf ? "pdf" : isPng ? "png" : "jpg";
    const maxBytes = isPdf ? 10 * 1024 * 1024 : 7 * 1024 * 1024;

    if (file.size === 0) {
      setSlotErrors((prev) => ({
        ...prev,
        [type]: "The selected file is empty (0 bytes). Please choose a valid file.",
      }));
      return;
    }

    if (file.size > maxBytes) {
      setSlotErrors((prev) => ({
        ...prev,
        [type]: `The file exceeds the maximum allowed size of ${formatBytes(maxBytes)}.`,
      }));
      return;
    }

    try {
      // 1. Step 1: Request signed upload capability
      setSlotUploading((prev) => ({ ...prev, [type]: "Requesting secure upload authorization…" }));

      const uploadUrlRes = await fetch(`/api/shipments/${shipmentId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSizeBytes: file.size,
          declaredMimeType,
          extension,
          expectedRevision: currentRevision,
        }),
      });

      const uploadUrlData = await uploadUrlRes.json();
      if (!uploadUrlRes.ok) {
        throw new Error(formatPlainLanguageError(uploadUrlData.code, uploadUrlData.error));
      }

      // 2. Step 2: Upload to private Supabase Storage directly via signed capability
      setSlotUploading((prev) => ({ ...prev, [type]: "Uploading file to private storage…" }));

      let storageSuccess = false;
      try {
        const supabase = getSupabaseBrowserClient();
        const { error: storageError } = await supabase.storage
          .from("shipment-documents")
          .uploadToSignedUrl(uploadUrlData.storageKey, uploadUrlData.token, file);

        if (!storageError) {
          storageSuccess = true;
        }
      } catch (clientStorageError) {
        console.warn("Client direct upload encountered error, falling back to server route", clientStorageError);
      }

      // Server fallback if direct browser-to-storage upload failed
      if (!storageSuccess) {
        setSlotUploading((prev) => ({ ...prev, [type]: "Finalizing upload with server storage…" }));
        const formData = new FormData();
        formData.append("file", file);
        formData.append("shipmentId", shipmentId);
        formData.append("documentType", type);

        const serverRes = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        const serverData = await serverRes.json();
        if (!serverRes.ok) {
          throw new Error(formatPlainLanguageError(serverData.code, serverData.error));
        }

        const newDoc: DocumentSlotItem = {
          id: serverData.document.id,
          docType: type,
          documentVersion: serverData.document.documentVersion,
          originalFileName: serverData.document.originalFileName,
          mimeType: serverData.document.mimeType,
          sizeBytes: serverData.document.sizeBytes,
          pageCount: serverData.document.pageCount ?? null,
          extractionStatus: serverData.document.extractionStatus,
          createdAt: serverData.document.createdAt,
          isCurrent: true,
        };

        setDocuments((prev) => [
          ...prev.map((d) => (d.docType === type ? { ...d, isCurrent: false } : d)),
          newDoc,
        ]);
        setCurrentRevision((prev) => prev + 1);
        resetSlotUI(type);
        router.refresh();
        return;
      }

      // 3. Step 3: Complete upload & verify server-observed bytes
      setSlotUploading((prev) => ({
        ...prev,
        [type]: "Validating magic bytes, pages, and recording revision…",
      }));

      const completeRes = await fetch(`/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: uploadUrlData.documentId,
          storageKey: uploadUrlData.storageKey,
          originalFileName: file.name,
          declaredMimeType,
          documentType: type,
          expectedRevision: currentRevision,
          allowReplacement: isReplacing,
        }),
      });

      const completeData = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(formatPlainLanguageError(completeData.code, completeData.error));
      }

      const newDoc: DocumentSlotItem = {
        id: completeData.document.id,
        docType: type,
        documentVersion: completeData.document.documentVersion,
        originalFileName: completeData.document.originalFileName,
        mimeType: completeData.document.mimeType,
        sizeBytes: completeData.document.sizeBytes,
        pageCount: completeData.document.pageCount ?? null,
        extractionStatus: completeData.document.extractionStatus,
        createdAt: completeData.document.createdAt,
        isCurrent: true,
      };

      setDocuments((prev) => [
        ...prev.map((d) => (d.docType === type ? { ...d, isCurrent: false } : d)),
        newDoc,
      ]);
      if (completeData.shipmentRevision) {
        setCurrentRevision(completeData.shipmentRevision);
      }
      resetSlotUI(type);
      router.refresh();
    } catch (err) {
      setSlotErrors((prev) => ({
        ...prev,
        [type]: err instanceof Error ? err.message : "Upload failed.",
      }));
    } finally {
      setSlotUploading((prev) => ({ ...prev, [type]: null }));
    }
  }

  function resetSlotUI(type: DocumentType) {
    setSlotFiles((prev) => ({ ...prev, [type]: null }));
    setSlotReplacementModes((prev) => ({ ...prev, [type]: false }));
    setReplacementConfirmed((prev) => ({ ...prev, [type]: false }));
    setSlotErrors((prev) => ({ ...prev, [type]: null }));
  }

  // Sample loader handler: calls /api/shipments/[id]/load-sample
  async function handleLoadSample() {
    setLoadingSample(true);
    setSampleError(null);
    setSampleMessage(null);

    try {
      const response = await fetch(`/api/shipments/${shipmentId}/load-sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: sampleScenario }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load synthetic sample documents.");
      }

      // Update state with newly loaded synthetic documents
      if (Array.isArray(data.documents)) {
        const loaded: DocumentSlotItem[] = (data.documents as Array<Record<string, unknown>>).map((d) => ({
          id: String(d.id),
          docType: d.docType as DocumentType,
          documentVersion: Number(d.documentVersion),
          originalFileName: String(d.originalFileName),
          mimeType: String(d.mimeType),
          sizeBytes: Number(d.sizeBytes),
          pageCount: typeof d.pageCount === "number" ? d.pageCount : null,
          extractionStatus: String(d.extractionStatus),
          createdAt: String(d.createdAt),
          isCurrent: true,
        }));

        setDocuments((prev) => {
          const loadedTypes = new Set(loaded.map((l) => l.docType));
          const untouched = prev.filter((p) => !loadedTypes.has(p.docType));
          return [...untouched, ...loaded];
        });
      }

      if (data.shipment?.currentRevision) {
        setCurrentRevision(data.shipment.currentRevision);
      }

      setSampleMessage(
        `Successfully loaded synthetic demo documents for ${sampleScenario}. All documents verified and stored in private storage.`,
      );
      router.refresh();
    } catch (err) {
      setSampleError(
        err instanceof Error ? err.message : "Failed to load synthetic documents.",
      );
    } finally {
      setLoadingSample(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Synthetic Demo Loader Section */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-amber-700" />
              <CardTitle className="text-base text-amber-950">
                Synthetic Demo Document Loader
              </CardTitle>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              Synthetic demo
            </span>
          </div>
          <p className="text-xs text-amber-800">
            Load certified synthetic customs documents for demonstration. Every fixture is written to private storage and verified through the real byte and page validation pipeline.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1">
              <label htmlFor="sample-scenario-select" className="text-xs font-medium text-amber-900">
                Select Synthetic Scenario
              </label>
              <select
                id="sample-scenario-select"
                aria-label="Select Synthetic Scenario"
                value={sampleScenario}
                onChange={(e) => setSampleScenario(e.target.value)}
                disabled={loadingSample}
                className="h-9 w-full rounded-md border border-amber-300 bg-white px-3 text-xs text-slate-800 shadow-sm focus:border-amber-500 focus:outline-none"
              >
                <option value="SHP-24811">SHP-24811 — LED Panels (45 kg CI vs PL Discrepancy)</option>
                <option value="SHP-24812">SHP-24812 — Sweden Ball Valves (Consistent Shipment)</option>
                <option value="SHP-24813">SHP-24813 — Synthetic Standard Shipment</option>
                <option value="SHP-24814">SHP-24814 — Low-Confidence Scenario</option>
                <option value="SHP-24815">SHP-24815 — Unreadable Scan Scenario</option>
              </select>
            </div>
            <Button
              type="button"
              onClick={handleLoadSample}
              disabled={loadingSample}
              className="h-9 bg-amber-700 text-xs text-white hover:bg-amber-800"
            >
              {loadingSample ? (
                <>
                  <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                  Loading fixtures into storage…
                </>
              ) : (
                <>
                  <FileUp className="mr-1.5 size-3.5" />
                  Load synthetic documents
                </>
              )}
            </Button>
          </div>

          {sampleMessage ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              <span>{sampleMessage}</span>
            </div>
          ) : null}

          {sampleError ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800">
              <AlertCircle className="size-4 shrink-0 text-red-600" />
              <span>{sampleError}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Global Preview Error Banner */}
      {previewError ? (
        <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-red-600" />
            <span>{previewError}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreviewError(null)}
            className="h-6 text-xs text-red-700 hover:text-red-900"
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* Document Slots Section */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Customs Document Slots</h2>
            <p className="text-xs text-slate-500">
              Upload the three mandatory documents for customs verification of{" "}
              <strong className="text-slate-700">{shipmentReference}</strong>. All documents are stored in private storage with encrypted access.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500">
            Shipment Revision: <strong className="text-slate-900">rev {currentRevision}</strong>
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {SLOT_CONFIGS.map((slot) => {
            const activeDoc = getActiveDoc(slot.type);
            const isReplacing = slotReplacementModes[slot.type];
            const isUploading = slotUploading[slot.type];
            const slotError = slotErrors[slot.type];
            const selectedFile = slotFiles[slot.type];

            return (
              <Card
                key={slot.type}
                className={`flex flex-col justify-between transition-colors ${
                  activeDoc ? "border-slate-300 bg-white" : "border-dashed border-slate-300 bg-slate-50/60"
                }`}
              >
                <div>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-700">
                          {slot.shortCode}
                        </span>
                        <div>
                          <CardTitle className="text-sm font-semibold text-slate-900">
                            {slot.title}
                          </CardTitle>
                          <span className="text-[11px] text-slate-500">
                            {slot.acceptedTypesDescription}
                          </span>
                        </div>
                      </div>

                      {activeDoc && !isReplacing ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300">
                          v{activeDoc.documentVersion} Active
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border border-slate-200">
                          {isReplacing ? "Replacing" : "Empty slot"}
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-slate-500">{slot.description}</p>
                    <div className="rounded border border-slate-200/80 bg-slate-100/60 px-2 py-1 text-[11px] text-slate-500">
                      {slot.limitsDescription}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {/* Active Document Details */}
                    {activeDoc && !isReplacing ? (
                      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                        <div className="flex items-start gap-2.5">
                          <FileText className="size-4 shrink-0 text-blue-600 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-900">
                              {activeDoc.originalFileName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {formatBytes(activeDoc.sizeBytes)} ·{" "}
                              {activeDoc.pageCount
                                ? `${activeDoc.pageCount} ${activeDoc.pageCount === 1 ? "page" : "pages"}`
                                : activeDoc.mimeType}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              Uploaded {new Date(activeDoc.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200">
                          {/* Authorized preview link button */}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={previewingDocId === activeDoc.id}
                            onClick={() => handlePreview(activeDoc.id)}
                            className="h-7 text-xs text-slate-700"
                          >
                            {previewingDocId === activeDoc.id ? (
                              <LoaderCircle className="mr-1.5 size-3 animate-spin text-blue-600" />
                            ) : (
                              <ExternalLink className="mr-1.5 size-3 text-slate-500" />
                            )}
                            Preview
                          </Button>

                          {/* Replacement action */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSlotReplacementModes((prev) => ({ ...prev, [slot.type]: true }));
                              setSlotErrors((prev) => ({ ...prev, [slot.type]: null }));
                            }}
                            className="h-7 text-xs text-blue-700 hover:text-blue-800"
                          >
                            <RefreshCw className="mr-1.5 size-3" />
                            Replace
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {/* Replacement Mode Warning Alert */}
                    {isReplacing ? (
                      <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                        <div className="flex items-start gap-1.5">
                          <ShieldAlert className="size-4 shrink-0 text-amber-700 mt-0.5" />
                          <div>
                            <p className="font-semibold text-amber-950">Replacing Document Version</p>
                            <p className="text-[11px] text-amber-800">
                              Uploading a replacement will create v{(activeDoc?.documentVersion ?? 0) + 1}, increment the shipment revision to rev {currentRevision + 1}, and invalidate prior manager approvals.
                            </p>
                          </div>
                        </div>

                        <label className="flex items-center gap-2 pt-1 text-[11px] font-medium text-amber-950">
                          <input
                            type="checkbox"
                            checked={replacementConfirmed[slot.type]}
                            onChange={(e) =>
                              setReplacementConfirmed((prev) => ({
                                ...prev,
                                [slot.type]: e.target.checked,
                              }))
                            }
                            className="size-3.5 rounded border-amber-400 text-amber-700 focus:ring-amber-500"
                          />
                          Confirm document replacement
                        </label>
                      </div>
                    ) : null}

                    {/* File Picker and Upload Controls (when slot is empty or in replacement mode) */}
                    {(!activeDoc || isReplacing) && (
                      <div className="space-y-2.5">
                        <div className="space-y-1">
                          <label
                            htmlFor={`file-input-${slot.type}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            {isReplacing ? "Select replacement file" : "Upload document"}
                          </label>
                          <input
                            id={`file-input-${slot.type}`}
                            type="file"
                            accept="application/pdf,image/png,image/jpeg"
                            disabled={Boolean(isUploading)}
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              setSlotFiles((prev) => ({ ...prev, [slot.type]: f }));
                              setSlotErrors((prev) => ({ ...prev, [slot.type]: null }));
                            }}
                            className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-slate-800 hover:file:bg-slate-200"
                          />
                        </div>

                        {selectedFile ? (
                          <div className="flex items-center justify-between rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                            <span className="truncate">{selectedFile.name}</span>
                            <span className="shrink-0 text-slate-500">
                              {formatBytes(selectedFile.size)}
                            </span>
                          </div>
                        ) : null}

                        {/* Upload Status / Progress Indicator */}
                        {isUploading ? (
                          <div className="flex items-center gap-2 rounded-md bg-blue-50 p-2 text-xs text-blue-800">
                            <LoaderCircle className="size-3.5 animate-spin text-blue-700" />
                            <span>{isUploading}</span>
                          </div>
                        ) : null}

                        {/* Plain Language Error Message */}
                        {slotError ? (
                          <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                            <div className="flex items-start gap-1.5">
                              <AlertCircle className="size-4 shrink-0 text-red-600 mt-0.5" />
                              <div className="space-y-1">
                                <p className="font-semibold text-red-900">Upload Issue</p>
                                <p>{slotError}</p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSlotErrors((prev) => ({ ...prev, [slot.type]: null }));
                              }}
                              className="mt-2 h-6 text-xs text-red-700 hover:text-red-900"
                            >
                              <RotateCcw className="mr-1 size-3" />
                              Try again
                            </Button>
                          </div>
                        ) : null}

                        {/* Upload & Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!selectedFile || Boolean(isUploading)}
                            onClick={() => handleUpload(slot.type)}
                            className="h-8 text-xs bg-slate-900 text-white hover:bg-slate-800"
                          >
                            {isUploading ? (
                              <>
                                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                                Uploading…
                              </>
                            ) : (
                              <>
                                <FileUp className="mr-1.5 size-3.5" />
                                {isReplacing ? "Upload Replacement" : "Upload Document"}
                              </>
                            )}
                          </Button>

                          {isReplacing ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={Boolean(isUploading)}
                              onClick={() => resetSlotUI(slot.type)}
                              className="h-8 text-xs text-slate-700"
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
