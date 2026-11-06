import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as resolveCrossCheckRoute } from "@/app/api/crosschecks/[id]/resolve/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as crosscheckService from "@/lib/crosschecks/service";
import { deriveEffectiveCheckStatus } from "@/features/review/review-workspace";

const executiveUser = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "executive@example.test",
  fullName: "Executive User",
  role: "EXECUTIVE" as const,
};

const managerUser = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "manager@example.test",
  fullName: "Manager User",
  role: "MANAGER" as const,
};

const shipmentId = "11111111-1111-4111-8111-111111111111";
const checkId = "66666666-6666-4666-8666-666666666666";

describe("Failed-Check Resolution (Week 4 Step 8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("deriveEffectiveCheckStatus (Rules 7 & 8)", () => {
    it("derives PASS when check status is PASS without resolutions", () => {
      const res = deriveEffectiveCheckStatus("PASS", null);
      expect(res.label).toBe("PASS");
      expect(res.isHumanCleared).toBe(false);
      expect(res.isPendingApproval).toBe(false);
    });

    it("derives MISMATCH when check is failed and unreviewed", () => {
      const res = deriveEffectiveCheckStatus("MISMATCH", null);
      expect(res.label).toBe("MISMATCH");
      expect(res.isHumanCleared).toBe(false);
      expect(res.isPendingApproval).toBe(false);
    });

    it("derives PENDING_MANAGER_APPROVAL when Executive resolves with ACCEPTED_EXCEPTION (Rule 7)", () => {
      const res = deriveEffectiveCheckStatus("MISMATCH", {
        id: "res-1",
        type: "ACCEPTED_EXCEPTION",
        reason: "Supplier confirmed 45kg packing variation",
        evidence: "Query #TKT-8492",
        managerApprovedAt: null, // pending approval
      });

      expect(res.label).toBe("PENDING MANAGER APPROVAL");
      expect(res.isHumanCleared).toBe(false);
      expect(res.isPendingApproval).toBe(true);
    });

    it("derives HUMAN_CLEARED once manager approves an ACCEPTED_EXCEPTION (Rule 8)", () => {
      const res = deriveEffectiveCheckStatus("MISMATCH", {
        id: "res-1",
        type: "ACCEPTED_EXCEPTION",
        reason: "Supplier confirmed 45kg packing variation",
        evidence: "Query #TKT-8492",
        managerApprovedAt: new Date(), // approved by manager
      });

      expect(res.label).toBe("HUMAN CLEARED (Exception Approved)");
      expect(res.isHumanCleared).toBe(true);
      expect(res.isPendingApproval).toBe(false);
    });

    it("derives HUMAN_CLEARED for SOURCE_CORRECTED resolutions", () => {
      const res = deriveEffectiveCheckStatus("MISMATCH", {
        id: "res-2",
        type: "SOURCE_CORRECTED",
        reason: "Transcribed from invoice footer",
      });

      expect(res.label).toBe("HUMAN CLEARED (Source Corrected)");
      expect(res.isHumanCleared).toBe(true);
      expect(res.isPendingApproval).toBe(false);
    });

    it("derives HUMAN_CLEARED for DOCUMENT_REPLACEMENT resolutions", () => {
      const res = deriveEffectiveCheckStatus("MISMATCH", {
        id: "res-3",
        type: "DOCUMENT_REPLACEMENT",
        reason: "Vendor issued corrected packing list v2",
      });

      expect(res.label).toBe("HUMAN CLEARED (Doc Replaced)");
      expect(res.isHumanCleared).toBe(true);
      expect(res.isPendingApproval).toBe(false);
    });
  });

  describe("POST /api/crosschecks/[id]/resolve", () => {
    it("returns 401 when user is unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const request = new Request(`http://localhost:3000/api/crosschecks/${checkId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SOURCE_CORRECTED",
          reason: "Fixed weight typo",
          valuesConfirmed: true,
        }),
      });

      const response = await resolveCrossCheckRoute(request, { params: Promise.resolve({ id: checkId }) });
      expect(response.status).toBe(401);
    });

    it("requires the reviewer to confirm compared values before resolution (Rule 3)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const request = new Request(`http://localhost:3000/api/crosschecks/${checkId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SOURCE_CORRECTED",
          reason: "Fixed weight typo",
          valuesConfirmed: false, // not confirmed
        }),
      });

      const response = await resolveCrossCheckRoute(request, { params: Promise.resolve({ id: checkId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/confirm that you have reviewed the extracted values/i);
    });

    it("requires evidence or query reference when resolution type is ACCEPTED_EXCEPTION (Rule 5)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const request = new Request(`http://localhost:3000/api/crosschecks/${checkId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ACCEPTED_EXCEPTION",
          reason: "Vendor packing variance approved for customs clearance",
          valuesConfirmed: true,
          // missing evidence
        }),
      });

      const response = await resolveCrossCheckRoute(request, { params: Promise.resolve({ id: checkId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/evidence or query reference is required/i);
    });

    it("marks ACCEPTED_EXCEPTION as pending manager approval when submitted by an Executive (Rule 7)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockCheck = {
        id: checkId,
        shipmentId,
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        status: "MISMATCH",
        shipment: { id: shipmentId, createdById: executiveUser.id },
      };

      const mockTx = {
        crossCheckResolution: {
          create: vi.fn().mockResolvedValue({
            id: "res-exec-1",
            crossCheckId: checkId,
            type: "ACCEPTED_EXCEPTION",
            reason: "Tolerance variance approved by client team",
            evidence: "Query #TKT-8910",
            resolvedById: executiveUser.id,
            managerApprovedAt: null, // marked pending manager approval
            resolvedBy: executiveUser,
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "aud-res-1" }),
        },
        crossCheckResult: {
          update: vi.fn(), // MUST NOT BE CALLED (Rule 9)
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        crossCheckResult: { findFirst: vi.fn().mockResolvedValue(mockCheck) },
        $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
      } as never);

      const request = new Request(`http://localhost:3000/api/crosschecks/${checkId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ACCEPTED_EXCEPTION",
          reason: "Tolerance variance approved by client team",
          evidence: "Query #TKT-8910",
          valuesConfirmed: true,
        }),
      });

      const response = await resolveCrossCheckRoute(request, { params: Promise.resolve({ id: checkId }) });
      expect(response.status).toBe(201);
      const json = await response.json();

      // Rule 7: managerApprovedAt is null
      expect(json.resolution.managerApprovedAt).toBeNull();
      // Rule 8: derived effective status is PENDING_MANAGER_APPROVAL
      expect(json.effectiveStatus).toBe("PENDING_MANAGER_APPROVAL");

      // Rule 9: Historical crossCheckResult was NOT mutated
      expect(mockTx.crossCheckResult.update).not.toHaveBeenCalled();

      // Rule 10: Audit history recorded
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId,
          actorId: executiveUser.id,
          action: "CROSS_CHECK_RESOLVED",
          entityType: "CrossCheckResolution",
        }),
      });
    });

    it("marks ACCEPTED_EXCEPTION directly approved when submitted by a Manager", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: managerUser as never,
        authUser: { id: managerUser.id, email: managerUser.email } as never,
      });

      const mockCheck = {
        id: checkId,
        shipmentId,
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        status: "MISMATCH",
        shipment: { id: shipmentId, createdById: executiveUser.id },
      };

      const mockTx = {
        crossCheckResolution: {
          create: vi.fn().mockImplementation(async ({ data }) => ({
            ...data,
            id: "res-mgr-1",
            resolvedBy: managerUser,
          })),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "aud-res-2" }),
        },
        crossCheckResult: {
          update: vi.fn(),
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        crossCheckResult: { findFirst: vi.fn().mockResolvedValue(mockCheck) },
        $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
      } as never);

      const request = new Request(`http://localhost:3000/api/crosschecks/${checkId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ACCEPTED_EXCEPTION",
          reason: "Approved after inspecting sea waybill weight declaration",
          evidence: "Email #CONF-3392",
          valuesConfirmed: true,
        }),
      });

      const response = await resolveCrossCheckRoute(request, { params: Promise.resolve({ id: checkId }) });
      expect(response.status).toBe(201);
      const json = await response.json();

      expect(json.resolution.managerApprovedAt).not.toBeNull();
      expect(json.effectiveStatus).toBe("HUMAN_CLEARED");
    });

    it("triggers a new check run when resolved as SOURCE_CORRECTED (Rule 6)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockCheck = {
        id: checkId,
        shipmentId,
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        status: "MISMATCH",
        shipment: { id: shipmentId, createdById: executiveUser.id },
      };

      const mockTx = {
        crossCheckResolution: {
          create: vi.fn().mockResolvedValue({
            id: "res-sc-1",
            crossCheckId: checkId,
            type: "SOURCE_CORRECTED",
            reason: "Source packing list gross weight updated to 3165 kg",
            evidence: null,
            resolvedById: executiveUser.id,
            managerApprovedAt: new Date(),
            resolvedBy: executiveUser,
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "aud-res-3" }),
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        crossCheckResult: { findFirst: vi.fn().mockResolvedValue(mockCheck) },
        $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
      } as never);

      const checkRunSpy = vi.spyOn(crosscheckService, "createCrossCheckRun").mockResolvedValue({
        run: {
          id: "run-new",
          shipmentId,
          revision: 3,
          inputHash: "hash-new",
          inputSnapshot: {},
          triggeredBy: "RESOLUTION_SOURCE_CORRECTED",
          requestedById: executiveUser.id,
          createdAt: new Date(),
        },
        revision: 3,
        results: [],
      });

      const request = new Request(`http://localhost:3000/api/crosschecks/${checkId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SOURCE_CORRECTED",
          reason: "Source packing list gross weight updated to 3165 kg",
          valuesConfirmed: true,
        }),
      });

      const response = await resolveCrossCheckRoute(request, { params: Promise.resolve({ id: checkId }) });
      expect(response.status).toBe(201);

      // Rule 6: createCrossCheckRun triggered
      expect(checkRunSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId,
          requestedById: executiveUser.id,
          triggeredBy: "RESOLUTION_SOURCE_CORRECTED",
        }),
      );
    });
  });
});

