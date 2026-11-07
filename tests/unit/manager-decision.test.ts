import { describe, expect, it, vi, beforeEach } from "vitest";

import { processManagerDecision } from "@/lib/manager/decision";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { POST as approveRoute } from "@/app/api/shipments/[id]/approve/route";
import { POST as decisionRoute } from "@/app/api/shipments/[id]/decision/route";
import { canExport } from "@/lib/export/guard";
import { ReviewError } from "@/lib/errors";

/**
 * Week 5 Step 2: manager decision.
 * The fake models the conditional row lock (status READY_FOR_APPROVAL + exact revision) and
 * rolls back writes when the transaction throws. Real concurrency is in
 * tests/integration/week5-decision-export.test.ts.
 */

const managerUser = { id: "manager-uuid-001", email: "manager@cargoverity.test", role: "MANAGER" as const };
const executiveUser = { id: "executive-uuid-001", email: "executive@cargoverity.test", role: "EXECUTIVE" as const };

type Resolution = { id: string; type: string; reason: string; evidence: string | null; managerApprovedAt: Date | null; createdAt: Date };
type Result = { id: string; ruleKey: string; status: string; severity: string; resolutions: Resolution[] };

function makeState(options: { status?: string; revision?: number; runRevision?: number | null; results?: Result[] } = {}) {
  return {
    shipment: { id: "test-shipment", reference: "SHP-2026-001", status: options.status ?? "READY_FOR_APPROVAL", currentRevision: options.revision ?? 1 },
    run:
      options.runRevision === null
        ? null
        : {
            id: "run-1",
            revision: options.runRevision ?? options.revision ?? 1,
            results: options.results ?? [{ id: "c-1", ruleKey: "gross_weight_comparison", status: "PASS", severity: "BLOCKING", resolutions: [] }],
          },
    approvals: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    signedOff: [] as string[],
  };
}

function fakePrisma(state: ReturnType<typeof makeState>) {
  const tx = {
    shipment: {
      updateMany: vi.fn(async ({ where }: { where: { currentRevision: number; status: string } }) =>
        state.shipment.currentRevision === where.currentRevision && state.shipment.status === where.status ? { count: 1 } : { count: 0 },
      ),
      findUnique: vi.fn(async () => ({ ...state.shipment })),
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        state.shipment.status = data.status;
        return { ...state.shipment };
      }),
    },
    crossCheckRun: { findFirst: vi.fn(async () => state.run) },
    approval: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        const row = { id: "approval-1", ...create };
        state.approvals.push(row);
        return row;
      }),
    },
    crossCheckResolution: {
      updateMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        state.signedOff.push(...where.id.in);
        return { count: where.id.in.length };
      }),
    },
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (state.audits.push(data), data)) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) => {
      const snapshot = structuredClone({ shipment: state.shipment, approvals: state.approvals, audits: state.audits, signedOff: state.signedOff });
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(state.shipment, snapshot.shipment);
        state.approvals.splice(0, state.approvals.length, ...snapshot.approvals);
        state.audits.splice(0, state.audits.length, ...snapshot.audits);
        state.signedOff.splice(0, state.signedOff.length, ...snapshot.signedOff);
        throw error;
      }
    }),
  };
  return { prisma, tx };
}

const failingWithException = (approved: boolean): Result => ({
  id: "c-1",
  ruleKey: "gross_weight_comparison",
  status: "MISMATCH",
  severity: "BLOCKING",
  resolutions: [
    {
      id: "res-exception-1",
      type: "ACCEPTED_EXCEPTION",
      reason: "Supplier confirmed the 45 kg packaging variance",
      evidence: "TKT-8492",
      managerApprovedAt: approved ? new Date() : null,
      createdAt: new Date("2026-11-06T10:00:00Z"),
    },
  ],
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return error instanceof ReviewError ? `${error.status}:${error.code}` : (error as Error).message;
  }
}

describe("Manager Decision Flow (Week 5 Step 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Server Authorization: Executive 403 (Rule 6)", () => {
    for (const [name, route] of [
      ["/decision", decisionRoute],
      ["/approve (alias)", approveRoute],
    ] as const) {
      it(`rejects Executive callers with 403 on ${name}`, async () => {
        vi.spyOn(auth, "requireRole").mockRejectedValue(new Error("FORBIDDEN"));
        const response = await route(
          new Request("http://localhost:3000/api/shipments/test-shipment/decision", {
            method: "POST",
            body: JSON.stringify({ decision: "APPROVE", expectedRevision: 1 }),
          }),
          { params: Promise.resolve({ id: "test-shipment" }) },
        );
        expect(response.status).toBe(403);
        expect((await response.json()).error).toMatch(/permission/i);
      });
    }

    it("the engine rejects a non-Manager even when called directly", async () => {
      expect(
        await codeOf(processManagerDecision({ shipmentId: "s", managerUser: executiveUser, decision: "APPROVE", expectedRevision: 1 })),
      ).toBe("FORBIDDEN");
    });

    it("a bare POST without decision / expectedRevision is a 400 and never approves", async () => {
      vi.spyOn(auth, "requireRole").mockResolvedValue({ appUser: managerUser as never, authUser: { id: managerUser.id } as never });
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state).prisma as never);

      for (const body of [{}, { decision: "APPROVE" }]) {
        const response = await approveRoute(
          new Request("http://localhost/api/shipments/test-shipment/approve", { method: "POST", body: JSON.stringify(body) }),
          { params: Promise.resolve({ id: "test-shipment" }) },
        );
        expect(response.status).toBe(400);
      }
      expect(state.shipment.status).toBe("READY_FOR_APPROVAL");
    });
  });

  describe("Approval", () => {
    it("approves a submitted shipment atomically: Approval row, APPROVED status and audit with manager, comment and revision", async () => {
      const state = makeState();
      const { prisma, tx } = fakePrisma(state);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const result = await processManagerDecision({
        shipmentId: "test-shipment",
        managerUser,
        decision: "APPROVE",
        comment: "Looks complete",
        expectedRevision: 1,
      });

      expect(result).toMatchObject({ success: true, decision: "APPROVE", shipment: { status: "APPROVED", currentRevision: 1 } });
      expect(tx.shipment.updateMany).toHaveBeenCalledWith({
        where: { id: "test-shipment", currentRevision: 1, status: "READY_FOR_APPROVAL" },
        data: { currentRevision: 1 },
      });
      expect(tx.approval.upsert).toHaveBeenCalledWith({
        where: { shipmentId_revision: { shipmentId: "test-shipment", revision: 1 } },
        update: expect.objectContaining({ approvedById: managerUser.id, approvedAt: expect.any(Date) }),
        create: expect.objectContaining({ approvedById: managerUser.id, revision: 1, approvedAt: expect.any(Date) }),
      });
      expect(state.audits[0]).toMatchObject({
        action: "SHIPMENT_APPROVED",
        actorId: managerUser.id,
        metadata: expect.objectContaining({ decision: "APPROVE", comment: "Looks complete", revision: 1, previousStatus: "READY_FOR_APPROVAL", checkRunId: "run-1" }),
      });
    });

    it("signs off pending accepted exceptions and requires a meaningful comment for them (Rule 8)", async () => {
      const noComment = makeState({ results: [failingWithException(false)] });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(noComment).prisma as never);
      expect(
        await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "APPROVE", comment: "ok", expectedRevision: 1 })),
      ).toBe("422:COMMENT_REQUIRED");
      expect(noComment.shipment.status).toBe("READY_FOR_APPROVAL");
      expect(noComment.approvals).toHaveLength(0);

      const withComment = makeState({ results: [failingWithException(false)] });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(withComment).prisma as never);
      const result = await processManagerDecision({
        shipmentId: "test-shipment",
        managerUser,
        decision: "APPROVE",
        comment: "Variance accepted per supplier letter",
        expectedRevision: 1,
      });
      expect(result.signedOffExceptionIds).toEqual(["res-exception-1"]);
      expect(withComment.signedOff).toEqual(["res-exception-1"]);
      expect(withComment.audits[0]).toMatchObject({
        metadata: expect.objectContaining({
          hasAcceptedException: true,
          signedOffExceptions: [{ ruleKey: "gross_weight_comparison", resolutionId: "res-exception-1", evidence: "TKT-8492" }],
        }),
      });
    });

    it("blocks approval with unresolved checks, a missing check run or a stale run", async () => {
      const unresolved = makeState({ results: [{ id: "c", ruleKey: "invoice_line_total", status: "MISMATCH", severity: "BLOCKING", resolutions: [] }] });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(unresolved).prisma as never);
      expect(await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "APPROVE", expectedRevision: 1 }))).toBe(
        "422:UNRESOLVED_CROSS_CHECKS",
      );

      const noRun = makeState({ runRevision: null });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(noRun).prisma as never);
      expect(await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "APPROVE", expectedRevision: 1 }))).toBe(
        "422:CHECKS_NOT_RUN",
      );

      const stale = makeState({ revision: 3, runRevision: 2 });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(stale).prisma as never);
      expect(await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "APPROVE", expectedRevision: 3 }))).toBe(
        "409:STALE_CHECK_RUN",
      );
      expect(stale.shipment.status).toBe("READY_FOR_APPROVAL");
    });

    it("a WARNING-only failure does not block approval", async () => {
      const state = makeState({ results: [{ id: "w", ruleKey: "exporter_consistency", status: "MISMATCH", severity: "WARNING", resolutions: [] }] });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state).prisma as never);
      expect(await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "APPROVE", expectedRevision: 1 }))).toBe("OK");
    });
  });

  describe("Status and revision gates", () => {
    it.each(["DRAFT", "IN_REVIEW", "NEEDS_REVIEW", "EXTRACTING", "APPROVED", "EXPORTED"])(
      "a shipment that is %s (not submitted) cannot be approved or rejected (409 NOT_SUBMITTED)",
      async (status) => {
        for (const decision of ["APPROVE", "REJECT"] as const) {
          const state = makeState({ status });
          vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state).prisma as never);
          expect(
            await codeOf(
              processManagerDecision({ shipmentId: "test-shipment", managerUser, decision, comment: "Reason for decision", expectedRevision: 1 }),
            ),
          ).toBe("409:NOT_SUBMITTED");
          expect(state.shipment.status).toBe(status);
          expect(state.audits).toHaveLength(0);
        }
      },
    );

    it("a stale expectedRevision returns 409 STALE_REVISION and writes nothing", async () => {
      const state = makeState({ revision: 2 });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state).prisma as never);
      expect(await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "APPROVE", expectedRevision: 1 }))).toBe(
        "409:STALE_REVISION",
      );
      expect(state.approvals).toHaveLength(0);
    });

    it("an unknown shipment is 404", async () => {
      const state = makeState();
      const { prisma, tx } = fakePrisma(state);
      tx.shipment.updateMany.mockResolvedValue({ count: 0 });
      tx.shipment.findUnique.mockResolvedValue(null as never);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);
      expect(await codeOf(processManagerDecision({ shipmentId: "nope", managerUser, decision: "APPROVE", expectedRevision: 1 }))).toBe(
        "404:SHIPMENT_NOT_FOUND",
      );
    });
  });

  describe("Rejection (Rules 7 & 11)", () => {
    it("returns the shipment to NEEDS_REVIEW and audits manager, comment and revision", async () => {
      const state = makeState({ revision: 2 });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state).prisma as never);

      const result = await processManagerDecision({
        shipmentId: "test-shipment",
        managerUser,
        decision: "REJECT",
        comment: "Weights do not match the BL; re-check the packing list",
        expectedRevision: 2,
      });

      expect(result).toMatchObject({ success: true, decision: "REJECT", shipment: { status: "NEEDS_REVIEW", currentRevision: 2 } });
      expect(state.audits[0]).toMatchObject({
        action: "SHIPMENT_REJECTED",
        actorId: managerUser.id,
        metadata: { decision: "REJECT", comment: "Weights do not match the BL; re-check the packing list", revision: 2, previousStatus: "READY_FOR_APPROVAL" },
      });
    });

    it("requires a meaningful comment (422 COMMENT_REQUIRED) before touching the database", async () => {
      const state = makeState();
      const { prisma } = fakePrisma(state);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);
      for (const comment of [undefined, "", "no"]) {
        expect(
          await codeOf(processManagerDecision({ shipmentId: "test-shipment", managerUser, decision: "REJECT", comment, expectedRevision: 1 })),
        ).toBe("422:COMMENT_REQUIRED");
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("Edit-after-approval invalidation (Rule 12)", () => {
    it("a revision bump after approval makes the approval stale for export", () => {
      const approvedGuard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });
      expect(approvedGuard.allowed).toBe(true);

      // The material change bumped the revision to 2; the Approval row is for revision 1.
      const invalidatedGuard = canExport({
        shipmentStatus: "IN_REVIEW",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 2,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });
      expect(invalidatedGuard.allowed).toBe(false);
      expect(invalidatedGuard.reasons).toEqual(expect.arrayContaining(["shipment_not_approved", "approval_is_stale"]));
    });
  });
});
