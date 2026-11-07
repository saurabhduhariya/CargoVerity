import { selectLatestByRule } from "@/lib/crosschecks/resolution-state";

export type ExportGuardInput = {
  shipmentStatus?: string;
  hasManagerApproval: boolean;
  approvedRevision: number | null;
  currentRevision: number;
  hasCurrentDocuments?: boolean;
  hasMissingRequiredFields?: boolean;
  /** False when no cross-check run exists for the current revision. */
  hasCurrentCheckRun?: boolean;
  unresolvedStatuses: Array<"MISMATCH" | "INCOMPLETE">;
  unapprovedExceptionCount?: number;
  profileId: string;
};

/** Statuses that may produce the CSV: first export (APPROVED) or a reproducible re-download (EXPORTED). */
export const EXPORTABLE_STATUSES = ["APPROVED", "EXPORTED"] as const;

export type RevisionCrossCheck = {
  id?: string;
  ruleKey: string;
  status: string;
  createdAt: Date;
  resolutions?: Array<{
    type: string;
    managerApprovedAt: Date | null;
  }>;
};

/** Latest result per rule; createdAt ties are broken by ID so the choice is deterministic. */
export function selectLatestCrossChecks<T extends RevisionCrossCheck>(checks: T[]) {
  return selectLatestByRule(checks);
}

/**
 * Pure server-side export guard (Week 5 Step 4).
 * Evaluates approval status, revision match, document and field presence, check run currency,
 * check resolutions, unapproved exceptions, and profile assignment.
 */
export function canExport(input: ExportGuardInput) {
  const reasons: string[] = [];

  // Rule 4: Require APPROVED (EXPORTED re-downloads the same approved revision)
  if (input.shipmentStatus && !(EXPORTABLE_STATUSES as readonly string[]).includes(input.shipmentStatus)) {
    reasons.push("shipment_not_approved");
  }

  // Rule 5: Require manager approval for exactly the current revision
  if (!input.hasManagerApproval) {
    reasons.push("manager_approval_required");
  } else if (input.approvedRevision !== input.currentRevision) {
    reasons.push("approval_is_stale");
  }

  // Rule 6: Require current documents and fields
  if (input.hasCurrentDocuments === false) {
    reasons.push("documents_missing");
  }
  if (input.hasMissingRequiredFields === true) {
    reasons.push("required_fields_missing");
  }

  // Rule 7: Require current checks and resolutions to be clear
  if (input.hasCurrentCheckRun === false) {
    reasons.push("cross_checks_not_run");
  }
  if (input.unresolvedStatuses.length > 0) {
    reasons.push("cross_checks_unresolved");
  }
  if ((input.unapprovedExceptionCount ?? 0) > 0) {
    reasons.push("unapproved_exceptions_present");
  }

  // Rule 8: Require profile ID
  if (!input.profileId) {
    reasons.push("export_profile_missing");
  }

  return { allowed: reasons.length === 0, reasons };
}
