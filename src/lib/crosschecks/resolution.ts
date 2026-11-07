import { z } from "zod";

import type { Prisma, PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import { ReviewError, safeErrorCode } from "@/lib/errors";
import * as crossCheckService from "./service";
import {
  evaluateClearance,
  isFailing,
  MIN_EXCEPTION_EVIDENCE_LENGTH,
  MIN_RESOLUTION_REASON_LENGTH,
} from "./resolution-state";

/**
 * Week 4 Step 8: resolving a failed cross-check.
 *
 * - The reviewer must confirm the compared values (`valuesConfirmed: true`), give a reason
 *   (>= 5 chars) and send `expectedRevision`; the actor is the signed-in user.
 * - ACCEPTED_EXCEPTION: only for a failing check in the latest run at the current revision;
 *   requires external evidence (>= 3 chars). An Executive's exception waits for manager
 *   sign-off; a Manager's exception is signed off immediately.
 * - SOURCE_CORRECTED / DOCUMENT_REPLACEMENT (alias DOCUMENT_REPLACED): audit links from a failed
 *   check in an OLDER run to the fix. They need a real FieldCorrection (or DOCUMENT_REPLACED audit
 *   event) after the failed check and the latest run's same rule must no longer fail. They never
 *   set managerApprovedAt and never clear a current failure.
 * - Resolutions and audit events are append-only; CrossCheckResult rows are never modified.
 *   The resolution takes the shipment revision lock without bumping the revision.
 */

export type ResolutionActor = { id: string; role: "EXECUTIVE" | "MANAGER" };

export const RESOLVABLE_STATUSES: readonly ShipmentStatus[] = ["DRAFT", "IN_REVIEW", "NEEDS_REVIEW"];

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const resolveCheckSchema = z.object({
  type: z
    .enum(["SOURCE_CORRECTED", "DOCUMENT_REPLACEMENT", "DOCUMENT_REPLACED", "ACCEPTED_EXCEPTION"])
    .transform((type) => (type === "DOCUMENT_REPLACED" ? "DOCUMENT_REPLACEMENT" : type)),
  reason: z.string().trim().min(MIN_RESOLUTION_REASON_LENGTH).max(500),
  evidence: z.string().trim().max(500).nullable().optional(),
  valuesConfirmed: z.literal(true, {
    message: "You must confirm that you have reviewed the compared values and source documents.",
  }),
  expectedRevision: z.number().int().positive(),
});

async function lockWithoutBump(tx: Prisma.TransactionClient, shipmentId: string, expectedRevision: number) {
  // A no-op conditional update takes the shipment row lock, serializing with edits and mappings.
  const locked = await tx.shipment.updateMany({
    where: { id: shipmentId, currentRevision: expectedRevision, status: { in: [...RESOLVABLE_STATUSES] } },
    data: { currentRevision: expectedRevision },
  });
  if (locked.count !== 1) {
    const current = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
    if (current && !RESOLVABLE_STATUSES.includes(current.status)) {
      throw new ReviewError(`Checks cannot be resolved while the shipment is ${current.status}.`, "SHIPMENT_LOCKED", 409);
    }
    throw new ReviewError("The shipment changed since you loaded it. Refresh and try again.", "STALE_REVISION", 409);
  }
}

export async function resolveCheck(
  prisma: PrismaClient,
  params: { checkId: string; actor: ResolutionActor; body: unknown },
) {
  const input = resolveCheckSchema.parse(params.body);
  const evidence = input.evidence?.trim() || null;

  if (input.type === "ACCEPTED_EXCEPTION" && (!evidence || evidence.length < MIN_EXCEPTION_EVIDENCE_LENGTH)) {
    throw new ReviewError(
      "An external evidence or query reference (at least 3 characters, e.g. a ticket or email reference) is required for an accepted exception.",
      "EVIDENCE_REQUIRED",
      422,
    );
  }

  const check = await prisma.crossCheckResult.findFirst({
    where: {
      id: params.checkId,
      shipment: params.actor.role === "MANAGER" ? undefined : { createdById: params.actor.id },
    },
    select: { id: true, shipmentId: true },
  });
  if (!check) throw new ReviewError("Cross-check not found or inaccessible.", "CHECK_NOT_FOUND", 404);

  const resolution = await prisma.$transaction(async (tx) => {
    await lockWithoutBump(tx, check.shipmentId, input.expectedRevision);

    const current = await tx.crossCheckResult.findUniqueOrThrow({ where: { id: check.id } });
    const latestRun = await tx.crossCheckRun.findFirst({
      where: { shipmentId: check.shipmentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { results: { select: { id: true, ruleKey: true, status: true } } },
    });

    if (!isFailing(current.status)) {
      throw new ReviewError("Only a failing (MISMATCH or INCOMPLETE) check can be resolved.", "CHECK_NOT_FAILING", 409);
    }

    const inLatestRun = Boolean(latestRun && current.runId === latestRun.id && latestRun.revision === input.expectedRevision);

    if (input.type === "ACCEPTED_EXCEPTION") {
      if (!inLatestRun) {
        throw new ReviewError(
          "This check is from an older run. Re-run checks and resolve the current result.",
          "CHECK_NOT_LATEST",
          409,
        );
      }
    } else {
      // Audit link: the failure must be historical and actually fixed.
      const latestSameRule = latestRun?.results.find((result) => result.ruleKey === current.ruleKey) ?? null;
      const fixedInLatestRun = !inLatestRun && latestSameRule !== null && !isFailing(latestSameRule.status);

      const evidenceOfFix =
        input.type === "SOURCE_CORRECTED"
          ? await tx.fieldCorrection.findFirst({
              where: { createdAt: { gt: current.createdAt }, field: { document: { shipmentId: check.shipmentId } } },
              select: { id: true },
            })
          : await tx.auditEvent.findFirst({
              where: { shipmentId: check.shipmentId, action: "DOCUMENT_REPLACED", createdAt: { gt: current.createdAt } },
              select: { id: true },
            });

      if (!fixedInLatestRun || !evidenceOfFix) {
        throw new ReviewError(
          input.type === "SOURCE_CORRECTED"
            ? "Source corrected can only link a failed check from an older run to a saved field correction after which the same check passes. Correct the value first, re-run checks, or record an accepted exception."
            : "Document replaced can only link a failed check from an older run to an uploaded replacement after which the same check passes. Replace the document first, re-run checks, or record an accepted exception.",
          "RESOLUTION_LINK_INVALID",
          409,
        );
      }
    }

    const managerApprovedAt =
      input.type === "ACCEPTED_EXCEPTION" && params.actor.role === "MANAGER" ? new Date() : null;

    const created = await tx.crossCheckResolution.create({
      data: {
        crossCheckId: current.id,
        type: input.type,
        reason: input.reason,
        evidence,
        resolvedById: params.actor.id,
        managerApprovedAt,
      },
      include: { resolvedBy: { select: { id: true, email: true, fullName: true, role: true } } },
    });

    await tx.auditEvent.create({
      data: {
        shipmentId: check.shipmentId,
        actorId: params.actor.id,
        action: "CROSS_CHECK_RESOLVED",
        entityType: "CrossCheckResolution",
        entityId: created.id,
        metadata: {
          crossCheckId: current.id,
          runId: current.runId,
          ruleKey: current.ruleKey,
          ruleCode: current.ruleCode,
          type: input.type,
          reason: input.reason,
          evidence,
          valuesConfirmed: true,
          managerApproved: managerApprovedAt !== null,
          revision: input.expectedRevision,
          checkSnapshot: { status: current.status, severity: current.severity, details: current.details },
        } as Prisma.InputJsonValue,
      },
    });

    return created;
  }, TX);

  const after = await prisma.crossCheckResult.findUnique({
    where: { id: check.id },
    include: { resolutions: true },
  });
  const effectiveStatus = after ? evaluateClearance(after).derivedStatus : null;

  let latestRun = null;
  try {
    latestRun = await crossCheckService.getLatestCrossCheckRun({ shipmentId: check.shipmentId, prismaClient: prisma });
  } catch (error) {
    console.error("[crosschecks.resolve_latest_failed]", safeErrorCode(error));
  }

  return { resolution, effectiveStatus, latestRun };
}
