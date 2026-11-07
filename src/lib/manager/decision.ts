import { getPrisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { summarizeClearance } from "@/lib/crosschecks/resolution-state";
import { UserRole } from "@/generated/prisma/enums";

export type ManagerDecisionType = "APPROVE" | "REJECT";

export type ManagerDecisionInput = {
  shipmentId: string;
  managerUser: { id: string; email?: string | null; role: UserRole };
  decision: ManagerDecisionType;
  comment?: string | null;
  expectedRevision?: number | null;
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
};

/**
 * Week 5 Step 2: Manager Decision Engine
 *
 * Enforces:
 * - Server authorization: Restricted strictly to MANAGER role (Rule 6).
 * - Comment requirement: Minimum 5 characters required for rejection (Rule 7).
 * - Comment requirement: Minimum 5 characters required when approving shipments with ACCEPTED_EXCEPTION (Rule 8).
 * - Records AuditEvent (ApprovalEvent) with manager, decision, comment, and revision (Rule 9).
 * - Sets approval record and status atomically (Rule 10).
 * - Returns rejected shipments to NEEDS_REVIEW (Rule 11).
 * - Validates shipment revision to avoid approving stale revisions (Rule 12).
 */
export async function processManagerDecision(
  input: ManagerDecisionInput,
): Promise<ManagerDecisionResult> {
  // 1. Role verification (Rule 6)
  if (input.managerUser.role !== "MANAGER") {
    throw new Error("FORBIDDEN");
  }

  const prisma = getPrisma();
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    include: {
      crossCheckRuns: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          results: {
            include: {
              resolutions: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!shipment) {
    throw new Error("Shipment not found.");
  }

  // 2. Revision conflict check
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== null &&
    input.expectedRevision !== shipment.currentRevision
  ) {
    throw new ConflictError(
      `Stale shipment revision. Expected revision ${input.expectedRevision}, but current revision is ${shipment.currentRevision}.`,
    );
  }

  // 3. Rejection decision flow (Rule 7 & 11)
  if (input.decision === "REJECT") {
    const trimmedComment = input.comment?.trim() ?? "";
    if (trimmedComment.length < 5) {
      throw new Error(
        "A meaningful comment (minimum 5 characters) is required when rejecting a shipment.",
      );
    }

    const updatedShipment = await prisma.$transaction(async (tx) => {
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
            revision: shipment.currentRevision,
          },
        },
      });

      return updated;
    });

    return {
      success: true,
      decision: "REJECT",
      shipment: {
        id: updatedShipment.id,
        reference: updatedShipment.reference,
        status: updatedShipment.status,
        currentRevision: updatedShipment.currentRevision,
      },
      comment: trimmedComment,
    };
  }

  // 4. Approval decision flow (Rule 8, 9, 10)
  const latestRun = shipment.crossCheckRuns[0] ?? null;
  if (!latestRun) {
    throw new Error("Run cross-checks before manager approval.");
  }

  if (latestRun.revision !== shipment.currentRevision) {
    throw new Error(
      `Cannot approve shipment with stale cross-checks (checks are on revision ${latestRun.revision}, current shipment revision is ${shipment.currentRevision}). Re-run cross-checks before approval.`,
    );
  }

  const checks = latestRun.results;
  // Shared clearance rules: a failing BLOCKING check needs a valid ACCEPTED_EXCEPTION (the manager's
  // approval below supplies the sign-off). Audit-link resolutions never clear a current failure.
  const clearance = summarizeClearance(checks, { isLatestRun: true, atCurrentRevision: true });
  const unresolvedChecks = clearance.submissionBlockers;

  if (unresolvedChecks.length > 0) {
    throw new Error(
      `Unresolved cross-checks (${unresolvedChecks.map((c) => c.ruleKey).join(", ")}) require review before approval.`,
    );
  }

  // Exceptions this approval signs off: active valid exceptions on failing BLOCKING checks.
  const exceptionsToSignOff = clearance.evaluated
    .filter((entry) => entry.clearance.isCurrentBlockingFailure && entry.clearance.activeException)
    .map((entry) => entry.clearance.activeException!);

  // Rule 8: If this approval relies on an accepted exception, require a meaningful manager comment
  const hasAcceptedException = exceptionsToSignOff.length > 0;

  const trimmedComment = input.comment?.trim() ?? "";
  if (hasAcceptedException && trimmedComment.length < 5) {
    throw new Error(
      "A meaningful comment (minimum 5 characters) is required when approving a shipment with accepted exceptions.",
    );
  }

  // Execute approval transaction atomically (Rule 10)
  const result = await prisma.$transaction(async (tx) => {
    // a. Record or update Approval record
    const approval = await tx.approval.upsert({
      where: {
        shipmentId_revision: {
          shipmentId: input.shipmentId,
          revision: shipment.currentRevision,
        },
      },
      update: {
        approvedById: input.managerUser.id,
        approvedAt: new Date(),
      },
      create: {
        shipmentId: input.shipmentId,
        revision: shipment.currentRevision,
        approvedById: input.managerUser.id,
        approvedAt: new Date(),
      },
    });

    // b. Update status of shipment to APPROVED
    const updatedShipment = await tx.shipment.update({
      where: { id: input.shipmentId },
      data: { status: "APPROVED" },
    });

    // c. Stamp managerApprovedAt on any pending ACCEPTED_EXCEPTION resolutions
    const resolutionIdsToApprove = exceptionsToSignOff
      .filter((r) => r.managerApprovedAt === null)
      .map((r) => r.id);

    if (resolutionIdsToApprove.length > 0) {
      await tx.crossCheckResolution.updateMany({
        where: { id: { in: resolutionIdsToApprove } },
        data: { managerApprovedAt: new Date() },
      });
    }

    // d. Record ApprovalEvent in AuditEvent (Rule 9)
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
          revision: shipment.currentRevision,
          hasAcceptedException,
        },
      },
    });

    return { updatedShipment, approval };
  });

  return {
    success: true,
    decision: "APPROVE",
    shipment: {
      id: result.updatedShipment.id,
      reference: result.updatedShipment.reference,
      status: result.updatedShipment.status,
      currentRevision: result.updatedShipment.currentRevision,
    },
    approval: result.approval,
    comment: trimmedComment || null,
  };
}

