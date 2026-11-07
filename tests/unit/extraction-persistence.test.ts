import { describe, expect, it, vi } from "vitest";

import {
  ExtractionPersistenceService,
  initialExtractionKey,
  retryExtractionKey,
} from "@/lib/ai/persistence.service";
import type { ExtractionAdapterOutput } from "@/lib/ai/types";

/**
 * Week 3 Step 2 unit tests for the persistence rules. The same rules are exercised end to end
 * against PostgreSQL in tests/integration/extraction-workflow.test.ts.
 */

const runId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const shipmentId = "33333333-3333-4333-8333-333333333333";

function output(overrides: Partial<ExtractionAdapterOutput> = {}): ExtractionAdapterOutput {
  return {
    documentType: "INVOICE",
    detectedType: "INVOICE",
    typeMismatch: false,
    provider: "groq",
    model: "qwen/qwen3.8-27b",
    pageReadability: [{ pageNumber: 1, isReadable: true }],
    fields: [
      { fieldKey: "invoiceTotal", value: "16320.00", unit: "USD", modelConfidence: 0.97, sourceQuote: "TOTAL 16,320.00", pageNumber: 1, reviewStatus: "PENDING" },
    ],
    lineItems: [
      { lineNumber: 1, description: "LED", hsnCode: null, quantity: "2400", quantityUnit: "pcs", unitPrice: "6.80", currency: "USD", lineTotal: "16320.00", modelConfidence: 0.96, sourceQuote: "LED", pageNumber: 1 },
    ],
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, imageCount: 1, requestCount: 1 },
    warnings: [],
    ...overrides,
  };
}

function fakeTx(run: Record<string, unknown>, existingField: Record<string, unknown> | null = null) {
  const tx = {
    extractionRun: {
      findUnique: vi.fn().mockResolvedValue(run),
      update: vi.fn().mockImplementation(async ({ data }) => ({ ...run, ...data })),
      count: vi.fn().mockResolvedValue(0),
    },
    extractedField: {
      findUnique: vi.fn().mockResolvedValue(existingField),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    lineItem: { createMany: vi.fn() },
    documentPage: { upsert: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    document: { update: vi.fn() },
    shipment: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: shipmentId, status: "EXTRACTING", currentRevision: 4 }),
      update: vi.fn().mockImplementation(async ({ data }) => ({ id: shipmentId, status: data.status, currentRevision: 5 })),
    },
    auditEvent: { create: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, prisma };
}

const processingRun = (extra: Record<string, unknown> = {}) => ({
  id: runId,
  documentId,
  documentVersion: 1,
  status: "PROCESSING",
  requestedById: "u1",
  latencyMs: null,
  rawResponse: null,
  document: { id: documentId, shipmentId, selectedDocType: "INVOICE", docType: "INVOICE", detectedDocType: null, typeMismatch: false },
  ...extra,
});

describe("Extraction Persistence Service (Week 3 Step 2)", () => {
  it("builds deterministic idempotency keys per document version, model and prompt", () => {
    expect(initialExtractionKey({ documentId, documentVersion: 2, provider: "groq", model: "m" })).toBe(
      `extract:${documentId}:v2:groq:m:2026.11-v2`,
    );
    expect(retryExtractionKey(runId)).toBe(`retry:${runId}`);
    expect(initialExtractionKey({ documentId, documentVersion: 2, provider: "groq", model: "m" })).not.toBe(
      initialExtractionKey({ documentId, documentVersion: 3, provider: "groq", model: "m" }),
    );
  });

  it("returns the existing run for a known idempotency key without creating anything", async () => {
    const existing = { id: runId, documentId, status: "COMPLETED" };
    const prisma = {
      extractionRun: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(),
    };
    const result = await new ExtractionPersistenceService(prisma as never).createOrGetExtractionRun({
      documentId,
      requestedById: "u1",
      provider: "groq",
      model: "m",
      pageCount: 1,
      idempotencyKey: "k",
    });
    expect(result).toEqual({ run: existing, isExisting: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to reuse a key that belongs to another document", async () => {
    const prisma = { extractionRun: { findUnique: vi.fn().mockResolvedValue({ id: runId, documentId: "other" }) } };
    await expect(
      new ExtractionPersistenceService(prisma as never).createOrGetExtractionRun({
        documentId, requestedById: "u1", provider: "groq", model: "m", pageCount: 1, idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
  });

  it("rejects a retry whose parent run belongs to a different document", async () => {
    const prisma = {
      extractionRun: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "parent", documentId: "other" }) },
      document: { findUnique: vi.fn().mockResolvedValue({ id: documentId, documentVersion: 1, shipmentId }) },
      $transaction: vi.fn(),
    };
    await expect(
      new ExtractionPersistenceService(prisma as never).createOrGetExtractionRun({
        documentId, requestedById: "u1", provider: "groq", model: "m", pageCount: 1, idempotencyKey: "k", retryOfRunId: "parent",
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns the winner's run when a concurrent create hits the unique idempotency key", async () => {
    const winner = { id: "winner", documentId };
    const prisma = {
      extractionRun: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner) },
      document: { findUnique: vi.fn().mockResolvedValue({ id: documentId, documentVersion: 1, shipmentId, pageCount: 1 }) },
      $transaction: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
    };
    const result = await new ExtractionPersistenceService(prisma as never).createOrGetExtractionRun({
      documentId, requestedById: "u1", provider: "groq", model: "m", pageCount: 1, idempotencyKey: "k",
    });
    expect(result).toEqual({ run: winner, isExisting: true });
  });

  it("saves modelValue = currentValue, decimals as strings, readability without auto manual entry", async () => {
    const { tx, prisma } = fakeTx(processingRun());
    await new ExtractionPersistenceService(prisma as never).saveExtractionResult({
      runId,
      result: output({ pageReadability: [{ pageNumber: 1, isReadable: false, reviewNote: "blurred" }] }),
      pageNumbers: [1],
      isFinal: false,
    });

    const created = tx.extractedField.create.mock.calls.map((c) => c[0].data);
    expect(created.find((d) => d.fieldKey === "invoiceTotal")).toMatchObject({
      modelValue: "16320.00",
      currentValue: "16320.00",
      reviewStatus: "PENDING",
    });
    // Required fields the AI did not return are recorded for review, never inferred.
    expect(created.find((d) => d.fieldKey === "exporter")).toMatchObject({ modelValue: null, reviewStatus: "REQUIRES_REVIEW", reviewReason: "REQUIRED_FIELD_MISSING" });
    expect(tx.lineItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ quantity: "2400", unitPrice: "6.80", lineTotal: "16320.00" });
    expect(tx.documentPage.upsert.mock.calls[0][0]).toMatchObject({
      update: { isReadable: false, reviewNote: "blurred" },
      create: { pageNumber: 1, isReadable: false },
    });
    expect(JSON.stringify(tx.documentPage.upsert.mock.calls)).not.toContain("manualEntryRequired");
    expect(tx.shipment.update).not.toHaveBeenCalled(); // not final yet
  });

  it("stores the model's evidence note next to the policy code", async () => {
    const { tx, prisma } = fakeTx(processingRun());
    await new ExtractionPersistenceService(prisma as never).saveExtractionResult({
      runId,
      result: output({
        fields: [{ fieldKey: "invoiceTotal", value: "16320.00", unit: "USD", modelConfidence: 0.9, sourceQuote: null, pageNumber: null, reviewStatus: "PENDING", reviewReason: "CALCULATED" }],
      }),
      isFinal: false,
    });
    const total = tx.extractedField.create.mock.calls.map((c) => c[0].data).find((d) => d.fieldKey === "invoiceTotal");
    expect(total).toMatchObject({ reviewStatus: "REQUIRES_REVIEW", reviewReason: "MISSING_SOURCE_EVIDENCE: CALCULATED" });
  });

  it("never changes a field a human has touched", async () => {
    const { tx, prisma } = fakeTx(processingRun(), {
      id: "f1", modelValue: "100", currentValue: "120", modelConfidence: 0.5, reviewStatus: "CORRECTED",
    });
    await new ExtractionPersistenceService(prisma as never).saveExtractionResult({ runId, result: output(), isFinal: false });
    expect(tx.extractedField.update).not.toHaveBeenCalled();
  });

  it("refuses results for a run that is no longer PROCESSING", async () => {
    const { prisma } = fakeTx(processingRun({ status: "FAILED" }));
    await expect(
      new ExtractionPersistenceService(prisma as never).saveExtractionResult({ runId, result: output() }),
    ).rejects.toMatchObject({ code: "RUN_CLOSED", status: 409 });
  });

  it("treats a batch number that is already stored as a replay", async () => {
    const { tx, prisma } = fakeTx(processingRun({ rawResponse: { batches: { "0": { pageNumbers: [1], warnings: [] } } } }));
    const result = await new ExtractionPersistenceService(prisma as never).saveExtractionResult({ runId, result: output(), batchNumber: 0 });
    expect(result.replayed).toBe(true);
    expect(tx.extractedField.create).not.toHaveBeenCalled();
    expect(tx.lineItem.createMany).not.toHaveBeenCalled();
  });

  it("on the final batch completes the run, bumps the revision and settles the shipment", async () => {
    const { tx, prisma } = fakeTx(processingRun());
    await new ExtractionPersistenceService(prisma as never).saveExtractionResult({ runId, result: output(), pageNumbers: [1], isFinal: true, latencyMs: 1200 });

    expect(tx.extractionRun.update.mock.calls[0][0].data).toMatchObject({ status: "COMPLETED", latencyMs: 1200 });
    expect(tx.extractionRun.update.mock.calls[0][0].data.rawResponse).toMatchObject({
      usage: { totalTokens: 150 },
      batches: { "0": { pageNumbers: [1] } },
    });
    expect(tx.document.update).toHaveBeenLastCalledWith({ where: { id: documentId }, data: { extractionStatus: "EXTRACTED" } });
    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { id: shipmentId },
      data: { status: "NEEDS_REVIEW", currentRevision: { increment: 1 } },
    });
    expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: "EXTRACTION_COMPLETED", metadata: expect.objectContaining({ revision: 5 }) });
  });

  it("keeps the shipment EXTRACTING while another current document is still processing", async () => {
    const { tx, prisma } = fakeTx(processingRun());
    tx.extractionRun.count.mockResolvedValue(1);
    await new ExtractionPersistenceService(prisma as never).saveExtractionResult({ runId, result: output(), isFinal: true });
    expect(tx.shipment.update.mock.calls[0][0].data.status).toBe("EXTRACTING");
  });

  it("records a failure with a safe code, keeps the run and audits without the message body", async () => {
    const { tx, prisma } = fakeTx(processingRun());
    await new ExtractionPersistenceService(prisma as never).recordExtractionFailure({
      runId,
      errorCode: "RATE_LIMIT",
      errorMessage: "Groq rate limit reached. Please retry in a few moments.",
      latencyMs: 300,
    });
    expect(tx.extractionRun.update.mock.calls[0][0].data).toMatchObject({ status: "FAILED", errorCode: "RATE_LIMIT" });
    expect(tx.document.update).toHaveBeenCalledWith({ where: { id: documentId }, data: { extractionStatus: "FAILED" } });
    expect(tx.auditEvent.create.mock.calls[0][0].data.metadata).toEqual({ documentId, errorCode: "RATE_LIMIT" });
  });

  it("reports partial completion and blockers per required slot", async () => {
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          { selectedDocType: "INVOICE", typeMismatch: false, pages: [], extractionRuns: [{ status: "COMPLETED" }] },
          { selectedDocType: "PACKING_LIST", typeMismatch: false, pages: [{ pageNumber: 2, isReadable: false, manualEntryRequired: false }], extractionRuns: [{ status: "COMPLETED" }] },
          { selectedDocType: "BILL_OF_LADING", typeMismatch: false, pages: [], extractionRuns: [{ status: "FAILED", errorCode: "QUOTA_EXCEEDED" }] },
        ]),
      },
    };
    const readiness = await new ExtractionPersistenceService(prisma as never).checkShipmentExtractionReadiness(shipmentId);
    expect(readiness).toMatchObject({
      isReadyForReview: false,
      completedSlots: ["INVOICE", "PACKING_LIST"],
      failedSlots: ["BILL_OF_LADING"],
    });
    expect(readiness.blockingReasons.join(" ")).toMatch(/page\(s\) 2 on PACKING LIST/);
    expect(readiness.blockingReasons.join(" ")).toMatch(/QUOTA_EXCEEDED/);
  });
});
