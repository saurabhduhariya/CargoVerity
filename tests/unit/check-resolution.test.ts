import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as resolveCrossCheckRoute } from "@/app/api/crosschecks/[id]/resolve/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as crosscheckService from "@/lib/crosschecks/service";
import { deriveEffectiveCheckStatus } from "@/features/review/review-workspace";

/**
 * Week 4 Step 8: failed-check resolution.
 * ACCEPTED_EXCEPTION clears (pending manager sign-off); SOURCE_CORRECTED / DOCUMENT_REPLACEMENT
 * are audit links that need a real fix and never clear a current failure.
 */

const executiveUser = { id: "33333333-3333-4333-8333-333333333333", email: "executive@example.test", fullName: "Executive User", role: "EXECUTIVE" as const };
const managerUser = { id: "55555555-5555-4555-8555-555555555555", email: "manager@example.test", fullName: "Manager User", role: "MANAGER" as const };

const shipmentId = "11111111-1111-4111-8111-111111111111";
const checkId = "66666666-6666-4666-8666-666666666666";

type Result = {
  id: string;
  shipmentId: string;
  runId: string;
  revision: number;
  ruleKey: string;
  ruleCode: string;
  severity: string;
  status: string;
  details: Record<string, unknown>;
  createdAt: Date;
};

type FakeState = {
  shipment: { id: string; status: string; currentRevision: number };
  runs: Array<{ id: string; revision: number; createdAt: Date }>;
  results: Result[];
  resolutions: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  corrections: Array<{ createdAt: Date }>;
  replacements: Array<{ createdAt: Date }>;
};

function makeState(options: { status?: string; checkInOlderRun?: boolean; latestStatus?: string } = {}): FakeState {
  const old = new Date("2026-11-06T10:00:00Z");
  const runs = [{ id: "run-1", revision: 2, createdAt: old }];
  const results: Result[] = [
    {
      id: checkId,
      shipmentId,
      runId: "run-1",
      revision: 2,
      ruleKey: "gross_weight_comparison",
      ruleCode: "CHK_GROSS_WEIGHT",
      severity: "BLOCKING",
      status: "MISMATCH",
      details: { differenceKg: "45.000", toleranceKg: "15.825", cause: "unknown" },
      createdAt: old,
    },
  ];
  if (options.checkInOlderRun) {
    const newer = new Date("2026-11-06T12:00:00Z");
    runs.push({ id: "run-2", revision: 2, createdAt: newer });
    results.push({ ...results[0], id: "check-new", runId: "run-2", status: options.latestStatus ?? "PASS", createdAt: newer });
  }
  return {
    shipment: { id: shipmentId, status: options.status ?? "NEEDS_REVIEW", currentRevision: 2 },
    runs,
    results,
    resolutions: [],
    audits: [],
    corrections: [],
    replacements: [],
  };
}

function fakePrisma(state: FakeState) {
  const latestRun = () => [...state.runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const client = {
    shipment: {
      updateMany: vi.fn(async ({ where }: { where: { currentRevision: number; status: { in: string[] } } }) =>
        state.shipment.currentRevision === where.currentRevision && where.status.in.includes(state.shipment.status) ? { count: 1 } : { count: 0 },
      ),
      findUnique: vi.fn(async () => ({ ...state.shipment })),
    },
    crossCheckResult: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = state.results.find((r) => r.id === where.id);
        return found ? { id: found.id, shipmentId: found.shipmentId } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ ...state.results.find((r) => r.id === where.id)! })),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = state.results.find((r) => r.id === where.id);
        return found ? { ...found, resolutions: state.resolutions.filter((res) => res.crossCheckId === found.id) } : null;
      }),
    },
    crossCheckRun: {
      findFirst: vi.fn(async () => {
        const run = latestRun();
        return run ? { ...run, results: state.results.filter((r) => r.runId === run.id) } : null;
      }),
    },
    fieldCorrection: {
      findFirst: vi.fn(async ({ where }: { where: { createdAt: { gt: Date } } }) =>
        state.corrections.find((c) => c.createdAt > where.createdAt.gt) ? { id: "corr" } : null,
      ),
    },
    auditEvent: {
      findFirst: vi.fn(async ({ where }: { where: { createdAt: { gt: Date } } }) =>
        state.replacements.find((c) => c.createdAt > where.createdAt.gt) ? { id: "evt" } : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (state.audits.push(data), data)),
    },
    crossCheckResolution: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `res-${state.resolutions.length + 1}`, createdAt: new Date(), ...data };
        state.resolutions.push(row);
        return row;
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const resolutionCount = state.resolutions.length;
      const auditCount = state.audits.length;
      try {
        return await callback(client);
      } catch (error) {
        state.resolutions.splice(resolutionCount);
        state.audits.splice(auditCount);
        throw error;
      }
    }),
  };
  return client;
}

function actAs(user: typeof executiveUser | typeof managerUser) {
  vi.spyOn(auth, "requireAppUser").mockResolvedValue({ appUser: user as never, authUser: { id: user.id, email: user.email } as never });
}

const resolve = (id: string, body: unknown) =>
  resolveCrossCheckRoute(
    new Request(`http://localhost:3000/api/crosschecks/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const exceptionBody = {
  type: "ACCEPTED_EXCEPTION",
  reason: "Supplier confirmed 45 kg packing variation in writing",
  evidence: "TKT-8492",
  valuesConfirmed: true,
  expectedRevision: 2,
};

describe("Failed-Check Resolution (Week 4 Step 8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(crosscheckService, "getLatestCrossCheckRun").mockResolvedValue(null);
  });

  describe("deriveEffectiveCheckStatus (display mirrors the shared clearance rules)", () => {
    it("PASS stays PASS; an unresolved failure shows its status", () => {
      expect(deriveEffectiveCheckStatus("PASS", null).label).toBe("Passed");
      const mismatch = deriveEffectiveCheckStatus("MISMATCH", null);
      expect(mismatch).toMatchObject({ label: "Mismatch", isHumanCleared: false, isPendingApproval: false });
    });

    it("a valid exception awaits manager approval and is neutrally labeled Exception approved after sign-off", () => {
      const base = { id: "r", type: "ACCEPTED_EXCEPTION" as const, reason: "Supplier confirmed variation", evidence: "TKT-8492" };
      expect(deriveEffectiveCheckStatus("MISMATCH", { ...base, managerApprovedAt: null })).toMatchObject({ isPendingApproval: true, isHumanCleared: false });
      expect(deriveEffectiveCheckStatus("MISMATCH", { ...base, managerApprovedAt: new Date() })).toMatchObject({
        label: "Exception approved",
        isHumanCleared: true,
      });
    });

    it("an exception without evidence does not clear", () => {
      const res = deriveEffectiveCheckStatus("MISMATCH", { id: "r", type: "ACCEPTED_EXCEPTION", reason: "Supplier confirmed", evidence: null, managerApprovedAt: new Date() });
      expect(res).toMatchObject({ label: "Mismatch", isHumanCleared: false, isPendingApproval: false });
    });

    it.each(["SOURCE_CORRECTED", "DOCUMENT_REPLACEMENT"] as const)("%s is an audit link and never shows a failure as cleared", (type) => {
      const res = deriveEffectiveCheckStatus("MISMATCH", { id: "r", type, reason: "Fixed in source" });
      expect(res).toMatchObject({ label: "Mismatch", isHumanCleared: false, isPendingApproval: false });
    });

    it("the server-derived status wins when present", () => {
      expect(deriveEffectiveCheckStatus("MISMATCH", null, "HUMAN_CLEARED").isHumanCleared).toBe(true);
      expect(deriveEffectiveCheckStatus("MISMATCH", { id: "r", type: "SOURCE_CORRECTED", reason: "x" }, "MISMATCH").isHumanCleared).toBe(false);
    });
  });

  describe("POST /api/crosschecks/[id]/resolve", () => {
    it("returns 401 when user is unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
      expect((await resolve(checkId, exceptionBody)).status).toBe(401);
    });

    it("requires the reviewer to confirm the compared values (400)", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, { ...exceptionBody, valuesConfirmed: false });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/confirm that you have reviewed the compared values/i);
      expect(state.resolutions).toHaveLength(0);
    });

    it("requires expectedRevision (400)", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);
      const { expectedRevision: _omit, ...body } = exceptionBody;
      void _omit;

      expect((await resolve(checkId, body)).status).toBe(400);
      expect(state.resolutions).toHaveLength(0);
    });

    it("requires a reason of at least 5 characters", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      expect((await resolve(checkId, { ...exceptionBody, reason: "ok" })).status).toBe(400);
      expect(state.resolutions).toHaveLength(0);
    });

    it("requires evidence for ACCEPTED_EXCEPTION (422 EVIDENCE_REQUIRED)", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, { ...exceptionBody, evidence: "" });
      const json = await response.json();

      expect(response.status).toBe(422);
      expect(json.code).toBe("EVIDENCE_REQUIRED");
      expect(json.error).toMatch(/evidence or query reference/i);
      expect(state.resolutions).toHaveLength(0);
    });

    it("an Executive's exception waits for manager sign-off and audits a check snapshot", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, exceptionBody);
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.resolution).toMatchObject({ type: "ACCEPTED_EXCEPTION", managerApprovedAt: null, resolvedById: executiveUser.id, evidence: "TKT-8492" });
      expect(json.effectiveStatus).toBe("PENDING_MANAGER_APPROVAL");
      expect(state.audits[0]).toMatchObject({
        action: "CROSS_CHECK_RESOLVED",
        metadata: expect.objectContaining({
          type: "ACCEPTED_EXCEPTION",
          valuesConfirmed: true,
          checkSnapshot: expect.objectContaining({ status: "MISMATCH", details: expect.objectContaining({ differenceKg: "45.000" }) }),
        }),
      });
    });

    it("a Manager's exception is signed off immediately (HUMAN_CLEARED)", async () => {
      actAs(managerUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, exceptionBody);
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.resolution.managerApprovedAt).not.toBeNull();
      expect(json.effectiveStatus).toBe("HUMAN_CLEARED");
    });

    it("accepts DOCUMENT_REPLACED as an alias of DOCUMENT_REPLACEMENT", async () => {
      actAs(executiveUser);
      const state = makeState({ checkInOlderRun: true });
      state.replacements.push({ createdAt: new Date("2026-11-06T11:00:00Z") });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, { type: "DOCUMENT_REPLACED", reason: "Supplier issued corrected packing list v2", valuesConfirmed: true, expectedRevision: 2 });
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.resolution).toMatchObject({ type: "DOCUMENT_REPLACEMENT", managerApprovedAt: null });
      // An audit link never clears the old failure.
      expect(json.effectiveStatus).toBe("MISMATCH");
    });

    it("a reason-only SOURCE_CORRECTED on a current failure returns 409 RESOLUTION_LINK_INVALID", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, { type: "SOURCE_CORRECTED", reason: "Fixed weight typo", valuesConfirmed: true, expectedRevision: 2 });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("RESOLUTION_LINK_INVALID");
      expect(state.resolutions).toHaveLength(0);
    });

    it("SOURCE_CORRECTED needs a FieldCorrection after the failed check AND a passing latest run", async () => {
      actAs(executiveUser);
      const withoutCorrection = makeState({ checkInOlderRun: true });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(withoutCorrection) as never);
      expect((await resolve(checkId, { type: "SOURCE_CORRECTED", reason: "Fixed weight typo", valuesConfirmed: true, expectedRevision: 2 })).status).toBe(409);

      const stillFailing = makeState({ checkInOlderRun: true, latestStatus: "MISMATCH" });
      stillFailing.corrections.push({ createdAt: new Date("2026-11-06T11:00:00Z") });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(stillFailing) as never);
      expect((await resolve(checkId, { type: "SOURCE_CORRECTED", reason: "Fixed weight typo", valuesConfirmed: true, expectedRevision: 2 })).status).toBe(409);

      const fixed = makeState({ checkInOlderRun: true });
      fixed.corrections.push({ createdAt: new Date("2026-11-06T11:00:00Z") });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(fixed) as never);
      const ok = await resolve(checkId, { type: "SOURCE_CORRECTED", reason: "Fixed weight typo", valuesConfirmed: true, expectedRevision: 2 });
      expect(ok.status).toBe(201);
      expect((await ok.json()).resolution.managerApprovedAt).toBeNull();
    });

    it("an exception on a check from an older run returns 409 CHECK_NOT_LATEST", async () => {
      actAs(executiveUser);
      const state = makeState({ checkInOlderRun: true });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, exceptionBody);

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("CHECK_NOT_LATEST");
    });

    it("a stale expectedRevision returns 409 STALE_REVISION", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, { ...exceptionBody, expectedRevision: 1 });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("STALE_REVISION");
    });

    it.each(["READY_FOR_APPROVAL", "APPROVED", "EXPORTED", "EXTRACTING"])("is locked while the shipment is %s", async (status) => {
      actAs(executiveUser);
      const state = makeState({ status });
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve(checkId, exceptionBody);

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("SHIPMENT_LOCKED");
    });

    it("returns 404 for a check outside the user's scope", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

      const response = await resolve("77777777-7777-4777-8777-777777777777", exceptionBody);

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("CHECK_NOT_FOUND");
    });

    it("does not re-run checks and logs only a safe code when loading the latest run fails", async () => {
      actAs(executiveUser);
      const state = makeState();
      vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);
      const createRun = vi.spyOn(crosscheckService, "createCrossCheckRun");
      vi.spyOn(crosscheckService, "getLatestCrossCheckRun").mockRejectedValue(new Error("secret detail"));
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await resolve(checkId, exceptionBody);

      expect(response.status).toBe(201);
      expect(createRun).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith("[crosschecks.resolve_latest_failed]", "UNEXPECTED");
      for (const call of errorLog.mock.calls) expect(call.some((arg) => arg instanceof Error)).toBe(false);
    });
  });
});
