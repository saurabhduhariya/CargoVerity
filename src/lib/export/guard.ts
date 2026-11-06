export type ExportGuardInput = {
  shipmentStatus?: string;
  hasManagerApproval: boolean;
  approvedRevision: number | null;
  currentRevision: number;
  hasCurrentDocuments?: boolean;
  hasMissingRequiredFields?: boolean;
  unresolvedStatuses: Array<"MISMATCH" | "INCOMPLETE">;
  unapprovedExceptionCount?: number;
  profileId: string;
};

export type RevisionCrossCheck = {
  ruleKey: string;
  status: string;
  createdAt: Date;
  resolutions?: Array<{
    type: string;
    managerApprovedAt: Date | null;
  }>;
};

export function selectLatestCrossChecks<T extends RevisionCrossCheck>(checks: T[]) {
  const latestByRule = new Map<string, T>();
  for (const check of checks) {
    const existing = latestByRule.get(check.ruleKey);
    if (!existing || check.createdAt > existing.createdAt) latestByRule.set(check.ruleKey, check);
  }
  return [...latestByRule.values()];
}

/**
 * Pure server-side export guard (Week 5 Step 4).
 * Evaluates approval status, revision match, document presence, check resolutions,
 * unapproved exceptions, and profile assignment.
 */
export function canExport(input: ExportGuardInput) {
  const reasons: string[] = [];

  // Rule 4: Require APPROVED status (if shipmentStatus is evaluated)
  if (input.shipmentStatus && input.shipmentStatus !== "APPROVED") {
    reasons.push("shipment_not_approved");
  }

  // Rule 5: Require manager approval and approvedRevision === revision
  if (!input.hasManagerApproval) {
    reasons.push("manager_approval_required");
  }
  if (input.approvedRevision !== input.currentRevision) {
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
