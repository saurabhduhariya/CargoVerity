/**
 * Week 4 Step 8: Single source of truth for cross-check clearance.
 *
 * Used by the submission guard, manager decision, export route, shipment summary and
 * getLatestCrossCheckRun so they all give the same answer for the same data.
 *
 * Rules:
 * - A check that is not failing (PASS / NOT_APPLICABLE) never blocks.
 * - A failing WARNING-severity check never blocks (shown to the reviewer only).
 * - A failing BLOCKING check is cleared FOR SUBMISSION only by a valid ACCEPTED_EXCEPTION
 *   (reason >= 5 chars, external evidence >= 3 chars). It is cleared FOR APPROVAL/EXPORT only once
 *   that exception also carries managerApprovedAt.
 * - SOURCE_CORRECTED and DOCUMENT_REPLACEMENT are audit links to a corrected/replaced source.
 *   They never clear a current failure; the fresh check run after the correction is what passes.
 * - Results that are not from the latest run at the current revision are historical; they are
 *   shown but block nothing.
 * - HUMAN_CLEARED and PENDING_MANAGER_APPROVAL are derived display statuses, never stored.
 */

export const FAILING_STATUSES = ["MISMATCH", "INCOMPLETE"] as const;
export const MIN_RESOLUTION_REASON_LENGTH = 5;
export const MIN_EXCEPTION_EVIDENCE_LENGTH = 3;

export type ResolutionLike = {
  id: string;
  type: string;
  reason?: string | null;
  evidence?: string | null;
  managerApprovedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type CheckLike<R extends ResolutionLike = ResolutionLike> = {
  ruleKey?: string;
  status: string;
  severity?: string | null;
  resolutions?: R[] | null;
};

export type DerivedCheckStatus =
  | "PASS"
  | "MISMATCH"
  | "INCOMPLETE"
  | "NOT_APPLICABLE"
  | "HUMAN_CLEARED"
  | "PENDING_MANAGER_APPROVAL";

export type ClearanceContext = {
  /** True when the result belongs to the latest run for the shipment. Defaults to true. */
  isLatestRun?: boolean;
  /** True when that run's revision equals the shipment's current revision. Defaults to true. */
  atCurrentRevision?: boolean;
};

export type ClearanceProblem =
  | "UNRESOLVED"
  | "EXCEPTION_MISSING_EVIDENCE"
  | "EXCEPTION_MISSING_REASON";

export type CheckClearance<R extends ResolutionLike = ResolutionLike> = {
  isFailing: boolean;
  isBlockingSeverity: boolean;
  /** Failing BLOCKING result in the latest run at the current revision. */
  isCurrentBlockingFailure: boolean;
  clearedForSubmission: boolean;
  clearedForApproval: boolean;
  blocksSubmission: boolean;
  blocksApproval: boolean;
  /** Latest valid ACCEPTED_EXCEPTION, if any. */
  activeException: R | null;
  /** Latest resolution of any type (for display/audit). */
  activeResolution: R | null;
  /** Why submission is blocked, when it is. */
  problem: ClearanceProblem | null;
  derivedStatus: DerivedCheckStatus;
};

function toTime(value: Date | string | null | undefined) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Oldest first; ties broken by ID. Never mutates the input. */
export function sortResolutions<R extends ResolutionLike>(resolutions: readonly R[] | null | undefined): R[] {
  return [...(resolutions ?? [])].sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt) || a.id.localeCompare(b.id));
}

/** Latest resolution of any type, deterministic under createdAt ties. */
export function activeResolution<R extends ResolutionLike>(resolutions: readonly R[] | null | undefined): R | null {
  const sorted = sortResolutions(resolutions);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

export function isFailing(status: string) {
  return (FAILING_STATUSES as readonly string[]).includes(status);
}

export function hasValidReason(resolution: ResolutionLike) {
  return typeof resolution.reason === "string" && resolution.reason.trim().length >= MIN_RESOLUTION_REASON_LENGTH;
}

export function hasValidEvidence(resolution: ResolutionLike) {
  return typeof resolution.evidence === "string" && resolution.evidence.trim().length >= MIN_EXCEPTION_EVIDENCE_LENGTH;
}

export function isValidException(resolution: ResolutionLike) {
  return resolution.type === "ACCEPTED_EXCEPTION" && hasValidReason(resolution) && hasValidEvidence(resolution);
}

export function evaluateClearance<R extends ResolutionLike>(
  check: CheckLike<R>,
  context: ClearanceContext = {},
): CheckClearance<R> {
  const isLatestRun = context.isLatestRun ?? true;
  const atCurrentRevision = context.atCurrentRevision ?? true;
  const failing = isFailing(check.status);
  const isBlockingSeverity = (check.severity ?? "BLOCKING") !== "WARNING";
  const isCurrentBlockingFailure = failing && isBlockingSeverity && isLatestRun && atCurrentRevision;

  const sorted = sortResolutions(check.resolutions);
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const validExceptions = sorted.filter(isValidException);
  const activeException = validExceptions.length > 0 ? validExceptions[validExceptions.length - 1] : null;
  const approvedException = [...validExceptions].reverse().find((resolution) => Boolean(resolution.managerApprovedAt)) ?? null;

  const clearedForSubmission = !isCurrentBlockingFailure || activeException !== null;
  const clearedForApproval = !isCurrentBlockingFailure || approvedException !== null;

  let problem: ClearanceProblem | null = null;
  if (!clearedForSubmission) {
    const exceptions = sorted.filter((resolution) => resolution.type === "ACCEPTED_EXCEPTION");
    const latestException = exceptions.length > 0 ? exceptions[exceptions.length - 1] : null;
    if (latestException && !hasValidEvidence(latestException)) problem = "EXCEPTION_MISSING_EVIDENCE";
    else if (latestException && !hasValidReason(latestException)) problem = "EXCEPTION_MISSING_REASON";
    else problem = "UNRESOLVED";
  }

  let derivedStatus: DerivedCheckStatus = check.status as DerivedCheckStatus;
  if (failing && approvedException) derivedStatus = "HUMAN_CLEARED";
  else if (failing && activeException) derivedStatus = "PENDING_MANAGER_APPROVAL";

  return {
    isFailing: failing,
    isBlockingSeverity,
    isCurrentBlockingFailure,
    clearedForSubmission,
    clearedForApproval,
    blocksSubmission: !clearedForSubmission,
    blocksApproval: !clearedForApproval,
    activeException,
    activeResolution: latest,
    problem,
    derivedStatus,
  };
}

export type ClearanceSummary<C> = {
  evaluated: Array<{ check: C; clearance: CheckClearance }>;
  submissionBlockers: C[];
  approvalBlockers: C[];
  /** Failing BLOCKING checks cleared for submission but still awaiting manager sign-off. */
  pendingManagerApproval: C[];
  /** Statuses of failing BLOCKING checks with no valid exception at all. */
  unresolvedStatuses: Array<"MISMATCH" | "INCOMPLETE">;
};

export function summarizeClearance<C extends CheckLike>(checks: readonly C[], context: ClearanceContext = {}): ClearanceSummary<C> {
  const evaluated = checks.map((check) => ({ check, clearance: evaluateClearance(check, context) as CheckClearance }));
  return {
    evaluated,
    submissionBlockers: evaluated.filter((entry) => entry.clearance.blocksSubmission).map((entry) => entry.check),
    approvalBlockers: evaluated.filter((entry) => entry.clearance.blocksApproval).map((entry) => entry.check),
    pendingManagerApproval: evaluated
      .filter((entry) => entry.clearance.clearedForSubmission && entry.clearance.blocksApproval)
      .map((entry) => entry.check),
    unresolvedStatuses: evaluated
      .filter((entry) => entry.clearance.blocksSubmission)
      .map((entry) => entry.check.status as "MISMATCH" | "INCOMPLETE"),
  };
}

/** Latest result per rule; ties broken by createdAt then ID (deterministic). */
export function selectLatestByRule<C extends { ruleKey: string; createdAt: Date | string; id?: string }>(checks: readonly C[]): C[] {
  const latest = new Map<string, C>();
  for (const check of checks) {
    const existing = latest.get(check.ruleKey);
    if (!existing) {
      latest.set(check.ruleKey, check);
      continue;
    }
    const delta = toTime(check.createdAt) - toTime(existing.createdAt);
    if (delta > 0 || (delta === 0 && String(check.id ?? "") > String(existing.id ?? ""))) latest.set(check.ruleKey, check);
  }
  return [...latest.values()];
}
