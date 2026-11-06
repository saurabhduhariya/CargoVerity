import { describe, expect, it, vi, beforeEach } from "vitest";

import { POST as shipmentExtractPOST, GET as shipmentExtractGET } from "@/app/api/shipments/[id]/extract/route";
import { POST as documentExtractPOST } from "@/app/api/documents/[id]/extract/route";
import * as authModule from "@/lib/auth";
import * as dbModule from "@/lib/db";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const docIdCI = "22222222-2222-4222-8222-222222222222";
const docIdPL = "33333333-3333-4333-8333-333333333333";
const docIdBL = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";

describe("Shipment Extraction Flow & UI API (Week 3 Step 6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
    process.env.GROQ_API_KEY = "gsk_mock_test_key";
  });

  describe("POST /api/shipments/[id]/extract", () => {
    it("returns 401 when caller is unauthenticated", async () => {
      vi.spyOn(authModule, "requireAppUser").mockRejectedValue(
        new Error("AUTHENTICATION_REQUIRED"),
      );

      const req = new Request("http://localhost/api/shipments/s-1/extract", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await shipmentExtractPOST(req, {
        params: Promise.resolve({ id: shipmentId }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when shipment not found or inaccessible", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request("http://localhost/api/shipments/s-1/extract", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await shipmentExtractPOST(req, {
        params: Promise.resolve({ id: shipmentId }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when shipment has no uploaded documents", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({
            id: shipmentId,
            documents: [],
          }),
        },
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request("http://localhost/api/shipments/s-1/extract", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await shipmentExtractPOST(req, {
        params: Promise.resolve({ id: shipmentId }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("NO_DOCUMENTS");
    });

    it("successfully creates extraction runs for all current documents, sets EXTRACTING status, and logs audit event", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockDocuments = [
        { id: docIdCI, docType: "INVOICE", documentVersion: 1, pageCount: 1, extractionRuns: [] },
        { id: docIdPL, docType: "PACKING_LIST", documentVersion: 1, pageCount: 2, extractionRuns: [] },
        { id: docIdBL, docType: "BILL_OF_LADING", documentVersion: 1, pageCount: 1, extractionRuns: [] },
      ];

      const mockCreatedRun = {
        id: runId,
        status: "PROCESSING",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
      };

      const mockTx = {
        extractionRun: {
          create: vi.fn().mockResolvedValue(mockCreatedRun),
        },
        document: {
          update: vi.fn().mockResolvedValue({}),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({}),
        },
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({
            id: shipmentId,
            status: "DRAFT",
            documents: mockDocuments,
          }),
          update: vi.fn().mockResolvedValue({ id: shipmentId, status: "EXTRACTING" }),
        },
        document: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            const found = mockDocuments.find((d) => d.id === where.id);
            return Promise.resolve(found ?? null);
          }),
        },
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({}),
        },
        $transaction: vi.fn().mockImplementation(async (callback) => callback(mockTx)),
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request("http://localhost/api/shipments/s-1/extract", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await shipmentExtractPOST(req, {
        params: Promise.resolve({ id: shipmentId }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe("EXTRACTING");
      expect(data.runs).toHaveLength(3);
      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: { status: "EXTRACTING" },
      });
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "SHIPMENT_EXTRACTION_INITIATED",
            shipmentId,
          }),
        }),
      );
    });

    it("supports targeted extraction of specific document types", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const mockDocuments = [
        { id: docIdCI, docType: "INVOICE", documentVersion: 1, pageCount: 1, extractionRuns: [] },
        { id: docIdPL, docType: "PACKING_LIST", documentVersion: 1, pageCount: 2, extractionRuns: [] },
      ];

      const mockCreatedRun = {
        id: runId,
        status: "PROCESSING",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
      };

      const mockTx = {
        extractionRun: { create: vi.fn().mockResolvedValue(mockCreatedRun) },
        document: { update: vi.fn().mockResolvedValue({}) },
        auditEvent: { create: vi.fn().mockResolvedValue({}) },
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({
            id: shipmentId,
            status: "DRAFT",
            documents: mockDocuments,
          }),
          update: vi.fn().mockResolvedValue({ id: shipmentId, status: "EXTRACTING" }),
        },
        document: {
          findUnique: vi.fn().mockResolvedValue(mockDocuments[0]),
        },
        extractionRun: { findUnique: vi.fn().mockResolvedValue(null) },
        auditEvent: { create: vi.fn().mockResolvedValue({}) },
        $transaction: vi.fn().mockImplementation(async (callback) => callback(mockTx)),
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request("http://localhost/api/shipments/s-1/extract", {
        method: "POST",
        body: JSON.stringify({ documentTypes: ["INVOICE"] }),
      });

      const res = await shipmentExtractPOST(req, {
        params: Promise.resolve({ id: shipmentId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.runs).toHaveLength(1);
      expect(data.runs[0].documentType).toBe("INVOICE");
    });
  });

  describe("GET /api/shipments/[id]/extract", () => {
    it("reports partial completion, field counts, and review-required counts accurately", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "manager@test.com", role: "MANAGER" } as never,
        authUser: { id: userId } as never,
      });

      const mockDocuments = [
        {
          id: docIdCI,
          docType: "INVOICE",
          documentVersion: 1,
          originalFileName: "invoice.pdf",
          extractionStatus: "COMPLETED",
          typeMismatch: false,
          detectedDocType: "INVOICE",
          extractionRuns: [
            {
              id: "run-ci",
              status: "COMPLETED",
              provider: "groq",
              model: "llama-3.3-70b-versatile",
              errorCode: null,
              errorMessage: null,
              completedAt: new Date(),
              latencyMs: 1200,
            },
          ],
          fields: [
            { id: "f1", fieldKey: "invoice_number", reviewStatus: "CONFIRMED", modelConfidence: 0.95 },
            { id: "f2", fieldKey: "total_amount", reviewStatus: "REQUIRES_REVIEW", modelConfidence: 0.65 },
          ],
          pages: [{ id: "p1", pageNumber: 1, isReadable: true, manualEntryRequired: false }],
        },
        {
          id: docIdPL,
          docType: "PACKING_LIST",
          documentVersion: 1,
          originalFileName: "packing-list.pdf",
          extractionStatus: "FAILED",
          typeMismatch: true,
          detectedDocType: "INVOICE",
          extractionRuns: [
            {
              id: "run-pl",
              status: "FAILED",
              provider: "groq",
              model: "llama-3.3-70b-versatile",
              errorCode: "PROVIDER_UNAVAILABLE",
              errorMessage: "Provider service unavailable.",
              completedAt: new Date(),
              latencyMs: 300,
            },
          ],
          fields: [],
          pages: [{ id: "p2", pageNumber: 1, isReadable: false, manualEntryRequired: false }],
        },
      ];

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({
            id: shipmentId,
            status: "EXTRACTING",
            currentRevision: 2,
            documents: mockDocuments,
          }),
          update: vi.fn().mockResolvedValue({ id: shipmentId, status: "NEEDS_REVIEW" }),
        },
        document: {
          findMany: vi.fn().mockResolvedValue(mockDocuments),
        },
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request("http://localhost/api/shipments/s-1/extract");
      const res = await shipmentExtractGET(req, {
        params: Promise.resolve({ id: shipmentId }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.shipmentId).toBe(shipmentId);
      expect(data.shipmentStatus).toBe("NEEDS_REVIEW");
      expect(data.isExtracting).toBe(false);
      expect(data.documents).toHaveLength(2);

      // Verify CI doc aggregations
      const ciResult = data.documents.find((d: { docType: string }) => d.docType === "INVOICE");
      expect(ciResult.extractedFieldCount).toBe(2);
      expect(ciResult.reviewRequiredCount).toBe(1);
      expect(ciResult.confirmedCount).toBe(1);
      expect(ciResult.typeMismatch).toBe(false);

      // Verify PL doc aggregations (failed, type mismatch, unreadable)
      const plResult = data.documents.find((d: { docType: string }) => d.docType === "PACKING_LIST");
      expect(plResult.latestRun.status).toBe("FAILED");
      expect(plResult.latestRun.errorCode).toBe("PROVIDER_UNAVAILABLE");
      expect(plResult.typeMismatch).toBe(true);
      expect(plResult.detectedDocType).toBe("INVOICE");
      expect(plResult.unreadablePageCount).toBe(1);

      // Verify readiness blocks approval
      expect(data.readiness.isReadyForReview).toBe(false);
      expect(data.readiness.blockingReasons.length).toBeGreaterThan(0);
    });
  });

  describe("POST /api/documents/[id]/extract", () => {
    it("creates an extraction retry linking to the previous run", async () => {
      vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
        appUser: { id: userId, email: "exec@test.com", role: "EXECUTIVE" } as never,
        authUser: { id: userId } as never,
      });

      const parentRunId = "77777777-7777-4777-8777-777777777777";
      const retryRunId = "88888888-8888-4888-8888-888888888888";

      const mockDoc = {
        id: docIdCI,
        shipmentId,
        docType: "INVOICE",
        documentVersion: 1,
        pageCount: 1,
        shipment: { id: shipmentId },
        extractionRuns: [{ id: parentRunId, status: "FAILED" }],
      };

      const mockParentRun = { id: parentRunId };
      const mockCreatedRun = {
        id: retryRunId,
        retryOfRunId: parentRunId,
        status: "PROCESSING",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
      };

      const mockTx = {
        extractionRun: { create: vi.fn().mockResolvedValue(mockCreatedRun) },
        document: { update: vi.fn().mockResolvedValue({}) },
        auditEvent: { create: vi.fn().mockResolvedValue({}) },
      };

      const mockPrisma = {
        document: {
          findFirst: vi.fn().mockResolvedValue(mockDoc),
          findUnique: vi.fn().mockResolvedValue(mockDoc),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({ id: shipmentId, status: "EXTRACTING" }),
        },
        extractionRun: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            if (where.id === parentRunId) return Promise.resolve(mockParentRun);
            return Promise.resolve(null);
          }),
        },
        $transaction: vi.fn().mockImplementation(async (callback) => callback(mockTx)),
      };
      vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

      const req = new Request("http://localhost/api/documents/doc-1/extract", {
        method: "POST",
        body: JSON.stringify({ retry: true, retryOfRunId: parentRunId }),
      });

      const res = await documentExtractPOST(req, {
        params: Promise.resolve({ id: docIdCI }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.runId).toBe(retryRunId);
      expect(data.retryOfRunId).toBe(parentRunId);
      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: { status: "EXTRACTING" },
      });
    });
  });
});
