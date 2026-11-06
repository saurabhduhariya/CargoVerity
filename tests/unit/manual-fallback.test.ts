import { describe, expect, it, vi, beforeEach } from "vitest";

import { POST as markPageManualPOST } from "@/app/api/documents/[id]/pages/manual/route";
import { POST as manualFieldPOST } from "@/app/api/documents/[id]/fields/manual/route";
import * as authModule from "@/lib/auth";
import * as dbModule from "@/lib/db";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const pageId = "55555555-5555-4555-8555-555555555555";
const fieldId = "66666666-6666-4666-8666-666666666666";

describe("Manual Fallback & Page State (Week 3 Step 5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/documents/[id]/pages/manual", () => {
    it("returns 401 when caller is unauthenticated", async () => {
      vi.spyOn(authModule, "requireAppUser").mockRejectedValue(
        new Error("AUTHENTICATION_REQUIRED"),
      );

      const req = new Request("http://localhost/api/documents/doc-1/pages/manual", {
        method: "POST",
        body: JSON.stringify({ pageNumber: 2 }),
      });

      const res = await markPageManualPOST(req, {
        params: Promise.resolve({ id: documentId }),
      });
      expect(res.status).toBe(401);
    });

    it("marks page for manual entry, increments shipment revision, and creates audit event", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockDocument = {
        id: documentId,
        shipmentId,
        docType: "INVOICE",
      };

      const mockCreatedPage = {
        id: pageId,
        documentId,
        pageNumber: 2,
        isReadable: false,
        manualEntryRequired: true,
        reviewNote: "Garbled text, torn paper",
      };

      const mockTx = {
        documentPage: {
          upsert: vi.fn().mockResolvedValue(mockCreatedPage),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({ id: shipmentId, currentRevision: 2 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-manual-page" }),
        },
      };

      const mockPrisma = {
        document: {
          findFirst: vi.fn().mockResolvedValue(mockDocument),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request(`http://localhost/api/documents/${documentId}/pages/manual`, {
        method: "POST",
        body: JSON.stringify({
          pageNumber: 2,
          manualEntryRequired: true,
          reviewNote: "Garbled text, torn paper",
        }),
      });

      const res = await markPageManualPOST(req, {
        params: Promise.resolve({ id: documentId }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.page.manualEntryRequired).toBe(true);
      expect(body.page.isReadable).toBe(false);

      // Verify page was upserted
      expect(mockTx.documentPage.upsert).toHaveBeenCalledWith({
        where: {
          documentId_pageNumber: { documentId, pageNumber: 2 },
        },
        update: expect.objectContaining({
          manualEntryRequired: true,
          isReadable: false,
        }),
        create: expect.objectContaining({
          documentId,
          pageNumber: 2,
          manualEntryRequired: true,
          isReadable: false,
        }),
      });

      // Verify revision incremented to invalidate prior approvals
      expect(mockTx.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          currentRevision: { increment: 1 },
          status: "IN_REVIEW",
        },
      });

      // Verify audit event recorded
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId,
          actorId: userId,
          action: "PAGE_MARKED_FOR_MANUAL_ENTRY",
          entityType: "DocumentPage",
          entityId: pageId,
        }),
      });
    });
  });

  describe("POST /api/documents/[id]/fields/manual", () => {
    it("updates existing field to MANUAL_ENTRY and preserves immutable modelValue", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockDocument = {
        id: documentId,
        shipmentId,
        documentVersion: 1,
        extractionRuns: [{ id: runId }],
      };

      const existingField = {
        id: fieldId,
        documentId,
        extractionRunId: runId,
        fieldKey: "invoiceTotal",
        modelValue: "100.00", // Immutable original AI output
        currentValue: "100.00",
        unit: "USD",
        modelConfidence: 0.65,
        reviewStatus: "REQUIRES_REVIEW",
        pageNumber: 1,
      };

      const mockTx = {
        extractedField: {
          findUnique: vi.fn().mockResolvedValue(existingField),
          update: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...existingField,
              currentValue: data.currentValue,
              reviewStatus: data.reviewStatus,
            }),
          ),
        },
        fieldCorrection: {
          create: vi.fn().mockResolvedValue({ id: "corr-1" }),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({ id: shipmentId, currentRevision: 2 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-field-manual" }),
        },
      };

      const mockPrisma = {
        document: {
          findFirst: vi.fn().mockResolvedValue(mockDocument),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request(`http://localhost/api/documents/${documentId}/fields/manual`, {
        method: "POST",
        body: JSON.stringify({
          fieldKey: "invoiceTotal",
          value: "5400.00",
          reason: "Manually transcribed from damaged invoice footer",
        }),
      });

      const res = await manualFieldPOST(req, {
        params: Promise.resolve({ id: documentId }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.field.currentValue).toBe("5400.00");
      expect(body.field.reviewStatus).toBe("MANUAL_ENTRY");

      // Verify immutable modelValue was NOT updated in data payload
      expect(mockTx.extractedField.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: fieldId },
          data: expect.not.objectContaining({
            modelValue: expect.anything(),
          }),
        }),
      );

      // Verify field correction recorded
      expect(mockTx.fieldCorrection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fieldId,
          previousValue: "100.00",
          newValue: "5400.00",
          reason: "Manually transcribed from damaged invoice footer",
          correctedById: userId,
        }),
      });

      // Verify revision increment
      expect(mockTx.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          currentRevision: { increment: 1 },
          status: "IN_REVIEW",
        },
      });
    });

    it("creates a new field with modelValue: null when entering a missing field manually", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockDocument = {
        id: documentId,
        shipmentId,
        documentVersion: 1,
        pageCount: 2,
        extractionRuns: [{ id: runId }],
      };

      const mockTx = {
        extractedField: {
          findUnique: vi.fn().mockResolvedValue(null), // doesn't exist
          create: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: fieldId, ...data }),
          ),
        },
        fieldCorrection: {
          create: vi.fn().mockResolvedValue({ id: "corr-2" }),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({ id: shipmentId, currentRevision: 2 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-create-manual" }),
        },
      };

      const mockPrisma = {
        document: {
          findFirst: vi.fn().mockResolvedValue(mockDocument),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request(`http://localhost/api/documents/${documentId}/fields/manual`, {
        method: "POST",
        body: JSON.stringify({
          fieldKey: "packageCount",
          value: "50",
          unit: "boxes",
          pageNumber: 2,
          reason: "Extracted as unreadable page, entered manually by executive",
        }),
      });

      const res = await manualFieldPOST(req, {
        params: Promise.resolve({ id: documentId }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.field.fieldKey).toBe("packageCount");
      expect(body.field.modelValue).toBeNull(); // AI never found it
      expect(body.field.currentValue).toBe("50");
      expect(body.field.reviewStatus).toBe("MANUAL_ENTRY");

      expect(mockTx.extractedField.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fieldKey: "packageCount",
          modelValue: null,
          currentValue: "50",
          reviewStatus: "MANUAL_ENTRY",
          sourceQuote: "Manual entry by reviewer",
        }),
      });
    });

    it("rejects manual field entry when reason is missing", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const req = new Request(`http://localhost/api/documents/${documentId}/fields/manual`, {
        method: "POST",
        body: JSON.stringify({
          fieldKey: "packageCount",
          value: "50",
          reason: "", // Empty reason should fail Zod validation
        }),
      });

      const res = await manualFieldPOST(req, {
        params: Promise.resolve({ id: documentId }),
      });

      expect(res.status).toBe(400);
    });
  });
});

