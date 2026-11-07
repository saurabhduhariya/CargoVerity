import { getStatusPresentation } from "@/components/ui/status-badge";
import { evaluateClearance } from "@/lib/crosschecks/resolution-state";
import type {
  CrossCheckResolutionData,
  FieldAction,
  FieldCategory,
  ReviewWorkspaceCrossCheck,
  ReviewWorkspaceDocument,
  ReviewWorkspaceField,
} from "./review-types";

export const DOCUMENT_TYPES = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const;
export const DOCUMENT_LABELS = { INVOICE: "Invoice", PACKING_LIST: "Packing list", BILL_OF_LADING: "Bill of lading" };
export const FIELD_CATEGORIES = ["all", "parties", "identifiers", "commercial", "logistics", "other"] as const;

export function categorizeFieldKey(fieldKey: string): FieldCategory {
  const k = fieldKey.toLowerCase();
  if (["exporter", "importer", "shipper", "consignee", "notify", "carrier"].some((part) => k.includes(part))) return "parties";
  if (["number", "code", "reference", "date", "invnum", "blnum"].some((part) => k.includes(part))) return "identifiers";
  if (["weight", "package", "vessel", "voyage", "port", "container", "delivery", "loading", "discharge"].some((part) => k.includes(part))) return "logistics";
  if (["total", "amount", "price", "currency", "tax", "freight", "insurance", "discount"].some((part) => k.includes(part)) || (!k.includes("discharge") && k.includes("charge"))) return "commercial";
  return "other";
}

export function formatFieldLabel(key: string): string {
  if (/^[A-Z\d_]+$/.test(key)) {
    return key.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (str) => str.toUpperCase()).trim();
  }
  return key.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (str) => str.toUpperCase()).trim();
}

/** The server's review policy owns uncertainty; model estimates never re-queue human decisions. */
export function isFieldUncertain(field: Pick<ReviewWorkspaceField, "reviewStatus"> & Partial<ReviewWorkspaceField>): boolean {
  return field.reviewStatus === "REQUIRES_REVIEW";
}

export function modelEstimate(value: ReviewWorkspaceField["modelConfidence"]): string {
  if (value === null || value === "") return "Model estimate unavailable";
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
    ? `${Math.round(confidence * 100)}% (model estimate)`
    : "Model estimate unavailable";
}

const REVIEW_REASONS: Record<string, string> = {
  REQUIRED_FIELD_MISSING: "A required value was not found. Read the source and enter it, or obtain a replacement document.",
  LOW_MODEL_CONFIDENCE: "The model was unsure of this value. Compare it with the source before confirming.",
  MISSING_SOURCE_EVIDENCE: "No direct source evidence was returned. Inspect the document before confirming or correcting.",
  INVALID_FORMAT: "The extracted value has an invalid format. Enter the value shown on the source.",
  OPTIONAL_FIELD_NOT_PRESENT: "This optional value was not found on the document.",
  DOCUMENT_TYPE_MISMATCH: "The detected document type differs from the selected type. Verify the source document.",
  UNREADABLE_PAGE: "The source page could not be read reliably. Inspect it and use manual entry if needed.",
  MANUAL_ENTRY_REQUIRED: "This value needs to be entered from the source document.",
};

export function fieldReviewReason(field: ReviewWorkspaceField): string | null {
  if (field.reviewReason) return REVIEW_REASONS[field.reviewReason] ?? field.reviewReason;
  if (isFieldUncertain(field)) return "The extraction policy requires a human review of this value.";
  if (field.reviewStatus === "PENDING") return "Compare the value with its source, then confirm it or save a correction.";
  return null;
}

export function calculateNextZoom(current: number, direction: "in" | "out"): number {
  return direction === "in" ? Math.min(current + 25, 200) : Math.max(current - 25, 50);
}

export function calculateNextRotation(current: number): number {
  return (current + 90) % 360;
}

/** Exact mirror of EDITABLE_FIELD_STATUSES, not a permissive deny-list. */
export function isAllowedPreApprovalStatus(status: string): boolean {
  return ["DRAFT", "IN_REVIEW", "NEEDS_REVIEW", "READY_FOR_APPROVAL"].includes(status);
}

export function validateFieldCorrection(
  action: FieldAction,
  value: string | null | undefined,
  currentValue: string | null | undefined,
  reason: string | null | undefined,
): { valid: boolean; error?: string; isMaterialChange: boolean } {
  const isMaterialChange = action !== "CONFIRMED" && value !== currentValue;
  if (action === "CONFIRMED") {
    if ((value ?? "") !== (currentValue ?? "")) return { valid: false, error: "Save or discard the edited value before confirming the saved value.", isMaterialChange };
    if (!currentValue?.trim()) return { valid: false, error: "There is no saved value to confirm. Enter the source value instead.", isMaterialChange };
  } else {
    if (!reason || reason.trim().length < 3) return { valid: false, error: "A meaningful reason (at least 3 characters) is required.", isMaterialChange };
    if (!isMaterialChange) return { valid: false, error: "The value is unchanged. Confirm it instead, or discard the draft.", isMaterialChange };
  }
  return { valid: true, isMaterialChange };
}

export function effectiveCheckStatus(
  status: ReviewWorkspaceCrossCheck["status"],
  activeResolution?: CrossCheckResolutionData | null,
  derivedStatus?: string | null,
): string {
  if (status === "PASS" || status === "NOT_APPLICABLE") return status;
  if (derivedStatus) return derivedStatus;
  const valid = activeResolution?.type === "ACCEPTED_EXCEPTION" && activeResolution.reason.trim().length >= 5 && (activeResolution.evidence ?? "").trim().length >= 3;
  return valid ? (activeResolution?.managerApprovedAt ? "HUMAN_CLEARED" : "PENDING_MANAGER_APPROVAL") : status;
}

/** Presentation only. Server clearance flags and guarded endpoints remain authoritative. */
export function deriveEffectiveCheckStatus(
  status: ReviewWorkspaceCrossCheck["status"],
  activeResolution?: CrossCheckResolutionData | null,
  derivedStatus?: string | null,
): { label: string; badgeClass: string; isHumanCleared: boolean; isPendingApproval: boolean } {
  const effective = effectiveCheckStatus(status, activeResolution, derivedStatus);
  const presentation = getStatusPresentation(effective);
  const styles = {
    default: "bg-neutral-surface text-neutral border-neutral-border",
    outline: "bg-surface text-neutral border-neutral-border",
    info: "bg-info-surface text-info border-info-border",
    success: "bg-success-surface text-success border-success-border",
    warning: "bg-warning-surface text-warning border-warning-border",
    error: "bg-danger-surface text-danger border-danger-border",
  };
  return { label: presentation.label, badgeClass: styles[presentation.variant], isHumanCleared: effective === "HUMAN_CLEARED", isPendingApproval: effective === "PENDING_MANAGER_APPROVAL" };
}

export function checkDisplayStatus(check: ReviewWorkspaceCrossCheck): string {
  return check.derivedStatus ?? check.effectiveStatus ?? evaluateClearance({
    ...check,
    resolutions: check.resolutions ?? (check.activeResolution ? [check.activeResolution] : []),
  }).derivedStatus;
}

export function blockingAcceptedExceptions(checks: ReviewWorkspaceCrossCheck[]): ReviewWorkspaceCrossCheck[] {
  return checks.filter((check) => {
    const clearance = evaluateClearance({
      ...check,
      resolutions: check.resolutions ?? (check.activeResolution ? [check.activeResolution] : []),
    });
    return clearance.isCurrentBlockingFailure && clearance.activeException !== null;
  });
}

export function validateManagerDecision(
  decision: "APPROVE" | "REJECT",
  comment: string,
  checks: ReviewWorkspaceCrossCheck[],
  options: { hasDrafts: boolean; refreshRequired: boolean; checksStale: boolean },
): string | null {
  if (options.hasDrafts || options.refreshRequired) return "Save or discard drafts and refresh the latest shipment before deciding.";
  // Rejection has no check-readiness requirement in the guarded manager endpoint.
  if (decision === "APPROVE" && options.checksStale) return "Refresh current checks before approving this revision.";
  if ((decision === "REJECT" || blockingAcceptedExceptions(checks).length > 0) && comment.trim().length < 5) {
    return "A meaningful comment of at least 5 characters is required.";
  }
  return null;
}

const CHECK_LABELS: Record<string, string> = {
  invoice_line_total: "Invoice arithmetic",
  gross_weight_comparison: "Gross weight across documents",
  package_count_comparison: "Package count across documents",
  invoice_quantity_vs_packing_list: "Invoice and packing-list quantities",
  gross_weight_vs_net_weight: "Gross vs net weight",
  exporter_consistency: "Exporter consistency",
};

export function checkLabel(check: Pick<ReviewWorkspaceCrossCheck, "ruleKey">): string {
  return CHECK_LABELS[check.ruleKey] ?? formatFieldLabel(check.ruleKey);
}

export function canEnterManualField(doc: ReviewWorkspaceDocument, fieldKey: string, page: number): boolean {
  if (doc.extractionStatus === "PROCESSING") return false;
  if (!doc.latestRunId || doc.extractionProvider === "manual") return true;
  const manualPages = doc.pages.filter((p) => p.manualEntryRequired);
  const field = doc.fields.find((f) => f.fieldKey === fieldKey);
  return manualPages.some((p) => p.pageNumber === page) || (manualPages.length > 0 && (!field || field.modelValue === null));
}

export function displayDate(value: string | Date): string {
  const date = new Date(value);
  // Audit timestamps must render identically during SSR and hydration, regardless of locale.
  return Number.isNaN(date.getTime()) ? "Date unavailable" : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
