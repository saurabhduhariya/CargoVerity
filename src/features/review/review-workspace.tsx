"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Lock,
  Package,
  PlusCircle,
  RefreshCw,
  RotateCw,
  Save,
  Scale,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ReviewWorkspaceField = {
  id: string;
  fieldKey: string;
  modelValue: string | null;
  currentValue: string | null;
  unit: string | null;
  modelConfidence: number | string | null;
  sourceQuote: string | null;
  pageNumber: number | null;
  reviewStatus: string;
  reviewReason?: string | null;
};

export type ReviewWorkspaceLineItem = {
  id: string;
  lineNumber?: number;
  description: string | null;
  hsnCode?: string | null;
  sku?: string | null;
  quantity: string | number | null;
  quantityUnit: string | null;
  unitPrice?: string | number | null;
  lineTotal: string | number | null;
  currency: string | null;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type ReviewWorkspacePage = {
  id: string;
  pageNumber: number;
  isReadable: boolean;
  manualEntryRequired: boolean;
  reviewNote: string | null;
};

export type ReviewWorkspaceDocument = {
  id: string;
  docType: "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";
  originalFileName: string;
  mimeType: string;
  documentVersion: number;
  pageCount: number | null;
  signedUrl: string;
  pages: ReviewWorkspacePage[];
  fields: ReviewWorkspaceField[];
  lineItems: ReviewWorkspaceLineItem[];
  extractionStatus: string;
  latestRunId?: string | null;
};

export type ReviewWorkspaceCrossCheck = {
  id?: string;
  ruleKey: string;
  ruleCode?: string;
  status: "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
  severity?: "BLOCKING" | "WARNING";
  effectiveStatus?: string;
  details: {
    message?: string;
    note?: string;
    difference?: string | null;
    differenceKg?: string | null;
    comparedValuesKg?: Record<string, string>;
    unreconciledReason?: string;
    [key: string]: unknown;
  };
};

export type ReviewWorkspaceInitialData = {
  shipment: {
    id: string;
    reference: string;
    status: string;
    currentRevision: number;
    importerName?: string | null;
    exporterName?: string | null;
    supplier?: { id: string; name: string } | null;
  };
  documents: ReviewWorkspaceDocument[];
  crossChecks: ReviewWorkspaceCrossCheck[];
};

export type FieldCategory = "parties" | "identifiers" | "commercial" | "logistics" | "other";

export function categorizeFieldKey(fieldKey: string): FieldCategory {
  const k = fieldKey.toLowerCase();
  if (
    k.includes("exporter") ||
    k.includes("importer") ||
    k.includes("shipper") ||
    k.includes("consignee") ||
    k.includes("notify") ||
    k.includes("carrier")
  ) {
    return "parties";
  }
  if (
    k.includes("number") ||
    k.includes("code") ||
    k.includes("reference") ||
    k.includes("date") ||
    k.includes("invnum") ||
    k.includes("blnum")
  ) {
    return "identifiers";
  }
  if (
    k.includes("weight") ||
    k.includes("package") ||
    k.includes("vessel") ||
    k.includes("voyage") ||
    k.includes("port") ||
    k.includes("container") ||
    k.includes("delivery") ||
    k.includes("loading") ||
    k.includes("discharge")
  ) {
    return "logistics";
  }
  if (
    k.includes("total") ||
    k.includes("amount") ||
    k.includes("price") ||
    k.includes("currency") ||
    k.includes("tax") ||
    k.includes("freight") ||
    k.includes("insurance") ||
    k.includes("discount") ||
    (!k.includes("discharge") && k.includes("charge"))
  ) {
    return "commercial";
  }
  return "other";
}

export function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

export function isFieldUncertain(
  field: Pick<ReviewWorkspaceField, "modelConfidence" | "reviewStatus" | "sourceQuote">,
): boolean {
  const conf = Number(field.modelConfidence);
  return (
    !Number.isFinite(conf) ||
    conf < 0.85 ||
    field.reviewStatus === "REQUIRES_REVIEW" ||
    !field.sourceQuote
  );
}

export function calculateNextZoom(current: number, direction: "in" | "out"): number {
  if (direction === "in") return Math.min(current + 25, 200);
  return Math.max(current - 25, 50);
}

export function calculateNextRotation(current: number): number {
  return (current + 90) % 360;
}

export function isAllowedPreApprovalStatus(status: string): boolean {
  return status !== "APPROVED" && status !== "EXPORTED";
}

export function validateFieldCorrection(
  action: "CONFIRMED" | "CORRECTED" | "MANUAL_ENTRY",
  value: string | null | undefined,
  currentValue: string | null | undefined,
  reason: string | null | undefined,
): { valid: boolean; error?: string; isMaterialChange: boolean } {
  const isMaterialChange = action !== "CONFIRMED" && value !== currentValue;
  if (action !== "CONFIRMED") {
    if (!reason || reason.trim().length < 3) {
      return {
        valid: false,
        error: "A meaningful reason (at least 3 characters) is required.",
        isMaterialChange,
      };
    }
  }
  return { valid: true, isMaterialChange };
}

export function ReviewWorkspace({ initialData }: { initialData: ReviewWorkspaceInitialData }) {
  const { shipment } = initialData;
  const [documents, setDocuments] = useState<ReviewWorkspaceDocument[]>(initialData.documents);
  const [crossChecks, setCrossChecks] = useState<ReviewWorkspaceCrossCheck[]>(initialData.crossChecks);
  const [shipmentRevision, setShipmentRevision] = useState<number>(shipment.currentRevision);
  const [shipmentStatus, setShipmentStatus] = useState<string>(shipment.status);
  const isReadOnly = !isAllowedPreApprovalStatus(shipmentStatus);

  // Active Document Tab
  const availableDocTypes: Array<"INVOICE" | "PACKING_LIST" | "BILL_OF_LADING"> = [
    "INVOICE",
    "PACKING_LIST",
    "BILL_OF_LADING",
  ];
  const firstAvailable = documents[0]?.docType ?? "INVOICE";
  const [activeDocType, setActiveDocType] = useState<"INVOICE" | "PACKING_LIST" | "BILL_OF_LADING">(
    firstAvailable,
  );

  // Viewer Controls
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);

  // Field Edit States
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<FieldCategory | "all">("all");
  const [mobileTab, setMobileTab] = useState<"document" | "fields" | "checks">("fields");

  // Manual Field Addition State
  const [showAddManualField, setShowAddManualField] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [newFieldReason, setNewFieldReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const activeDoc = documents.find((d) => d.docType === activeDocType);
  const maxPages = activeDoc?.pageCount ?? 1;

  // Cross-Check Summary Counts
  const passedCount = crossChecks.filter((c) => c.status === "PASS").length;
  const mismatchCount = crossChecks.filter((c) => c.status === "MISMATCH").length;
  const incompleteCount = crossChecks.filter((c) => c.status === "INCOMPLETE").length;
  const warningCount = crossChecks.filter((c) => c.severity === "WARNING").length;

  // Zoom handlers
  function handleZoomIn() {
    setZoomLevel((prev) => calculateNextZoom(prev, "in"));
  }
  function handleZoomOut() {
    setZoomLevel((prev) => calculateNextZoom(prev, "out"));
  }
  function handleResetZoom() {
    setZoomLevel(100);
    setRotation(0);
  }
  function handleRotate() {
    setRotation((prev) => calculateNextRotation(prev));
  }

  // Jump to page when clicking source quote
  function jumpToPage(page: number | null | undefined) {
    if (page && page >= 1) {
      setCurrentPage(page);
      setMobileTab("document");
    }
  }

  // Navigate to next uncertain field (Rule 12 & Step 7 readiness)
  const goToNextUncertainField = useCallback(() => {
    const currentFields = activeDoc?.fields ?? [];
    const uncertainFields = currentFields.filter(isFieldUncertain);
    if (uncertainFields.length === 0) {
      setStatusMessage("No uncertain fields requiring review on this document.");
      return;
    }
    const nextField = uncertainFields[0];
    if (nextField) {
      setActiveCategory(categorizeFieldKey(nextField.fieldKey));
      if (nextField.pageNumber) {
        setCurrentPage(nextField.pageNumber);
      }
      setMobileTab("fields");
      if (typeof document !== "undefined") {
        setTimeout(() => {
          const el = document.getElementById(`field-card-${nextField.id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          const inputEl = document.getElementById(`field-input-${nextField.id}`) as HTMLInputElement | null;
          if (inputEl) {
            inputEl.focus();
            inputEl.select();
          }
        }, 80);
      }
      setStatusMessage(`Navigated to uncertain field: ${formatFieldLabel(nextField.fieldKey)}`);
    }
  }, [activeDoc?.fields]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "n" || (e.altKey && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        goToNextUncertainField();
      } else if (e.key === "[" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentPage((prev) => Math.max(prev - 1, 1));
      } else if (e.key === "]" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentPage((prev) => Math.min(prev + 1, maxPages));
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoomLevel((prev) => calculateNextZoom(prev, "in"));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoomLevel((prev) => calculateNextZoom(prev, "out"));
      } else if (e.key === "0") {
        e.preventDefault();
        handleResetZoom();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setRotation((prev) => calculateNextRotation(prev));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNextUncertainField, maxPages]);

  // Save Field Action (Confirm, Manual, Correct)
  async function saveFieldAction(
    field: ReviewWorkspaceField,
    action: "CONFIRMED" | "CORRECTED" | "MANUAL_ENTRY",
  ) {
    if (isReadOnly) {
      setStatusMessage("Cannot edit fields on an approved or exported shipment.");
      return;
    }

    const targetVal = editedValues[field.id] ?? field.currentValue;
    const reasonText = reasons[field.id]?.trim();
    const validation = validateFieldCorrection(action, targetVal, field.currentValue, reasonText);

    if (!validation.valid) {
      setStatusMessage(validation.error ?? "Invalid field review action.");
      if (typeof document !== "undefined") {
        const rInput = document.getElementById(`field-reason-${field.id}`) as HTMLInputElement | null;
        if (rInput) rInput.focus();
      }
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/fields/${field.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action,
          value: targetVal,
          reason: reasonText ?? (action === "CONFIRMED" ? undefined : "Verified in review workspace"),
          expectedRevision: shipmentRevision,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setStatusMessage(`Conflict (409): ${data.error ?? "Stale shipment revision. Refresh to see the latest version."}`);
        } else {
          setStatusMessage(data.error ?? "Failed to save field review.");
        }
      } else {
        // Update local field state
        setDocuments((prevDocs) =>
          prevDocs.map((doc) =>
            doc.id === activeDoc?.id
              ? {
                  ...doc,
                  fields: doc.fields.map((f) =>
                    f.id === field.id
                      ? {
                          ...f,
                          currentValue: targetVal,
                          reviewStatus: action,
                          reviewReason: action === "CONFIRMED" ? null : reasonText,
                        }
                      : f,
                  ),
                }
              : doc,
          ),
        );
        if (data.revision) {
          setShipmentRevision(data.revision);
        }
        if (data.shipmentStatus) {
          setShipmentStatus(data.shipmentStatus);
        }
        if (data.crossChecks) {
          setCrossChecks(data.crossChecks);
        }
        setStatusMessage(`Field "${formatFieldLabel(field.fieldKey)}" updated successfully (${action.toLowerCase()}).`);
      }
    } catch {
      setStatusMessage("Network error saving field.");
    } finally {
      setBusy(false);
    }
  }

  // Mark page as unreadable / manual fallback
  async function markPageUnreadable(pageNum: number) {
    if (!activeDoc) return;
    if (isReadOnly) {
      setStatusMessage("Cannot edit page readability on an approved or exported shipment.");
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/documents/${activeDoc.id}/pages/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageNumber: pageNum,
          manualEntryRequired: true,
          reviewNote: "Marked unreadable in review workspace shell",
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setStatusMessage(data.error ?? "Failed to mark page as unreadable.");
      } else {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === activeDoc.id
              ? {
                  ...d,
                  pages: d.pages.map((p) =>
                    p.pageNumber === pageNum
                      ? { ...p, isReadable: false, manualEntryRequired: true }
                      : p,
                  ),
                }
              : d,
          ),
        );
        setStatusMessage(`Page ${pageNum} marked for manual entry.`);
      }
    } catch {
      setStatusMessage("Error updating page readability.");
    } finally {
      setBusy(false);
    }
  }

  // Add field manually
  async function handleAddManualField() {
    if (!activeDoc || !newFieldKey.trim() || !newFieldReason.trim()) {
      setStatusMessage("Field key and reason are required for manual fallback entry.");
      return;
    }
    if (isReadOnly) {
      setStatusMessage("Cannot add fields to an approved or exported shipment.");
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/documents/${activeDoc.id}/fields/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey: newFieldKey.trim(),
          value: newFieldValue.trim() || null,
          reason: newFieldReason.trim(),
          expectedRevision: shipmentRevision,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setStatusMessage(`Conflict (409): ${data.error ?? "Stale revision. Refresh to see the latest data."}`);
        } else {
          setStatusMessage(data.error ?? "Failed to add manual field.");
        }
      } else {
        if (data.revision) {
          setShipmentRevision(data.revision);
        }
        if (data.shipmentStatus) {
          setShipmentStatus(data.shipmentStatus);
        }
        if (data.crossChecks) {
          setCrossChecks(data.crossChecks);
        }
        setStatusMessage(`Manual field "${newFieldKey}" added.`);
        setNewFieldKey("");
        setNewFieldValue("");
        setNewFieldReason("");
        setShowAddManualField(false);
        // Refresh documents
        const docRes = await fetch(`/api/documents/${activeDoc.id}`);
        if (docRes.ok) {
          const docData = await docRes.json();
          const latestRun = docData.document.extractionRuns?.[0] ?? null;
          setDocuments((prev) =>
            prev.map((d) =>
              d.id === activeDoc.id
                ? {
                    ...d,
                    fields: latestRun?.fields ?? d.fields,
                  }
                : d,
            ),
          );
        }
      }
    } catch {
      setStatusMessage("Error creating manual field.");
    } finally {
      setBusy(false);
    }
  }

  // Re-run checks
  async function triggerCrossChecks() {
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/shipments/${shipment.id}/crosschecks`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        setStatusMessage(data.error ?? "Failed to run cross-checks.");
      } else {
        setCrossChecks(data.results ?? []);
        setStatusMessage(`Cross-checks evaluated for revision ${data.revision}.`);
      }
    } catch {
      setStatusMessage("Error executing cross-checks.");
    } finally {
      setBusy(false);
    }
  }

  const activePageData = activeDoc?.pages.find((p) => p.pageNumber === currentPage);
  const isPageUnreadable = activePageData && (!activePageData.isReadable || activePageData.manualEntryRequired);

  // Grouped Fields
  const filteredFields = (activeDoc?.fields ?? []).filter((f) => {
    if (activeCategory === "all") return true;
    return categorizeFieldKey(f.fieldKey) === activeCategory;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      {/* Top Navigation & Shipment Header (Rule 2) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/shipments/${shipment.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft className="size-3.5" /> Back
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-950 font-mono">
                  {shipment.reference}
                </h1>
                <Badge className="bg-slate-100 text-slate-700 border-slate-300">
                  Rev {shipmentRevision}
                </Badge>
                <Badge
                  className={
                    shipmentStatus === "APPROVED"
                      ? "bg-emerald-100 text-emerald-800"
                      : shipmentStatus === "NEEDS_REVIEW"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-blue-100 text-blue-800"
                  }
                >
                  {shipmentStatus.replaceAll("_", " ")}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Supplier: <span className="font-semibold text-slate-700">{shipment.supplier?.name || "Unknown"}</span>
                {shipment.importerName ? ` · Importer: ${shipment.importerName}` : ""}
              </p>
            </div>
          </div>

          {/* Cross-Check Summary Badges (Rule 11) */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-800 border border-emerald-200 font-medium">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              <span>{passedCount} Passed</span>
            </div>
            {mismatchCount > 0 ? (
              <div className="flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-rose-800 border border-rose-200 font-medium">
                <AlertCircle className="size-3.5 text-rose-600" />
                <span>{mismatchCount} Mismatch</span>
              </div>
            ) : null}
            {incompleteCount > 0 ? (
              <div className="flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-amber-800 border border-amber-200 font-medium">
                <AlertTriangle className="size-3.5 text-amber-600" />
                <span>{incompleteCount} Incomplete</span>
              </div>
            ) : null}
            {warningCount > 0 ? (
              <div className="flex items-center gap-1 rounded-md bg-yellow-50 px-2.5 py-1 text-yellow-800 border border-yellow-200 font-medium">
                <AlertTriangle className="size-3.5 text-yellow-600" />
                <span>{warningCount} Warning{warningCount > 1 ? "s" : ""}</span>
              </div>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-slate-300"
              disabled={busy}
              onClick={() => void triggerCrossChecks()}
            >
              <RefreshCw className="size-3 mr-1" /> Re-check
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace Canvas */}
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {/* Document Tabs (Rule 3) */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex flex-wrap gap-2">
            {availableDocTypes.map((docType) => {
              const doc = documents.find((d) => d.docType === docType);
              const isActive = activeDocType === docType;
              const hasFile = Boolean(doc);

              return (
                <button
                  key={docType}
                  type="button"
                  onClick={() => {
                    setActiveDocType(docType);
                    setCurrentPage(1);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {docType === "INVOICE" ? (
                    <FileText className="size-3.5" />
                  ) : docType === "PACKING_LIST" ? (
                    <FileSpreadsheet className="size-3.5" />
                  ) : (
                    <Package className="size-3.5" />
                  )}
                  <span>{docType.replaceAll("_", " ")}</span>
                  {hasFile ? (
                    <span
                      className={`ml-1 rounded px-1.5 py-0.2 text-[10px] ${
                        isActive ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      v{doc?.documentVersion}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">Missing</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Narrow Screen Switcher (Rule 12) */}
          <div className="flex lg:hidden rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
            <button
              type="button"
              className={`px-2.5 py-1 rounded-md ${mobileTab === "document" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              onClick={() => setMobileTab("document")}
            >
              Document
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 rounded-md ${mobileTab === "fields" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              onClick={() => setMobileTab("fields")}
            >
              Fields
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 rounded-md ${mobileTab === "checks" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              onClick={() => setMobileTab("checks")}
            >
              Checks ({crossChecks.length})
            </button>
          </div>
        </div>

        {isReadOnly ? (
          <div
            role="status"
            className="mb-4 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 text-xs font-medium text-slate-800 flex items-center gap-2"
          >
            <Lock className="size-4 text-slate-500 shrink-0" />
            <span>
              This shipment is in {shipmentStatus.replaceAll("_", " ")} status. Field edits and corrections are locked in read-only mode.
            </span>
          </div>
        ) : null}

        {statusMessage ? (
          <div
            role="alert"
            className={`mb-4 rounded-lg border px-4 py-2.5 text-xs font-medium flex items-center justify-between ${
              statusMessage.includes("Conflict") || statusMessage.includes("409")
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : statusMessage.includes("Error") ||
                    statusMessage.includes("Failed") ||
                    statusMessage.includes("required") ||
                    statusMessage.includes("Cannot")
                  ? "border-rose-300 bg-rose-50 text-rose-950"
                  : "border-emerald-300 bg-emerald-50 text-emerald-950"
            }`}
          >
            <span>{statusMessage}</span>
            <button
              type="button"
              className="hover:opacity-75 font-bold ml-2"
              onClick={() => setStatusMessage(null)}
            >
              ✕
            </button>
          </div>
        ) : null}

        {/* Dual-Pane Layout: Left: Document Viewer, Right: Extracted Fields / Line Items */}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {/* ================= LEFT PANE: DOCUMENT VIEWER (Rules 4, 5, 6, 7) ================= */}
          <section
            aria-label="Document evidence viewer"
            className={`space-y-3 ${mobileTab === "document" ? "block" : "hidden lg:block"}`}
          >
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-200 bg-slate-50/75 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-slate-800 truncate max-w-[200px]">
                      {activeDoc?.originalFileName ?? "No document uploaded"}
                    </span>
                    {activeDoc ? (
                      <Badge className="bg-slate-200 text-slate-700 border-slate-300 text-[10px]">
                        {activeDoc.mimeType.includes("pdf") ? "PDF" : "IMAGE"}
                      </Badge>
                    ) : null}
                  </div>

                  {/* Viewer Toolbar: Zoom, Rotate, Page Navigation (Rule 6) */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center rounded-md border border-slate-300 bg-white">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                        title="Previous page"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="px-2 text-[11px] font-mono font-medium text-slate-600">
                        {currentPage} / {maxPages}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        disabled={currentPage >= maxPages}
                        onClick={() => setCurrentPage((p) => Math.min(p + 1, maxPages))}
                        title="Next page"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>

                    <div className="flex items-center rounded-md border border-slate-300 bg-white">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={handleZoomOut}
                        title="Zoom out"
                      >
                        <ZoomOut className="size-3.5" />
                      </Button>
                      <button
                        type="button"
                        onClick={handleResetZoom}
                        className="px-1.5 text-[10px] font-mono text-slate-600 hover:text-slate-900"
                        title="Reset zoom"
                      >
                        {zoomLevel}%
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={handleZoomIn}
                        title="Zoom in"
                      >
                        <ZoomIn className="size-3.5" />
                      </Button>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 border-slate-300"
                      onClick={handleRotate}
                      title="Rotate 90 degrees"
                    >
                      <RotateCw className="size-3.5" />
                    </Button>

                    {activeDoc ? (
                      <a
                        href={activeDoc.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        title="Open in new tab"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </CardHeader>

              {/* Unreadable / Manual Entry Page Control (Rule 7) */}
              {activeDoc ? (
                <div className="border-b border-slate-200 bg-slate-100/60 px-4 py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">
                    Inspecting Page <span className="font-semibold text-slate-900">{currentPage}</span> of{" "}
                    {maxPages}
                  </span>
                  {!isPageUnreadable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100"
                      onClick={() => void markPageUnreadable(currentPage)}
                    >
                      <AlertTriangle className="size-3 mr-1 text-amber-600" />
                      Mark page as unreadable
                    </Button>
                  ) : (
                    <Badge className="bg-amber-200 text-amber-900 border-amber-300 text-[10px]">
                      Page marked unreadable (manual entry active)
                    </Badge>
                  )}
                </div>
              ) : null}

              {/* Viewer Content Canvas (Rules 4, 5) */}
              <CardContent className="p-0 bg-slate-900/5 min-h-[560px] max-h-[720px] overflow-auto flex items-center justify-center">
                {!activeDoc ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    <p className="font-medium text-slate-600">Document not supplied for {activeDocType}.</p>
                    <p className="mt-1">Upload the document on the shipment page to inspect evidence.</p>
                  </div>
                ) : activeDoc.mimeType.includes("pdf") ? (
                  <div
                    className="w-full h-[640px] transition-transform duration-200 ease-out origin-top"
                    style={{
                      transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`,
                    }}
                  >
                    <iframe
                      src={`${activeDoc.signedUrl}#page=${currentPage}&toolbar=0&navpanes=0`}
                      className="w-full h-full border-0"
                      title={activeDoc.originalFileName}
                    />
                  </div>
                ) : (
                  <div
                    className="p-4 transition-transform duration-200 ease-out"
                    style={{
                      transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeDoc.signedUrl}
                      alt={activeDoc.originalFileName}
                      className="max-w-full rounded shadow border border-slate-200"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ================= RIGHT PANE: EXTRACTED FIELDS & CROSS-CHECKS ================= */}
          <div className="space-y-5">
            {/* Field Categorization Tabs (Rule 10) */}
            <div
              className={`space-y-4 ${
                mobileTab === "fields" ? "block" : "hidden lg:block"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(["all", "parties", "identifiers", "commercial", "logistics"] as const).map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setActiveCategory(cat)}
                        className={`rounded-md px-2.5 py-1 font-medium transition ${
                          activeCategory === cat
                            ? "bg-slate-900 text-white"
                            : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {cat === "all"
                          ? "All Fields"
                          : cat === "parties"
                            ? "Parties"
                            : cat === "identifiers"
                              ? "Identifiers"
                              : cat === "commercial"
                                ? "Commercial"
                                : "Logistics"}
                      </button>
                    ),
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 text-amber-900 bg-amber-50/50 hover:bg-amber-100/60"
                    onClick={() => goToNextUncertainField()}
                  >
                    <AlertTriangle className="size-3 mr-1 text-amber-600" /> Next Uncertain
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-slate-300"
                    onClick={() => setShowAddManualField((prev) => !prev)}
                  >
                    <PlusCircle className="size-3 mr-1" /> Add field
                  </Button>
                </div>
              </div>

              {/* Manual Field Creation Form */}
              {showAddManualField ? (
                <Card className="border-blue-200 bg-blue-50/50 text-xs">
                  <CardHeader className="p-3">
                    <CardTitle className="text-xs font-semibold text-blue-950">
                      Add Manual Fallback Field
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        placeholder="Field key (e.g. grossWeight)"
                        className="h-8 bg-white text-xs"
                        value={newFieldKey}
                        onChange={(e) => setNewFieldKey(e.target.value)}
                      />
                      <Input
                        placeholder="Value (e.g. 3120 kg)"
                        className="h-8 bg-white text-xs"
                        value={newFieldValue}
                        onChange={(e) => setNewFieldValue(e.target.value)}
                      />
                    </div>
                    <Input
                      placeholder="Reason (e.g. read from invoice footer)"
                      className="h-8 bg-white text-xs"
                      value={newFieldReason}
                      onChange={(e) => setNewFieldReason(e.target.value)}
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setShowAddManualField(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-blue-700 text-white"
                        disabled={busy}
                        onClick={() => void handleAddManualField()}
                      >
                        <Save className="size-3 mr-1" /> Save field
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Extracted Fields List (Rules 8, 9, 10) */}
              <div className="space-y-3">
                {filteredFields.length === 0 ? (
                  <Card>
                    <CardContent className="p-6 text-center text-xs text-slate-500">
                      No fields available under this category.
                    </CardContent>
                  </Card>
                ) : (
                  filteredFields.map((field) => {
                    const confidenceNum = Number(field.modelConfidence);
                    const isLowConfidence = isFieldUncertain(field);
                    const isManual = field.reviewStatus === "MANUAL_ENTRY";
                    const isConfirmed = field.reviewStatus === "CONFIRMED";

                    return (
                      <div
                        key={field.id}
                        id={`field-card-${field.id}`}
                        className={`rounded-xl border p-3.5 transition ${
                          isLowConfidence
                            ? "border-amber-300 bg-amber-50/30"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        {/* Header: Label, Status, Confidence */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-xs text-slate-900 font-mono">
                            {formatFieldLabel(field.fieldKey)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {/* Confidence Badge (Rule 9) */}
                            <Badge className="bg-slate-100 text-slate-700 border-slate-300 text-[10px]">
                              {Number.isFinite(confidenceNum)
                                ? `${Math.round(confidenceNum * 100)}% (model estimate)`
                                : "Uncalibrated estimate"}
                            </Badge>
                            <Badge
                              className={
                                isManual
                                  ? "bg-purple-100 text-purple-900 text-[10px]"
                                  : isConfirmed
                                    ? "bg-emerald-100 text-emerald-900 text-[10px]"
                                    : isLowConfidence
                                      ? "bg-amber-100 text-amber-900 text-[10px]"
                                      : "bg-slate-100 text-slate-800 text-[10px]"
                              }
                            >
                              {field.reviewStatus}
                            </Badge>
                          </div>
                        </div>

                        {/* Original AI Value Display (Rule 2) */}
                        {field.modelValue !== null && field.currentValue !== field.modelValue ? (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-600">Original AI Value:</span>
                            <span className="font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] line-through">
                              {field.modelValue}
                            </span>
                            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[9px] py-0 h-4">
                              Modified
                            </Badge>
                          </div>
                        ) : null}

                        {/* Review Reason Alert */}
                        {field.reviewReason ? (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-800 font-mono">
                            <AlertTriangle className="size-3 text-amber-600 shrink-0" />
                            <span>Reason: {field.reviewReason}</span>
                          </div>
                        ) : null}

                        {/* Value Input and Actions */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <Input
                            id={`field-input-${field.id}`}
                            disabled={isReadOnly || busy}
                            className="h-8 flex-1 min-w-[140px] text-xs font-mono bg-white disabled:bg-slate-100 disabled:text-slate-500"
                            value={editedValues[field.id] ?? field.currentValue ?? ""}
                            onChange={(e) =>
                              setEditedValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (
                                  editedValues[field.id] === undefined ||
                                  editedValues[field.id] === field.currentValue
                                ) {
                                  void saveFieldAction(field, "CONFIRMED");
                                } else {
                                  const rInput = document.getElementById(
                                    `field-reason-${field.id}`,
                                  ) as HTMLInputElement | null;
                                  if (rInput) {
                                    rInput.focus();
                                  } else {
                                    setReasons((prev) => ({ ...prev, [field.id]: "" }));
                                    setTimeout(() => {
                                      const el = document.getElementById(`field-reason-${field.id}`);
                                      if (el) el.focus();
                                    }, 50);
                                  }
                                }
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                            disabled={isReadOnly || busy}
                            onClick={() => void saveFieldAction(field, "CONFIRMED")}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50"
                            disabled={isReadOnly || busy}
                            onClick={() => void saveFieldAction(field, "CORRECTED")}
                          >
                            Correct
                          </Button>
                        </div>

                        {/* Correction Reason when modified or has reason */}
                        {((editedValues[field.id] !== undefined &&
                          editedValues[field.id] !== (field.currentValue ?? "")) ||
                          reasons[field.id] !== undefined) &&
                        !isReadOnly ? (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Input
                              id={`field-reason-${field.id}`}
                              placeholder="Reason for correction (required, min 3 chars)"
                              className="h-7 text-[11px] font-sans bg-white border-amber-200"
                              value={reasons[field.id] ?? ""}
                              onChange={(e) =>
                                setReasons((prev) => ({
                                  ...prev,
                                  [field.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveFieldAction(field, "CORRECTED");
                                }
                              }}
                            />
                          </div>
                        ) : null}

                        {/* Source Quote & Provenance (Rule 8) */}
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                            <span className="font-semibold text-slate-700">Quote:</span>
                            <span className="italic text-slate-800 truncate max-w-xs">
                              &ldquo;{field.sourceQuote ?? "No direct quote available"}&rdquo;
                            </span>
                          </div>
                          {field.pageNumber ? (
                            <button
                              type="button"
                              onClick={() => jumpToPage(field.pageNumber)}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-blue-700 hover:bg-blue-50 font-medium"
                              title="Navigate document viewer to this page"
                            >
                              <Eye className="size-3" /> Page {field.pageNumber}
                            </button>
                          ) : null}
                        </div>

                        {/* Original AI value display if edited */}
                        {field.modelValue && field.modelValue !== field.currentValue ? (
                          <div className="mt-1 text-[10px] text-slate-500">
                            Original AI value:{" "}
                            <span className="font-mono text-slate-700">{field.modelValue}</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Line Items Table (Rule 10) */}
              {activeDoc?.lineItems && activeDoc.lineItems.length > 0 ? (
                <Card className="mt-4 border-slate-200">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-xs font-semibold text-slate-900">
                      Line Items ({activeDoc.lineItems.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/80 text-[11px] font-semibold text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Description</th>
                          <th className="py-2 px-3">HSN</th>
                          <th className="py-2 px-3 text-right">Qty</th>
                          <th className="py-2 px-3">Unit</th>
                          <th className="py-2 px-3 text-right">Price</th>
                          <th className="py-2 px-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeDoc.lineItems.map((item, idx) => (
                          <tr key={item.id ?? idx} className="hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-mono text-slate-500">
                              {item.lineNumber ?? idx + 1}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900 max-w-[160px] truncate">
                              {item.description ?? "—"}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600">
                              {item.hsnCode ?? "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-medium text-slate-900">
                              {item.quantity ? String(item.quantity) : "—"}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {item.quantityUnit ?? "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {item.unitPrice ? String(item.unitPrice) : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                              {item.lineTotal ? String(item.lineTotal) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {/* Cross-Checks Drawer/Tab (Rule 11 & 12) */}
            <div
              className={`space-y-3 ${
                mobileTab === "checks" ? "block" : "hidden lg:block"
              }`}
            >
              <Card className="border-slate-200">
                <CardHeader className="py-3 px-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Scale className="size-4 text-slate-700" />
                      Deterministic Cross-Checks ({crossChecks.length})
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] border-slate-300"
                      disabled={busy}
                      onClick={() => void triggerCrossChecks()}
                    >
                      <RefreshCw className="size-3 mr-1" /> Re-run
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-3 space-y-2.5">
                  {crossChecks.length === 0 ? (
                    <p className="text-xs text-slate-500 py-2 text-center">
                      No cross-check results recorded for revision {shipment.currentRevision}.
                    </p>
                  ) : (
                    crossChecks.map((check) => (
                      <div
                        key={check.ruleKey}
                        className={`rounded-lg border p-2.5 text-xs ${
                          check.status === "MISMATCH"
                            ? "border-rose-200 bg-rose-50/50"
                            : check.status === "INCOMPLETE"
                              ? "border-amber-200 bg-amber-50/50"
                              : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 font-mono">
                            {check.ruleKey.replaceAll("_", " ")}
                          </span>
                          <Badge
                            className={
                              check.status === "PASS"
                                ? "bg-emerald-100 text-emerald-800"
                                : check.status === "MISMATCH"
                                  ? "bg-rose-100 text-rose-800 font-semibold"
                                  : check.status === "INCOMPLETE"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-100 text-slate-700"
                            }
                          >
                            {check.status}
                          </Badge>
                        </div>
                        {check.details?.note || check.details?.message ? (
                          <p className="mt-1 text-[11px] text-slate-600">
                            {check.details.note ?? check.details.message}
                          </p>
                        ) : null}
                        {check.details?.difference || check.details?.differenceKg ? (
                          <p className="mt-0.5 text-[11px] font-mono font-medium text-rose-700">
                            Difference: {check.details.differenceKg ?? check.details.difference}{" "}
                            {check.ruleKey.includes("weight") ? "kg" : ""}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
