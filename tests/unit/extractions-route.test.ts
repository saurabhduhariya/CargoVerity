import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { POST } from "@/app/api/extractions/route";
import * as authModule from "@/lib/auth";
import * as dbModule from "@/lib/db";
import * as factoryModule from "@/lib/ai/provider-factory";
import * as loggerModule from "@/lib/ai/logger";
import { ProviderError } from "@/lib/errors";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

const validBase64 = "a".repeat(120);

describe("POST /api/extractions (Week 3 Step 3)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/cargoverity";
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_groq_key";
    process.env.GROQ_MODEL = "qwen/qwen3.8-27b";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when unauthenticated", async () => {
    vi.spyOn(authModule, "requireAppUser").mockRejectedValue(
      new Error("AUTHENTICATION_REQUIRED"),
    );

    const mockPrisma = {};
    vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

    const req = new Request("http://localhost/api/extractions", {
      method: "POST",
      body: JSON.stringify({
        documentId,
        documentType: "INVOICE",
        pages: [{ pageNumber: 1, imageBase64: validBase64, mimeType: "image/jpeg" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when document does not exist or user lacks access", async () => {
    vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
      appUser: { id: userId, email: "user@test.com", role: "EXECUTIVE" } as never,
      authUser: { id: userId } as never,
    });

    const mockPrisma = {
      document: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

    const req = new Request("http://localhost/api/extractions", {
      method: "POST",
      body: JSON.stringify({
        documentId,
        documentType: "INVOICE",
        pages: [{ pageNumber: 1, imageBase64: validBase64, mimeType: "image/jpeg" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Document not found or inaccessible.");
  });

  it("serves cached result and skips AI provider when completed run exists for idempotency key", async () => {
    vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
      appUser: { id: userId, email: "user@test.com", role: "EXECUTIVE" } as never,
      authUser: { id: userId } as never,
    });

    const mockDocument = {
      id: documentId,
      shipmentId,
      selectedDocType: "INVOICE",
      isCurrent: true,
      pages: [{ pageNumber: 1, isReadable: true, reviewNote: null }],
    };

    const mockCompletedRun = {
      id: runId,
      documentId,
      status: "COMPLETED",
      model: "qwen/qwen3.8-27b",
      promptVersion: "2026.11-v1",
      latencyMs: 750,
      document: mockDocument,
      fields: [
        {
          fieldKey: "invoiceTotal",
          modelValue: "1000.00",
          currentValue: "1000.00",
          unit: "USD",
          modelConfidence: 0.99,
          sourceQuote: "1000.00",
          pageNumber: 1,
          reviewStatus: "PENDING",
          reviewReason: null,
        },
      ],
      lineItems: [],
      rawResponse: { usage: { totalTokens: 500 } },
    };

    const mockPrisma = {
      document: { findFirst: vi.fn().mockResolvedValue(mockDocument) },
      extractionRun: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          if (where.idempotencyKey) return Promise.resolve(mockCompletedRun);
          if (where.id) return Promise.resolve(mockCompletedRun);
          return Promise.resolve(null);
        }),
      },
    };
    vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

    const mockExtract = vi.fn();
    vi.spyOn(factoryModule, "createAIProvider").mockReturnValue({
      name: "groq",
      model: "qwen/qwen3.8-27b",
      extractDocument: mockExtract,
    } as never);

    const logSpy = vi.spyOn(loggerModule, "logExtractionAttempt");

    const req = new Request("http://localhost/api/extractions", {
      method: "POST",
      body: JSON.stringify({
        documentId,
        documentType: "INVOICE",
        idempotencyKey: "idemp-cache-hit",
        pages: [{ pageNumber: 1, imageBase64: validBase64, mimeType: "image/jpeg" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cached).toBe(true);
    expect(body.runId).toBe(runId);
    expect(body.result.fields[0].fieldKey).toBe("invoiceTotal");

    // CRITICAL IDEMPOTENCY CHECK: AI provider was NOT invoked!
    expect(mockExtract).not.toHaveBeenCalled();

    // Verify safe structured log occurred
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        shipmentId,
        modelId: "qwen/qwen3.8-27b",
        promptVersion: "2026.11-v1",
      }),
    );
  });

  it("records safe failure and maps status when provider throws RATE_LIMIT", async () => {
    vi.spyOn(authModule, "requireAppUser").mockResolvedValue({
      appUser: { id: userId, email: "user@test.com", role: "EXECUTIVE" } as never,
      authUser: { id: userId } as never,
    });

    const mockDocument = {
      id: documentId,
      shipmentId,
      selectedDocType: "INVOICE",
      isCurrent: true,
      documentVersion: 1,
    };

    const mockCreatedRun = {
      id: runId,
      documentId,
      documentVersion: 1,
      status: "PROCESSING",
      model: "qwen/qwen3.8-27b",
      promptVersion: "2026.11-v1",
      pageCount: 1,
    };

    const mockTx = {
      extractionRun: {
        create: vi.fn().mockResolvedValue(mockCreatedRun),
        findUnique: vi.fn().mockResolvedValue({ ...mockCreatedRun, document: mockDocument }),
        update: vi.fn().mockResolvedValue({ id: runId, status: "FAILED" }),
      },
      document: {
        update: vi.fn().mockResolvedValue(mockDocument),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      },
    };

    const mockPrisma = {
      document: {
        findFirst: vi.fn().mockResolvedValue(mockDocument),
        findUnique: vi.fn().mockResolvedValue(mockDocument),
      },
      extractionRun: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
    };
    vi.spyOn(dbModule, "getPrisma").mockReturnValue(mockPrisma as never);

    vi.spyOn(factoryModule, "createAIProvider").mockReturnValue({
      name: "groq",
      model: "qwen/qwen3.8-27b",
      extractDocument: vi.fn().mockRejectedValue(
        new ProviderError("Groq rate limit reached.", "RATE_LIMIT", 429),
      ),
    } as never);

    const logSpy = vi.spyOn(loggerModule, "logExtractionAttempt");

    const req = new Request("http://localhost/api/extractions", {
      method: "POST",
      body: JSON.stringify({
        documentId,
        documentType: "INVOICE",
        pages: [{ pageNumber: 1, imageBase64: validBase64, mimeType: "image/jpeg" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMIT");

    // Failure was recorded in the database
    expect(mockTx.extractionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: runId },
        data: expect.objectContaining({
          status: "FAILED",
          errorCode: "RATE_LIMIT",
        }),
      }),
    );

    // Safe error log was emitted
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        shipmentId,
        errorCode: "RATE_LIMIT",
      }),
    );
  });
});
