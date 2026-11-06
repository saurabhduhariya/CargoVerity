import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as reviewFieldRoute } from "@/app/api/fields/[id]/review/route";
import { POST as correctFieldRoute } from "@/app/api/fields/[id]/correction/route";
import { POST as manualFieldRoute } from "@/app/api/documents/[id]/fields/manual/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as crosscheckService from "@/lib/crosschecks/service";

const executiveUser = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "executive@example.test",
  role: "EXECUTIVE" as const,
};

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const fieldId = "44444444-4444-4444-8444-444444444444";

describe("Field Confirmation and Correction (Week 4 Step 7)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/fields/[id]/review", () => {
    it("returns 401 when user is unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED" }),
      });

      const response = await reviewFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Authentication required.");
    });

    it("requires a reason when correcting or manually entering a field (Rule 4)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CORRECTED",
          value: "3165",
          // missing reason
        }),
      });

      const response = await reviewFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/reason is required/i);
    });

    it("rejects field modification on approved or exported shipments (Rule 1: allowed pre-approval states only)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockField = {
        id: fieldId,
        currentValue: "3120",
        modelValue: "3120",
        document: {
          id: documentId,
          shipmentId,
          shipment: {
            id: shipmentId,
            status: "APPROVED",
            currentRevision: 3,
            createdById: executiveUser.id,
          },
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        extractedField: { findFirst: vi.fn().mockResolvedValue(mockField) },
      } as never);

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CORRECTED",
          value: "3165",
          reason: "Fixed weight error",
        }),
      });

      const response = await reviewFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Cannot edit fields on a shipment with status APPROVED");
    });

    it("returns 409 Conflict when expectedRevision does not match currentRevision (Rules 6 & 7: stale update guard)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockField = {
        id: fieldId,
        currentValue: "3120",
        modelValue: "3120",
        document: {
          id: documentId,
          shipmentId,
          shipment: {
            id: shipmentId,
            status: "NEEDS_REVIEW",
            currentRevision: 3, // Database is at revision 3
            createdById: executiveUser.id,
          },
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        extractedField: { findFirst: vi.fn().mockResolvedValue(mockField) },
      } as never);

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CORRECTED",
          value: "3165",
          reason: "Corrected from packing list",
          expectedRevision: 2, // Stale client expected revision 2
        }),
      });

      const response = await reviewFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("CONFLICT");
      expect(json.error).toContain("Stale shipment revision. Expected revision 2, but current revision is 3.");
    });

    it("successfully confirms field without bumping revision when value is unchanged (Rule 3)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockField = {
        id: fieldId,
        currentValue: "5400.00",
        modelValue: "5400.00",
        document: {
          id: documentId,
          shipmentId,
          shipment: {
            id: shipmentId,
            status: "NEEDS_REVIEW",
            currentRevision: 2,
            createdById: executiveUser.id,
          },
        },
      };

      const mockTx = {
        extractedField: {
          update: vi.fn().mockResolvedValue({
            ...mockField,
            reviewStatus: "CONFIRMED",
          }),
        },
        fieldCorrection: { create: vi.fn() },
        shipment: { update: vi.fn() },
        auditEvent: { create: vi.fn() },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        extractedField: { findFirst: vi.fn().mockResolvedValue(mockField) },
        $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => {
          return callback(mockTx);
        }),
      } as never);

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CONFIRMED",
          expectedRevision: 2,
        }),
      });

      const response = await reviewFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.field.reviewStatus).toBe("CONFIRMED");
      expect(json.revision).toBe(2); // Revision not bumped

      // Assert no FieldCorrection row created since value was unchanged
      expect(mockTx.fieldCorrection.create).not.toHaveBeenCalled();
      // Assert AuditEvent was recorded
      expect(mockTx.auditEvent.create).toHaveBeenCalled();
    });

    it("records FieldCorrection in same transaction, increments revision, invalidates approval, and recomputes cross-checks on material correction (Rules 5, 8, 9, 10)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockField = {
        id: fieldId,
        currentValue: "3120",
        modelValue: "3120",
        document: {
          id: documentId,
          shipmentId,
          shipment: {
            id: shipmentId,
            status: "READY_FOR_APPROVAL",
            currentRevision: 2,
            createdById: executiveUser.id,
          },
        },
      };

      const mockTx = {
        extractedField: {
          update: vi.fn().mockResolvedValue({
            ...mockField,
            currentValue: "3165",
            reviewStatus: "CORRECTED",
            reviewReason: "Corrected per packing list total",
          }),
        },
        fieldCorrection: {
          create: vi.fn().mockResolvedValue({ id: "corr-1" }),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({
            ...mockField.document.shipment,
            currentRevision: 3,
            status: "NEEDS_REVIEW",
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "aud-1" }),
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        extractedField: { findFirst: vi.fn().mockResolvedValue(mockField) },
        $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => {
          return callback(mockTx);
        }),
      } as never);

      const crossCheckRunSpy = vi.spyOn(crosscheckService, "createCrossCheckRun").mockResolvedValue({
        run: {
          id: "run-3",
          shipmentId,
          revision: 3,
          inputHash: "abc123hash",
          inputSnapshot: {},
          triggeredBy: "FIELD_CORRECTED",
          requestedById: executiveUser.id,
          createdAt: new Date(),
        },
        revision: 3,
        results: [
          {
            id: "res-1",
            shipmentId,
            runId: "run-3",
            revision: 3,
            ruleKey: "gross_weight_comparison",
            ruleCode: "CHK_GROSS_WEIGHT",
            severity: "BLOCKING",
            status: "PASS",
            details: { message: "Weights match exactly at 3165 kg" },
            createdAt: new Date(),
            resolutions: [],
          },
        ],
      });

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CORRECTED",
          value: "3165",
          reason: "Corrected per packing list total",
          expectedRevision: 2,
        }),
      });

      const response = await reviewFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(200);
      const json = await response.json();

      // Rule 5: FieldCorrection recorded in transaction
      expect(mockTx.fieldCorrection.create).toHaveBeenCalledWith({
        data: {
          fieldId,
          previousValue: "3120",
          newValue: "3165",
          reason: "Corrected per packing list total",
          correctedById: executiveUser.id,
        },
      });

      // Rule 8 & 9: Increment revision and reset to NEEDS_REVIEW
      expect(mockTx.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          currentRevision: { increment: 1 },
          status: "NEEDS_REVIEW",
        },
      });

      // Rule 10: Cross-checks recomputed
      expect(crossCheckRunSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId,
          requestedById: executiveUser.id,
          triggeredBy: "FIELD_CORRECTED",
        }),
      );

      expect(json.revision).toBe(3);
      expect(json.shipmentStatus).toBe("NEEDS_REVIEW");
      expect(json.crossChecks).toHaveLength(1);
      expect(json.crossChecks[0].status).toBe("PASS");
    });
  });

  describe("POST /api/fields/[id]/correction", () => {
    it("returns 409 Conflict when expectedRevision is stale", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockField = {
        id: fieldId,
        currentValue: "100",
        document: {
          shipment: {
            id: shipmentId,
            status: "NEEDS_REVIEW",
            currentRevision: 4,
            createdById: executiveUser.id,
          },
        },
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        extractedField: { findFirst: vi.fn().mockResolvedValue(mockField) },
      } as never);

      const request = new Request(`http://localhost:3000/api/fields/${fieldId}/correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: "105",
          reason: "Correct quantity count",
          expectedRevision: 3,
        }),
      });

      const response = await correctFieldRoute(request, { params: Promise.resolve({ id: fieldId }) });
      expect(response.status).toBe(409);
    });
  });

  describe("POST /api/documents/[id]/fields/manual", () => {
    it("returns 409 Conflict when expectedRevision is stale", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockDoc = {
        id: documentId,
        shipment: {
          id: shipmentId,
          status: "NEEDS_REVIEW",
          currentRevision: 5,
          createdById: executiveUser.id,
        },
        extractionRuns: [],
      };

      vi.spyOn(db, "getPrisma").mockReturnValue({
        document: { findFirst: vi.fn().mockResolvedValue(mockDoc) },
      } as never);

      const request = new Request(`http://localhost:3000/api/documents/${documentId}/fields/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey: "packageCount",
          value: "50",
          reason: "Found in document header",
          expectedRevision: 4,
        }),
      });

      const response = await manualFieldRoute(request, { params: Promise.resolve({ id: documentId }) });
      expect(response.status).toBe(409);
    });
  });
});
