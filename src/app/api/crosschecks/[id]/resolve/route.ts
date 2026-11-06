import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { createCrossCheckRun, getLatestCrossCheckRun } from "@/lib/crosschecks/service";

const resolutionSchema = z.object({
  type: z.enum(["SOURCE_CORRECTED", "DOCUMENT_REPLACEMENT", "ACCEPTED_EXCEPTION"]),
  reason: z.string().trim().min(5).max(500),
  evidence: z.string().trim().max(500).optional(),
  valuesConfirmed: z.boolean().refine((val) => val === true, {
    message: "You must confirm that you have reviewed the extracted values and source documents.",
  }),
});

/**
 * Week 4 Step 8: Failed Cross-Check Resolution Route
 *
 * 1. Requires explicit reviewer confirmation of compared values.
 * 2. Requires resolution type (SOURCE_CORRECTED, DOCUMENT_REPLACEMENT, or ACCEPTED_EXCEPTION).
 * 3. Requires reason (min 5 chars) and actor; requires evidence when ACCEPTED_EXCEPTION is used.
 * 4. For ACCEPTED_EXCEPTION: marks pending manager approval (managerApprovedAt: null for Executive, Date for Manager).
 * 5. Does NOT mutate historical CrossCheckResult (preserves immutability).
 * 6. Records AuditEvent in the same transaction.
 * 7. For SOURCE_CORRECTED and DOCUMENT_REPLACEMENT, triggers a check run and returns updated checks.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const input = resolutionSchema.parse(await request.json());

    // Rule 5: Evidence/query reference required for accepted exceptions or external info
    if (input.type === "ACCEPTED_EXCEPTION" && (!input.evidence || input.evidence.trim().length < 3)) {
      throw new Error("Evidence or query reference is required for accepted exceptions (e.g. ticket #, email ref).");
    }

    const prisma = getPrisma();
    const check = await prisma.crossCheckResult.findFirst({
      where: {
        id,
        shipment: appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
      include: {
        shipment: true,
      },
    });

    if (!check) {
      throw new Error("Cross-check not found or inaccessible.");
    }

    // Rule 7: For accepted exception, Executive marks pending manager approval; Manager marks directly approved
    const managerApprovedAt =
      appUser.role === "MANAGER" && input.type === "ACCEPTED_EXCEPTION"
        ? new Date()
        : input.type !== "ACCEPTED_EXCEPTION"
          ? new Date()
          : null;

    // Rules 5, 9, 10: Create resolution and audit event in transaction without altering historical result
    const resolution = await prisma.$transaction(async (tx) => {
      const res = await tx.crossCheckResolution.create({
        data: {
          crossCheckId: check.id,
          type: input.type,
          reason: input.reason,
          evidence: input.evidence ?? null,
          resolvedById: appUser.id,
          managerApprovedAt,
        },
        include: {
          resolvedBy: {
            select: { id: true, email: true, fullName: true, role: true },
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId: check.shipmentId,
          actorId: appUser.id,
          action: "CROSS_CHECK_RESOLVED",
          entityType: "CrossCheckResolution",
          entityId: res.id,
          metadata: {
            crossCheckId: check.id,
            ruleKey: check.ruleKey,
            ruleCode: check.ruleCode,
            type: input.type,
            reason: input.reason,
            evidence: input.evidence ?? null,
            managerApproved: managerApprovedAt !== null,
          },
        },
      });

      return res;
    });

    // Rule 6: For source correction or document replacement, re-run checks
    let latestCheckRun = null;
    if (input.type === "SOURCE_CORRECTED" || input.type === "DOCUMENT_REPLACEMENT") {
      try {
        await createCrossCheckRun({
          shipmentId: check.shipmentId,
          requestedById: appUser.id,
          triggeredBy: `RESOLUTION_${input.type}`,
          prismaClient: prisma,
        });
      } catch (runErr) {
        console.error("Failed to re-run cross-checks on resolution:", runErr);
      }
    }

    // Retrieve decorated checks with effective statuses
    try {
      latestCheckRun = await getLatestCrossCheckRun({
        shipmentId: check.shipmentId,
        prismaClient: prisma,
      });
    } catch {
      // Safe fallback
    }

    return NextResponse.json(
      {
        resolution,
        latestRun: latestCheckRun,
        effectiveStatus:
          managerApprovedAt !== null ? "HUMAN_CLEARED" : "PENDING_MANAGER_APPROVAL",
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
