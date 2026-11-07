import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { ReviewError } from "@/lib/errors";
import { summarizeClearance } from "@/lib/crosschecks/resolution-state";
import { UserRole } from "@/generated/prisma/enums";

export type ManagerDecisionType = "APPROVE" | "REJECT";

export const MIN_DECISION_COMMENT_LENGTH = 5;

export type ManagerDecisionInput = {
  shipmentId: string;
  managerUser: { id: string; email?: string | null; role: UserRole };
  decision: ManagerDecisionType;
  comment?: string | null;
  /** Revision the manager reviewed. Required: a decision always refers to one exact revision. */
  expectedRevision: number;
};

export type ManagerDecisionResult = {
  success: boolean;
  decision: ManagerDecisionType;
  shipment: {
    id: string;
    reference: string;
    status: string;
    currentRevision: number;
  };
  approval?: {
    id: string;
    shipmentId: string;
    revision: number;
    approvedById: string;
    approvedAt: Date;
  } | null;
  comment?: string | null;
  /** Accepted-exception resolutions this approval signed off. */
  signedOffExceptionIds?: string[];
};

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Takes the shipment row lock at exactly (READY_FOR_APPROVAL, expectedRevision) with a no-op
 * conditional update. Every material change bumps the revision (and resets the status), so a
 * concurrent edit either commits first (lock fails, 409) or waits for this decision to commit.
 */
async function lockSubmittedShipment(tx: Tx, shipmentId: string, expectedRevision: number) {
  const locked = await tx.shipment.updateMany({
    where: { id: shipmentId, currentRevision: expectedRevision, status: "READY_FOR_APPROVAL" },
    data: { currentRevision: expectedRevision },
  });
  if (locked.count === 1) return;

  const current = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: { status: true, currentRevision: true },
  });
  if (!current) throw new ReviewError("Shipment not found.", "SHIPMENT_NOT_FOUND", 404);
  if (current.status !== "READY_FOR_APPROVAL") {
    throw new ReviewError(
      `Only shipments submitted for approval can be approved or rejected (current status: ${current.status}).`,
      "NOT_SUBMITTED",
      409,
    );
  }
  throw new ReviewError(
    `Stale shipment revision. Expected revision ${expectedRevision}, but current revision is ${current.currentRevision}. Refresh and review the latest version.`,
    "STALE_REVISION",
    409,
  );
}

/**
 * Week 5 Step 2: Manager Decision Engine
 *
 * - Manager role only (Rule 6); the decision applies only to a shipment the Executive submitted
 *   (status READY_FOR_APPROVAL) at the exact revision the manager reviewed (`expectedRevision`).
 * - Rejection requires a meaningful comment (Rule 7) and returns the shipment to NEEDS_REVIEW (Rule 11).
 * - Approval re-reads the latest check run under the row lock: it must exist, match the current
 *   revision and have no unresolved blocking failures. Approving accepted exceptions requires a
 *   meaningful comment (Rule 8) and stamps their manager sign-off.
 * - Approval row (revision, approvedBy, approvedAt), status change, sign-offs and the
 *   SHIPMENT_APPROVED / SHIPMENT_REJECTED audit event (Rule 9) commit atomically (Rule 10).
 * - Any later material change bumps the revision, so the Approval row no longer matches and
 *   export is blocked (Rule 12).
 */
export async function processManagerDecision(
  input: ManagerDecisionInput,
  options: { prismaClient?: ReturnType<typeof getPrisma> } = {},
): Promise<ManagerDecisionResult> {
  if (input.managerUser.role !== "MANAGER") {
    throw new Error("FORBIDDEN");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new ReviewError("expectedRevision is required for a manager decision.", "STALE_REVISION", 400);
  }

  const prisma = options.prismaClient ?? getPrisma();
  const trimmedComment = input.comment?.trim() ?? "";

  if (input.decision === "REJECT" && trimmedComment.length < MIN_DECISION_COMMENT_LENGTH) {
    throw new ReviewError(
      "A meaningful comment (minimum 5 characters) is required when rejecting a shipment.",
      "COMMENT_REQUIRED",
      422,
    );
  }

  return prisma.$transaction(async (tx) => {
    await lockSubmittedShipment(tx, input.shipmentId, input.expectedRevision);

    if (input.decision === "REJECT") {
      const updated = await tx.shipment.update({
        where: { id: input.shipmentId },
        data: { status: "NEEDS_REVIEW" },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId: input.shipmentId,
          actorId: input.managerUser.id,
          action: "SHIPMENT_REJECTED",
          entityType: "Shipment",
          entityId: input.shipmentId,
          metadata: {
            decision: "REJECT",
            comment: trimmedComment,
            revision: input.expectedRevision,
            previousStatus: "READY_FOR_APPROVAL",
          },
        },
      });

      return {
        success: true,
        decision: "REJECT" as const,
        shipment: {
          id: updated.id,
          reference: updated.reference,
          status: updated.status,
          currentRevision: updated.currentRevision,
        },
        comment: trimmedComment,
      };
    }

    // APPROVE: authoritative cross-check evaluation on the locked row.
    const latestRun = await tx.crossCheckRun.findFirst({
      where: { shipmentId: input.shipmentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        results: {
          include: { resolutions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
        },
      },
    });

    if (!latestRun) {
      throw new ReviewError("Run cross-checks before manager approval.", "CHECKS_NOT_RUN", 422);
    }
    if (latestRun.revision !== input.expectedRevision) {
      throw new ReviewError(
        `Cannot approve shipment with stale cross-checks (checks are on revision ${latestRun.revision}, current shipment revision is ${input.expectedRevision}). Re-run cross-checks before approval.`,
        "STALE_CHECK_RUN",
        409,
      );
    }

    // Shared clearance rules: a failing BLOCKING check needs a valid ACCEPTED_EXCEPTION (this
    // approval supplies the sign-off). Audit-link resolutions never clear a current failure.
    const clearance = summarizeClearance(latestRun.results, { isLatestRun: true, atCurrentRevision: true });
    if (clearance.submissionBlockers.length > 0) {
      throw new ReviewError(
        `Unresolved cross-checks (${clearance.submissionBlockers.map((c) => c.ruleKey).join(", ")}) require review before approval.`,
        "UNRESOLVED_CROSS_CHECKS",
        422,
      );
    }

    const exceptionsToSignOff = clearance.evaluated
      .filter((entry) => entry.clearance.isCurrentBlockingFailure && entry.clearance.activeException)
      .map((entry) => ({ ruleKey: entry.check.ruleKey, resolution: entry.clearance.activeException! }));
    const hasAcceptedException = exceptionsToSignOff.length > 0;

    if (hasAcceptedException && trimmedComment.length < MIN_DECISION_COMMENT_LENGTH) {
      throw new ReviewError(
        "A meaningful comment (minimum 5 characters) is required when approving a shipment with accepted exceptions.",
        "COMMENT_REQUIRED",
        422,
      );
    }

    const approvedAt = new Date();
    const approval = await tx.approval.upsert({
      where: { shipmentId_revision: { shipmentId: input.shipmentId, revision: input.expectedRevision } },
      update: { approvedById: input.managerUser.id, approvedAt },
      create: {
        shipmentId: input.shipmentId,
        revision: input.expectedRevision,
        approvedById: input.managerUser.id,
        approvedAt,
      },
    });

    const updatedShipment = await tx.shipment.update({
      where: { id: input.shipmentId },
      data: { status: "APPROVED" },
    });

    const signedOffExceptionIds = exceptionsToSignOff
      .filter((entry) => !entry.resolution.managerApprovedAt)
      .map((entry) => entry.resolution.id);
    if (signedOffExceptionIds.length > 0) {
      await tx.crossCheckResolution.updateMany({
        where: { id: { in: signedOffExceptionIds } },
        data: { managerApprovedAt: approvedAt },
      });
    }

    await tx.auditEvent.create({
      data: {
        shipmentId: input.shipmentId,
        actorId: input.managerUser.id,
        action: "SHIPMENT_APPROVED",
        entityType: "Shipment",
        entityId: input.shipmentId,
        metadata: {
          decision: "APPROVE",
          comment: trimmedComment || null,
          revision: input.expectedRevision,
          previousStatus: "READY_FOR_APPROVAL",
          approvalId: approval.id,
          checkRunId: latestRun.id,
          hasAcceptedException,
          signedOffExceptions: exceptionsToSignOff.map((entry) => ({
            ruleKey: entry.ruleKey,
            resolutionId: entry.resolution.id,
            evidence: entry.resolution.evidence ?? null,
          })),
        },
      },
    });

    return {
      success: true,
      decision: "APPROVE" as const,
      shipment: {
        id: updatedShipment.id,
        reference: updatedShipment.reference,
        status: updatedShipment.status,
        currentRevision: updatedShipment.currentRevision,
      },
      approval,
      comment: trimmedComment || null,
      signedOffExceptionIds,
    };
  }, TX);
}
