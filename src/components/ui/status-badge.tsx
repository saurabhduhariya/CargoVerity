import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck,
  FileDown,
  FileText,
  HelpCircle,
  MinusCircle,
  Pencil,
  ScanLine,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeProps, type BadgeVariant } from "@/components/ui/badge";

type StatusPresentation = {
  label: string;
  variant: BadgeVariant;
  icon: LucideIcon;
};

/** Presentation only. Never use these tones to determine permission or clearance. */
export const STATUS_PRESENTATIONS = {
  DRAFT: { label: "Draft", variant: "default", icon: FileText },
  IN_REVIEW: { label: "In review", variant: "info", icon: ScanLine },
  EXTRACTING: { label: "Extracting", variant: "info", icon: Clock },
  NEEDS_REVIEW: { label: "Needs review", variant: "warning", icon: AlertTriangle },
  READY_FOR_APPROVAL: { label: "Awaiting approval", variant: "info", icon: Clock },
  APPROVED: { label: "Approved", variant: "success", icon: ShieldCheck },
  EXPORTED: { label: "Exported", variant: "success", icon: FileDown },
  UPLOADED: { label: "Uploaded", variant: "default", icon: FileText },
  QUEUED: { label: "Queued", variant: "default", icon: Clock },
  PROCESSING: { label: "Processing", variant: "info", icon: Clock },
  EXTRACTED: { label: "Extracted", variant: "info", icon: FileCheck },
  COMPLETED: { label: "Completed", variant: "info", icon: FileCheck },
  REVIEW_REQUIRED: { label: "Review required", variant: "warning", icon: AlertTriangle },
  FAILED: { label: "Failed", variant: "error", icon: AlertCircle },
  PENDING: { label: "Pending review", variant: "warning", icon: Clock },
  REQUIRES_REVIEW: { label: "Review required", variant: "warning", icon: AlertTriangle },
  NOT_PRESENT: { label: "Not present", variant: "default", icon: MinusCircle },
  NOT_APPLICABLE: { label: "Not applicable", variant: "default", icon: MinusCircle },
  CONFIRMED: { label: "Confirmed", variant: "success", icon: CheckCircle2 },
  CORRECTED: { label: "Corrected", variant: "info", icon: Pencil },
  MANUAL_ENTRY: { label: "Manually entered", variant: "default", icon: Pencil },
  PASS: { label: "Passed", variant: "success", icon: CheckCircle2 },
  MISMATCH: { label: "Mismatch", variant: "error", icon: AlertCircle },
  INCOMPLETE: { label: "Incomplete", variant: "warning", icon: AlertTriangle },
  BLOCKING: { label: "Blocking", variant: "error", icon: AlertCircle },
  WARNING: { label: "Warning", variant: "warning", icon: AlertTriangle },
  ACCEPTED_EXCEPTION: { label: "Accepted exception", variant: "default", icon: ShieldCheck },
  PENDING_MANAGER_APPROVAL: { label: "Exception awaiting approval", variant: "warning", icon: Clock },
  HUMAN_CLEARED: { label: "Exception approved", variant: "default", icon: ShieldCheck },
  SOURCE_CORRECTED: { label: "Source corrected", variant: "default", icon: Pencil },
  DOCUMENT_REPLACEMENT: { label: "Document replacement", variant: "default", icon: FileText },
} as const satisfies Record<string, StatusPresentation>;

export type CargoVerityStatus = keyof typeof STATUS_PRESENTATIONS;

export function getStatusPresentation(status: string): StatusPresentation {
  if (Object.hasOwn(STATUS_PRESENTATIONS, status)) {
    return STATUS_PRESENTATIONS[status as CargoVerityStatus];
  }

  return {
    label: status.trim() ? status.replaceAll("_", " ") : "Unknown status",
    variant: "default",
    icon: HelpCircle,
  };
}

type StatusBadgeProps = Omit<BadgeProps, "variant"> & {
  status: string;
  showIcon?: boolean;
};

export function StatusBadge({ status, showIcon = true, children, ...props }: StatusBadgeProps) {
  const { label, variant, icon: Icon } = getStatusPresentation(status);

  return (
    <Badge {...props} variant={variant} data-status={status}>
      {showIcon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0">{children ?? label}</span>
    </Badge>
  );
}
