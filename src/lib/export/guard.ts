export type ExportGuardInput = {
  hasManagerApproval: boolean;
  approvedRevision: number | null;
  currentRevision: number;
  unresolvedStatuses: Array<"MISMATCH" | "INCOMPLETE">;
  profileId: string;
};

export type RevisionCrossCheck = {
  ruleKey: string;
  status: string;
  createdAt: Date;
};

export function selectLatestCrossChecks<T extends RevisionCrossCheck>(checks: T[]) {
  const latestByRule = new Map<string, T>();
  for (const check of checks) {
    const existing = latestByRule.get(check.ruleKey);
    if (!existing || check.createdAt > existing.createdAt) latestByRule.set(check.ruleKey, check);
  }
  return [...latestByRule.values()];
}

export function canExport(input: ExportGuardInput) {
  const reasons: string[] = [];

  if (!input.hasManagerApproval) reasons.push("manager_approval_required");
  if (input.approvedRevision !== input.currentRevision) reasons.push("approval_is_stale");
  if (input.unresolvedStatuses.length > 0) reasons.push("cross_checks_unresolved");
  if (!input.profileId) reasons.push("export_profile_missing");

  return { allowed: reasons.length === 0, reasons };
}
