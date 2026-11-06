import { describe, expect, it, vi, beforeEach } from "vitest";

import { processManagerDecision } from "@/lib/manager/decision";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { POST as approveRoute } from "@/app/api/shipments/[id]/approve/route";
import { POST as decisionRoute } from "@/app/api/shipments/[id]/decision/route";
import { canExport } from "@/lib/export/guard";

describe("Manager Decision Flow (Week 5 Step 2)", () => {
  const managerUser = {
    id: "manager-uuid-001",
    email: "manager@cargoverity.test",
    role: "MANAGER" as const,
  };

  const executiveUser = {
    id: "executive-uuid-001",
    email: "executive@cargoverity.test",
    role: "EXECUTIVE" as const,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Server Authorization: Executive 403 (Rule 6)", () => {
    it("rejects Executive callers with 403 Forbidden on /api/shipments/[id]/approve", async () => {
      vi.spyOn(auth, "requireRole").mockImplementation(async (role) => {
        if (role !== "EXECUTIVE") throw new Error("FORBIDDEN");
        return {
          appUser: executiveUser as never,
          authUser: { id: executiveUser.id, email: executiveUser.email } as never,
        };
      });

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/approve", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVE" }),
      });
      const response = await approveRoute(request, { params: Promise.resolve({ id: "test-shipment" }) });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toMatch(/permission/i);
    });

    it("rejects Executive callers with 403 Forbidden on /api/shipments/[id]/decision", async () => {
      vi.spyOn(auth, "requireRole").mockImplementation(async (role) => {
        if (role !== "EXECUTIVE") throw new Error("FORBIDDEN");
        return {
          appUser: executiveUser as never,
          authUser: { id: executiveUser.id, email: executiveUser.email } as never,
        };
      });

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/decision", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVE" }),
      });
      const response = await decisionRoute(request, { params: Promise.resolve({ id: "test-shipment" }) });

      expect(response.status).toBe(403);
    });
  });

  describe("Manager Approval (Rules 8, 9, 10)", () => {
    it("successfully approves shipment, sets status to APPROVED, creates Approval row and AuditEvent", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 1,
        crossCheckRuns: [
          {
            id: "run-1",
            revision: 1,
            results: [
              {
                id: "c-1",
                ruleKey: "weight-gross",
                status: "PASS",
                resolutions: [],
              },
            ],
          },
        ],
      };

      const mockTx = {
        approval: {
          upsert: vi.fn().mockResolvedValue({
            id: "approval-1",
            shipmentId: mockShipment.id,
            revision: 1,
            approvedById: managerUser.id,
            approvedAt: new Date(),
          }),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({
            ...mockShipment,
            status: "APPROVED",
          }),
        },
        crossCheckResolution: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };

      const mockPrisma = {
        shipment: {
          findUnique: vi.fn().mockResolvedValue(mockShipment),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const result = await processManagerDecision({
        shipmentId: "test-shipment",
        managerUser,
        decision: "APPROVE",
        comment: "Documents verified against customs guidelines.",
      });

      expect(result.success).toBe(true);
      expect(result.decision).toBe("APPROVE");
      expect(result.shipment.status).toBe("APPROVED");
      expect(mockTx.approval.upsert).toHaveBeenCalledWith({
        where: {
          shipmentId_revision: {
            shipmentId: "test-shipment",
            revision: 1,
          },
        },
        update: expect.objectContaining({ approvedById: managerUser.id }),
        create: expect.objectContaining({ approvedById: managerUser.id, revision: 1 }),
      });
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SHIPMENT_APPROVED",
          actorId: managerUser.id,
          metadata: expect.objectContaining({
            decision: "APPROVE",
            revision: 1,
          }),
        }),
      });
    });

    it("stamps managerApprovedAt on pending ACCEPTED_EXCEPTION resolutions upon approval", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 1,
        crossCheckRuns: [
          {
            id: "run-1",
            revision: 1,
            results: [
              {
                id: "c-1",
                ruleKey: "package-count",
                status: "MISMATCH",
                resolutions: [
                  {
                    id: "res-exception-1",
                    type: "ACCEPTED_EXCEPTION",
                    reason: "Pallet variance approved by client",
                    evidence: "REF-9921",
                    managerApprovedAt: null, // pending!
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockTx = {
        approval: {
          upsert: vi.fn().mockResolvedValue({ id: "approval-1" }),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({ ...mockShipment, status: "APPROVED" }),
        },
        crossCheckResolution: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };

      const mockPrisma = {
        shipment: {
          findUnique: vi.fn().mockResolvedValue(mockShipment),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const result = await processManagerDecision({
        shipmentId: "test-shipment",
        managerUser,
        decision: "APPROVE",
        comment: "Exception acceptable per trade lane policy memo.",
      });

      expect(result.success).toBe(true);
      expect(mockTx.crossCheckResolution.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["res-exception-1"] } },
        data: expect.objectContaining({ managerApprovedAt: expect.any(Date) }),
      });
    });
  });

  describe("Manager Rejection (Rules 7 & 11)", () => {
    it("successfully rejects shipment, resets status to NEEDS_REVIEW, and creates rejection AuditEvent", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 2,
        crossCheckRuns: [],
      };

      const mockTx = {
        shipment: {
          update: vi.fn().mockResolvedValue({
            ...mockShipment,
            status: "NEEDS_REVIEW",
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };

      const mockPrisma = {
        shipment: {
          findUnique: vi.fn().mockResolvedValue(mockShipment),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const result = await processManagerDecision({
        shipmentId: "test-shipment",
        managerUser,
        decision: "REJECT",
        comment: "Invoice total has missing line items; please re-extract or correct manual lines.",
      });

      expect(result.success).toBe(true);
      expect(result.decision).toBe("REJECT");
      expect(result.shipment.status).toBe("NEEDS_REVIEW");
      expect(mockTx.shipment.update).toHaveBeenCalledWith({
        where: { id: "test-shipment" },
        data: { status: "NEEDS_REVIEW" },
      });
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SHIPMENT_REJECTED",
          actorId: managerUser.id,
          metadata: expect.objectContaining({
            decision: "REJECT",
            comment: "Invoice total has missing line items; please re-extract or correct manual lines.",
            revision: 2,
          }),
        }),
      });
    });

    it("requires a meaningful comment (min 5 characters) when rejecting (Rule 7)", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 1,
        crossCheckRuns: [],
      };
      vi.spyOn(db, "getPrisma").mockReturnValue({
        shipment: { findUnique: vi.fn().mockResolvedValue(mockShipment) },
      } as never);

      // Missing comment
      await expect(
        processManagerDecision({
          shipmentId: "test-shipment",
          managerUser,
          decision: "REJECT",
          comment: "",
        }),
      ).rejects.toThrow(/meaningful comment \(minimum 5 characters\) is required/i);

      // Too short comment
      await expect(
        processManagerDecision({
          shipmentId: "test-shipment",
          managerUser,
          decision: "REJECT",
          comment: "bad",
        }),
      ).rejects.toThrow(/minimum 5 characters/i);
    });
  });

  describe("Comment Requirement for Accepted Exception (Rule 8)", () => {
    it("requires a meaningful comment when approving a shipment with accepted exceptions", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 1,
        crossCheckRuns: [
          {
            id: "run-1",
            revision: 1,
            results: [
              {
                id: "c-1",
                ruleKey: "weight-gross",
                status: "MISMATCH",
                resolutions: [
                  {
                    id: "res-1",
                    type: "ACCEPTED_EXCEPTION",
                    reason: "Vendor packing variance",
                    evidence: "DOC-1234",
                    managerApprovedAt: null,
                  },
                ],
              },
            ],
          },
        ],
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        shipment: { findUnique: vi.fn().mockResolvedValue(mockShipment) },
      } as never);

      // Approving with no comment
      await expect(
        processManagerDecision({
          shipmentId: "test-shipment",
          managerUser,
          decision: "APPROVE",
          comment: "",
        }),
      ).rejects.toThrow(/meaningful comment.*required when approving a shipment with accepted exceptions/i);
    });
  });

  describe("Stale Revision & Invalidation (Rules 10 & 12)", () => {
    it("rejects approval when cross-checks are stale (check run revision !== shipment revision)", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 3,
        crossCheckRuns: [
          {
            id: "run-1",
            revision: 2, // Stale! Current is 3
            results: [{ id: "c-1", ruleKey: "inv", status: "PASS", resolutions: [] }],
          },
        ],
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        shipment: { findUnique: vi.fn().mockResolvedValue(mockShipment) },
      } as never);

      await expect(
        processManagerDecision({
          shipmentId: "test-shipment",
          managerUser,
          decision: "APPROVE",
        }),
      ).rejects.toThrow(/stale cross-checks/i);
    });

    it("rejects decision when expectedRevision does not match current shipment revision", async () => {
      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "READY_FOR_APPROVAL",
        currentRevision: 2,
        crossCheckRuns: [],
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        shipment: { findUnique: vi.fn().mockResolvedValue(mockShipment) },
      } as never);

      await expect(
        processManagerDecision({
          shipmentId: "test-shipment",
          managerUser,
          decision: "REJECT",
          expectedRevision: 1, // Client thought revision was 1, but it's 2
          comment: "Rejecting stale version",
        }),
      ).rejects.toThrow(/stale shipment revision/i);
    });

    it("verifies export guard rejects export when revision is incremented after approval (Rule 12)", () => {
      // 1. Shipment approved at revision 1
      const approvedGuard = canExport({
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });
      expect(approvedGuard.allowed).toBe(true);

      // 2. Material field edit increments revision to 2
      const invalidatedGuard = canExport({
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 2, // Increment!
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });
      expect(invalidatedGuard.allowed).toBe(false);
      expect(invalidatedGuard.reasons).toContain("approval_is_stale");
    });
  });
});

