import { describe, expect, it, vi, beforeEach } from "vitest";

import { ExtractionPersistenceService } from "@/lib/ai/persistence.service";
import type { ExtractionAdapterOutput } from "@/lib/ai/types";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const requestedById = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

describe("Extraction Persistence Service (Week 3 Step 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createOrGetExtractionRun", () => {
    it("creates a new run with documentVersion, requestedBy, timestamps, and audit event", async () => {
      const mockDocument = {
        id: documentId,
        shipmentId,
        docType: "INVOICE",
        documentVersion: 2,
      };

      const mockCreatedRun = {
        id: runId,
        documentId,
        documentVersion: 2,
        requestedById,
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        status: "PROCESSING",
        pageCount: 3,
        startedAt: new Date(),
      };

      const mockTx = {
        extractionRun: {
          create: vi.fn().mockResolvedValue(mockCreatedRun),
        },
        document: {
          update: vi.fn().mockResolvedValue({ id: documentId }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };

      const mockPrisma = {
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        document: {
          findUnique: vi.fn().mockResolvedValue(mockDocument),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      const { run, isExisting } = await service.createOrGetExtractionRun({
        documentId,
        requestedById,
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        pageCount: 3,
        idempotencyKey: "unique-key-123",
      });

      expect(isExisting).toBe(false);
      expect(run.id).toBe(runId);
      expect(mockTx.extractionRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId,
          documentVersion: 2,
          requestedById,
          idempotencyKey: "unique-key-123",
          status: "PROCESSING",
        }),
      });
      expect(mockTx.document.update).toHaveBeenCalledWith({
        where: { id: documentId },
        data: { extractionStatus: "PROCESSING", pageCount: 3 },
      });
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId,
          action: "EXTRACTION_RUN_STARTED",
          entityType: "ExtractionRun",
          entityId: runId,
        }),
      });
    });

    it("returns existing run when identical idempotencyKey is supplied", async () => {
      const mockExistingRun = {
        id: runId,
        documentId,
        idempotencyKey: "idemp-existing-key",
        status: "COMPLETED",
      };

      const mockPrisma = {
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(mockExistingRun),
        },
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      const { run, isExisting } = await service.createOrGetExtractionRun({
        documentId,
        requestedById,
        provider: "groq",
        model: "qwen",
        pageCount: 1,
        idempotencyKey: "idemp-existing-key",
      });

      expect(isExisting).toBe(true);
      expect(run.id).toBe(runId);
      expect(mockPrisma.extractionRun.findUnique).toHaveBeenCalledWith({
        where: { idempotencyKey: "idemp-existing-key" },
        include: { document: true },
      });
    });

    it("records retry linkage to parent run when retryOfRunId is provided", async () => {
      const parentRunId = "55555555-5555-5555-8555-555555555555";
      const mockDocument = { id: documentId, shipmentId, docType: "INVOICE", documentVersion: 1 };
      const mockParentRun = { id: parentRunId };

      const mockTx = {
        extractionRun: {
          create: vi.fn().mockResolvedValue({ id: runId, retryOfRunId: parentRunId }),
        },
        document: { update: vi.fn().mockResolvedValue({ id: documentId }) },
        auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-2" }) },
      };

      const mockPrisma = {
        extractionRun: {
          findUnique: vi.fn().mockImplementation(({ where }) => {
            if (where.id === parentRunId) return Promise.resolve(mockParentRun);
            return Promise.resolve(null);
          }),
        },
        document: { findUnique: vi.fn().mockResolvedValue(mockDocument) },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      const { run } = await service.createOrGetExtractionRun({
        documentId,
        requestedById,
        provider: "groq",
        model: "qwen",
        pageCount: 1,
        retryOfRunId: parentRunId,
      });

      expect(run.retryOfRunId).toBe(parentRunId);
      expect(mockTx.extractionRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          retryOfRunId: parentRunId,
        }),
      });
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "EXTRACTION_RETRY_STARTED",
        }),
      });
    });
  });

  describe("saveExtractionResult", () => {
    it("preserves modelValue as immutable and sets currentValue initially", async () => {
      const mockRun = {
        id: runId,
        documentId,
        requestedById,
        document: { id: documentId, shipmentId, docType: "INVOICE" },
      };

      const mockTx = {
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(mockRun),
          update: vi.fn().mockResolvedValue({ id: runId, status: "COMPLETED" }),
        },
        extractedField: {
          findUnique: vi.fn().mockResolvedValue(null), // no existing field
          create: vi.fn().mockResolvedValue({ id: "field-1" }),
        },
        lineItem: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        documentPage: {
          upsert: vi.fn().mockResolvedValue({ id: "page-1" }),
        },
        document: {
          update: vi.fn().mockResolvedValue({ id: documentId }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-3" }),
        },
      };

      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const result: ExtractionAdapterOutput = {
        documentType: "INVOICE",
        detectedType: "INVOICE",
        typeMismatch: false,
        pageReadability: [{ pageNumber: 1, isReadable: true }],
        provider: "groq",
        model: "qwen",
        fields: [
          {
            fieldKey: "invoiceTotal",
            value: "3120.00",
            unit: "USD",
            modelConfidence: 0.95,
            sourceQuote: "3,120.00",
            pageNumber: 1,
            reviewStatus: "PENDING",
            reviewReason: null,
          },
        ],
        lineItems: [
          {
            lineNumber: 1,
            description: "LED Panel",
            hsnCode: "9405",
            quantity: "2400",
            quantityUnit: "pcs",
            unitPrice: "15.00",
            currency: "USD",
            lineTotal: "36000.00",
            modelConfidence: 0.95,
            sourceQuote: "LED Panel 2400 pcs",
            pageNumber: 1,
          },
        ],
        warnings: [],
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      await service.saveExtractionResult({
        runId,
        result,
        isFinal: true,
        latencyMs: 420,
      });

      // 1. ExtractedField created with modelValue = "3120.00" and currentValue = "3120.00"
      expect(mockTx.extractedField.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId,
          extractionRunId: runId,
          fieldKey: "invoiceTotal",
          modelValue: "3120.00",
          currentValue: "3120.00",
          unit: "USD",
          modelConfidence: 0.95,
        }),
      });

      // 2. Line items created
      expect(mockTx.lineItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            documentId,
            extractionRunId: runId,
            lineNumber: 1,
            description: "LED Panel",
            quantity: 2400,
            lineTotal: 36000,
          }),
        ],
      });

      // 3. DocumentPage upserted
      expect(mockTx.documentPage.upsert).toHaveBeenCalledWith({
        where: {
          documentId_pageNumber: { documentId, pageNumber: 1 },
        },
        update: expect.objectContaining({ isReadable: true }),
        create: expect.objectContaining({ isReadable: true }),
      });

      // 4. ExtractionRun completed and document status set to REVIEW_REQUIRED
      expect(mockTx.extractionRun.update).toHaveBeenCalledWith({
        where: { id: runId },
        data: expect.objectContaining({
          status: "COMPLETED",
          latencyMs: 420,
        }),
      });
      expect(mockTx.document.update).toHaveBeenCalledWith({
        where: { id: documentId },
        data: expect.objectContaining({
          extractionStatus: "REVIEW_REQUIRED",
        }),
      });
    });

    it("does not overwrite immutable modelValue when updating an existing field with higher confidence", async () => {
      const mockRun = {
        id: runId,
        documentId,
        requestedById,
        document: { id: documentId, shipmentId, docType: "INVOICE" },
      };

      const mockExistingField = {
        id: "field-1",
        fieldKey: "invoiceTotal",
        modelValue: "3120.00", // original immutable
        currentValue: "3120.00",
        modelConfidence: 0.7,
      };

      const mockTx = {
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(mockRun),
          update: vi.fn().mockResolvedValue({ id: runId }),
        },
        extractedField: {
          findUnique: vi.fn().mockResolvedValue(mockExistingField),
          update: vi.fn().mockResolvedValue({ id: "field-1" }),
        },
        lineItem: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        documentPage: { upsert: vi.fn().mockResolvedValue({}) },
        document: { update: vi.fn().mockResolvedValue({}) },
        auditEvent: { create: vi.fn().mockResolvedValue({}) },
      };

      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const result: ExtractionAdapterOutput = {
        documentType: "INVOICE",
        detectedType: "INVOICE",
        typeMismatch: false,
        pageReadability: [],
        provider: "groq",
        model: "qwen",
        fields: [
          {
            fieldKey: "invoiceTotal",
            value: "3120.00",
            unit: "USD",
            modelConfidence: 0.98, // Higher confidence
            sourceQuote: "3,120.00",
            pageNumber: 1,
            reviewStatus: "PENDING",
          },
        ],
        lineItems: [],
        warnings: [],
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      await service.saveExtractionResult({ runId, result, isFinal: true });

      // Verifies modelValue is preserved from existing row ("3120.00")
      expect(mockTx.extractedField.update).toHaveBeenCalledWith({
        where: { id: "field-1" },
        data: expect.objectContaining({
          modelValue: "3120.00",
          currentValue: "3120.00",
          modelConfidence: 0.98,
        }),
      });
    });
  });

  describe("recordExtractionFailure", () => {
    it("marks run and document as FAILED and logs audit event", async () => {
      const mockRun = {
        id: runId,
        documentId,
        requestedById,
        document: { id: documentId, shipmentId, docType: "INVOICE" },
      };

      const mockTx = {
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(mockRun),
          update: vi.fn().mockResolvedValue({ id: runId, status: "FAILED" }),
        },
        document: { update: vi.fn().mockResolvedValue({ id: documentId }) },
        auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-fail" }) },
      };

      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      await service.recordExtractionFailure({
        runId,
        errorCode: "RATE_LIMIT",
        errorMessage: "Groq rate limit exceeded.",
        latencyMs: 150,
      });

      expect(mockTx.extractionRun.update).toHaveBeenCalledWith({
        where: { id: runId },
        data: expect.objectContaining({
          status: "FAILED",
          errorCode: "RATE_LIMIT",
          errorMessage: "Groq rate limit exceeded.",
          latencyMs: 150,
        }),
      });
      expect(mockTx.document.update).toHaveBeenCalledWith({
        where: { id: documentId },
        data: { extractionStatus: "FAILED" },
      });
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "EXTRACTION_FAILED",
          entityType: "ExtractionRun",
          entityId: runId,
        }),
      });
    });
  });

  describe("Shipment-level Operations", () => {
    it("creates one run per current document for a shipment extraction request", async () => {
      const mockDocs = [
        { id: "doc-ci", docType: "INVOICE", documentVersion: 1, pageCount: 2, isCurrent: true },
        { id: "doc-pl", docType: "PACKING_LIST", documentVersion: 1, pageCount: 2, isCurrent: true },
        { id: "doc-bl", docType: "BILL_OF_LADING", documentVersion: 1, pageCount: 1, isCurrent: true },
      ];

      const mockPrisma = {
        document: {
          findMany: vi.fn().mockResolvedValue(mockDocs),
          findUnique: vi.fn().mockImplementation(({ where }) => {
            const found = mockDocs.find((d) => d.id === where.id);
            return Promise.resolve(found);
          }),
        },
        extractionRun: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        $transaction: vi.fn().mockImplementation(async (cb) =>
          cb({
            extractionRun: {
              create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: `run-${data.documentId}`, ...data })),
            },
            document: { update: vi.fn().mockResolvedValue({}) },
            auditEvent: { create: vi.fn().mockResolvedValue({}) },
          }),
        ),
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      const runs = await service.createShipmentExtractionRuns({
        shipmentId,
        requestedById,
        provider: "groq",
        model: "qwen",
      });

      expect(runs).toHaveLength(3);
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith({
        where: { shipmentId, isCurrent: true },
      });
    });

    it("correctly identifies shipment readiness and blocks if any slot is missing or pending", async () => {
      // Scenario A: Only Invoice is completed, Packing List and BL missing
      const partialDocs = [
        {
          id: "doc-ci",
          docType: "INVOICE" as const,
          extractionRuns: [{ status: "COMPLETED" }],
          pages: [],
        },
      ];

      const mockPrisma = {
        document: {
          findMany: vi.fn().mockResolvedValue(partialDocs),
        },
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      const readiness = await service.checkShipmentExtractionReadiness(shipmentId);

      expect(readiness.isReadyForReview).toBe(false);
      expect(readiness.completedSlots).toContain("INVOICE");
      expect(readiness.missingSlots).toContain("PACKING_LIST");
      expect(readiness.missingSlots).toContain("BILL_OF_LADING");
      expect(readiness.blockingReasons.length).toBeGreaterThan(0);
    });

    it("approves shipment readiness when all 3 required documents are completed", async () => {
      const completeDocs = [
        { id: "doc-ci", docType: "INVOICE" as const, extractionRuns: [{ status: "COMPLETED" }], pages: [] },
        { id: "doc-pl", docType: "PACKING_LIST" as const, extractionRuns: [{ status: "COMPLETED" }], pages: [] },
        { id: "doc-bl", docType: "BILL_OF_LADING" as const, extractionRuns: [{ status: "COMPLETED" }], pages: [] },
      ];

      const mockPrisma = {
        document: {
          findMany: vi.fn().mockResolvedValue(completeDocs),
        },
      };

      const service = new ExtractionPersistenceService(mockPrisma as never);
      const readiness = await service.checkShipmentExtractionReadiness(shipmentId);

      expect(readiness.isReadyForReview).toBe(true);
      expect(readiness.completedSlots).toEqual(["INVOICE", "PACKING_LIST", "BILL_OF_LADING"]);
      expect(readiness.blockingReasons).toHaveLength(0);
    });
  });
});

