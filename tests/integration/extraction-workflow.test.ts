import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { ExtractionService } from "@/lib/ai/extraction.service";
import { runExtractionBatch, startDocumentExtraction } from "@/lib/ai/extraction-workflow";
import { markPageForManualEntry, saveManualField } from "@/lib/ai/manual-fallback";
import { ExtractionPersistenceService, STALE_RUN_AFTER_MS } from "@/lib/ai/persistence.service";
import { validateAndNormalizeResponse } from "@/lib/ai/response-validator";
import type { AIProvider, DocumentType, ExtractionInput } from "@/lib/ai/types";
import { ProviderError } from "@/lib/errors";

/**
 * Week 3 workflow against real PostgreSQL with a scripted AI provider (no network, no cost).
 * The scripted provider returns JSON text that goes through the real response validator, so
 * schema validation, normalization, the review policy, persistence, idempotency and shipment
 * state are all exercised as in production. All rows are synthetic and removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

// Header bytes are what the server checks; the provider is scripted, so no decoder runs.
const jpegBase64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const page = (pageNumber: number) => ({ pageNumber, imageBase64: jpegBase64, mimeType: "image/jpeg" as const });

const ev = (value: string | null, pageNumber: number, confidence = 0.97) => ({
  value,
  unit: null,
  confidence,
  sourceQuote: value ? `Printed: ${value}` : null,
  pageNumber: value ? pageNumber : null,
  reviewReason: null,
});

function invoiceJson(pages: number[], overrides: Record<string, unknown> = {}) {
  const p = pages[0];
  return JSON.stringify({
    detectedDocumentType: "INVOICE",
    pageReadability: pages.map((pageNumber) => ({ pageNumber, isReadable: true, reviewNote: null })),
    exporter: ev("Company B (China)", p),
    importer: ev("Acme Logistics India Pvt Ltd", p),
    documentNumber: ev("INV-24811", p),
    issueDate: ev("2026-10-15", p),
    currency: ev("USD", p),
    invoiceTotal: { ...ev("16,320.00", p), unit: "USD" },
    grossWeight: { ...ev("3120", p), currency: "kg" },
    lineItems: [
      {
        lineNumber: 1,
        description: "LED panel light 40W",
        quantity: "2400",
        quantityUnit: "pcs",
        unitPrice: "6.80",
        currency: "USD",
        lineTotal: "16320.00",
        confidence: 0.96,
        sourceQuote: "LED panel light 40W 2,400 6.80 16,320.00",
        pageNumber: p,
      },
    ],
    ...overrides,
  });
}

class ScriptedProvider implements AIProvider {
  readonly name = "groq" as const;
  calls = 0;
  constructor(
    readonly model: string,
    private readonly respond: (input: ExtractionInput, call: number) => string | Error,
  ) {}
  async extractDocument(input: ExtractionInput) {
    this.calls += 1;
    const response = this.respond(input, this.calls);
    if (response instanceof Error) throw response;
    try {
      return validateAndNormalizeResponse({
        documentType: input.documentType,
        content: response,
        provider: this.name,
        model: this.model,
        usage: { promptTokens: 2000, completionTokens: 500, totalTokens: 2500, imageCount: input.pages.length, requestCount: 1 },
        pageNumbers: input.pages.map((p) => p.pageNumber),
      });
    } catch {
      // Same wrapping as the real Groq/OpenRouter adapters.
      throw new ProviderError("Response does not match the extraction schema.", "INVALID_RESPONSE");
    }
  }
}

function billOfLadingJson(pages: number[], detectedDocumentType = "BILL_OF_LADING") {
  const p = pages[0];
  return JSON.stringify({
    detectedDocumentType,
    pageReadability: pages.map((pageNumber) => ({ pageNumber, isReadable: true })),
    exporter: ev("Company B (China)", p),
    importer: ev("Acme Logistics India Pvt Ltd", p),
    documentNumber: ev("MSKU-24811-BL", p),
    issueDate: ev("2026-10-18", p),
    packageCount: { ...ev("120", p), unit: "cartons" },
    grossWeight: { ...ev("3165", p), unit: "kg" },
    portOfLoading: ev("Shanghai, China", p),
    portOfDischarge: ev("Nhava Sheva, India", p),
    lineItems: [],
  });
}

describe.skipIf(!enabled)("Week 3 extraction workflow (PostgreSQL + scripted provider)", { timeout: 60_000 }, () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const owner = { id: randomUUID(), role: "EXECUTIVE" as const };
  const other = { id: randomUUID(), role: "EXECUTIVE" as const };
  const shipmentIds: string[] = [];
  const fast = (provider: AIProvider) => new ExtractionService(provider, { retryDelayMs: 0 });

  async function shipmentWith(docs: Array<{ type: DocumentType; pageCount: number }>, status = "IN_REVIEW") {
    const shipment = await prisma.shipment.create({
      data: { reference: `IT-W3-${tag}-${shipmentIds.length}`, createdById: owner.id, status: status as never, currentRevision: 2 },
    });
    shipmentIds.push(shipment.id);
    const documents = [];
    for (const d of docs) {
      const id = randomUUID();
      documents.push(
        await prisma.document.create({
          data: {
            id,
            shipmentId: shipment.id,
            docType: d.type,
            selectedDocType: d.type,
            storageKey: `shipments/${shipment.id}/documents/${id}/${randomUUID()}.pdf`,
            originalFileName: `${d.type.toLowerCase()}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 1000,
            sha256: randomUUID().replaceAll("-", ""),
            pageCount: d.pageCount,
            uploadedById: owner.id,
          },
        }),
      );
    }
    return { shipment, documents };
  }

  const batch = (documentId: string, runId: string, batchNumber: number, pages: number[], documentType: DocumentType = "INVOICE") => ({
    documentId,
    documentType,
    runId,
    batchNumber,
    pages: pages.map(page),
  });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [owner, other].map((u) => ({ id: u.id, email: `${u.id}@example.test`, role: u.role })),
    });
  });

  afterAll(async () => {
    try {
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("extracts a 4-page document in two batches, persists provenance and settles the shipment", async () => {
    const { shipment, documents } = await shipmentWith([{ type: "INVOICE", pageCount: 4 }]);
    const doc = documents[0];
    const provider = new ScriptedProvider("scripted-1", (input) =>
      input.pages[0].pageNumber === 1
        ? invoiceJson([1, 2, 3], { grossWeight: undefined })
        : invoiceJson([4], { exporter: undefined, lineItems: [] }),
    );

    const { run } = await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider });
    expect(run.status).toBe("PROCESSING");
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("EXTRACTING");

    // Starting again returns the same run (no duplicate metered run).
    const again = await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider });
    expect(again.run.id).toBe(run.id);

    const first = await runExtractionBatch(prisma, { actor: owner, provider, extractionService: fast(provider), body: batch(doc.id, run.id, 0, [1, 2, 3]) });
    expect(first.isFinal).toBe(false);

    // Replaying a stored batch does not call the provider again.
    const replay = await runExtractionBatch(prisma, { actor: owner, provider, extractionService: fast(provider), body: batch(doc.id, run.id, 0, [1, 2, 3]) });
    expect(replay.cached).toBe(true);
    expect(provider.calls).toBe(1);

    const last = await runExtractionBatch(prisma, { actor: owner, provider, extractionService: fast(provider), body: batch(doc.id, run.id, 1, [4]) });
    expect(last.isFinal).toBe(true);
    expect(provider.calls).toBe(2);

    const stored = await prisma.extractionRun.findUniqueOrThrow({ where: { id: run.id }, include: { fields: true, lineItems: true } });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.promptVersion).toBe("2026.11-v2");
    const byKey = Object.fromEntries(stored.fields.map((f) => [f.fieldKey, f]));
    expect(byKey.invoiceTotal).toMatchObject({ modelValue: "16320.00", currentValue: "16320.00", unit: "USD", pageNumber: 1 });
    // grossWeight was missing in batch 0 and found on page 4; the field-level "currency" alias became the unit.
    expect(byKey.grossWeight).toMatchObject({ modelValue: "3120", currentValue: "3120", unit: "kg", pageNumber: 4 });
    // An optional field absent from both batches is NOT_PRESENT, not a mismatch.
    expect(byKey.incoterm).toMatchObject({ currentValue: null, reviewStatus: "NOT_PRESENT" });
    expect(stored.lineItems).toHaveLength(1);
    expect(stored.lineItems[0].unitPrice?.toString()).toBe("6.8");
    expect(stored.lineItems[0].lineTotal?.toString()).toBe("16320");
    expect((stored.rawResponse as { usage: { totalTokens: number } }).usage.totalTokens).toBe(5000);

    const pages = await prisma.documentPage.findMany({ where: { documentId: doc.id }, orderBy: { pageNumber: "asc" } });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);

    const after = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(after).toMatchObject({ status: "NEEDS_REVIEW", currentRevision: 3 });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).extractionStatus).toBe("EXTRACTED");

    // A completed run is served from the database.
    const cached = await runExtractionBatch(prisma, { actor: owner, provider, extractionService: fast(provider), body: batch(doc.id, run.id, 0, [1, 2, 3]) });
    expect(cached.cached).toBe(true);
    expect(cached.result?.fields.find((f) => f.fieldKey === "invoiceTotal")?.value).toBe("16320.00");
    expect(provider.calls).toBe(2);
  });

  it("rejects foreign runs, other users' documents, wrong page sets and fake images", async () => {
    const a = await shipmentWith([{ type: "INVOICE", pageCount: 1 }]);
    const b = await shipmentWith([{ type: "INVOICE", pageCount: 1 }]);
    const provider = new ScriptedProvider("scripted-2", (input) => invoiceJson(input.pages.map((p) => p.pageNumber)));
    const runA = (await startDocumentExtraction(prisma, { documentId: a.documents[0].id, actor: owner, provider })).run;

    await expect(
      runExtractionBatch(prisma, { actor: owner, provider, body: batch(b.documents[0].id, runA.id, 0, [1]) }),
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND", status: 404 });
    await expect(
      runExtractionBatch(prisma, { actor: other, provider, body: batch(a.documents[0].id, runA.id, 0, [1]) }),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(
      runExtractionBatch(prisma, { actor: owner, provider, body: batch(a.documents[0].id, runA.id, 0, [2]) }),
    ).rejects.toMatchObject({ code: "INVALID_PAGES" });
    await expect(
      runExtractionBatch(prisma, {
        actor: owner,
        provider,
        body: { ...batch(a.documents[0].id, runA.id, 0, [1]), pages: [{ pageNumber: 1, mimeType: "image/jpeg", imageBase64: Buffer.alloc(200, 65).toString("base64") }] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(provider.calls).toBe(0);
  });

  it("fails safely on quota exhaustion, keeps the failed run and links an idempotent retry", async () => {
    const { shipment, documents } = await shipmentWith([{ type: "INVOICE", pageCount: 1 }]);
    const doc = documents[0];
    const quota = new ScriptedProvider("scripted-3", () => new ProviderError("Groq rejected the request because the account quota is exhausted.", "QUOTA_EXCEEDED", 402));
    const run = (await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider: quota })).run;

    await expect(
      runExtractionBatch(prisma, { actor: owner, provider: quota, extractionService: fast(quota), body: batch(doc.id, run.id, 0, [1]) }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(quota.calls).toBe(1); // 402 is not retried

    const failed = await prisma.extractionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(failed).toMatchObject({ status: "FAILED", errorCode: "QUOTA_EXCEEDED" });
    expect(failed.errorMessage).not.toMatch(/gsk_|stack|at /);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("NEEDS_REVIEW");

    // A closed run accepts no more batches; a retry is a new linked run, and asking twice returns it.
    await expect(
      runExtractionBatch(prisma, { actor: owner, provider: quota, body: batch(doc.id, run.id, 0, [1]) }),
    ).rejects.toMatchObject({ code: "RUN_CLOSED" });
    const retry1 = (await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider: quota, retry: true })).run;
    const retry2 = (await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider: quota, retry: true })).run;
    expect(retry1.retryOfRunId).toBe(run.id);
    expect(retry2.id).toBe(retry1.id);
    expect(await prisma.extractionRun.count({ where: { documentId: doc.id } })).toBe(2);
  });

  it("retries a rate limit exactly once and stores invalid model output as a safe failure", async () => {
    const { documents } = await shipmentWith([{ type: "INVOICE", pageCount: 1 }, { type: "PACKING_LIST", pageCount: 1 }]);
    const flaky = new ScriptedProvider("scripted-4", (input, call) =>
      call === 1 ? new ProviderError("Groq rate limit reached.", "RATE_LIMIT", 429) : invoiceJson(input.pages.map((p) => p.pageNumber)),
    );
    const run = (await startDocumentExtraction(prisma, { documentId: documents[0].id, actor: owner, provider: flaky })).run;
    await runExtractionBatch(prisma, { actor: owner, provider: flaky, extractionService: fast(flaky), body: batch(documents[0].id, run.id, 0, [1]) });
    expect(flaky.calls).toBe(2);

    const garbage = new ScriptedProvider("scripted-5", () => '{"detectedDocumentType":"PACKING_LIST","injected":{"value":"x"}}');
    const plRun = (await startDocumentExtraction(prisma, { documentId: documents[1].id, actor: owner, provider: garbage })).run;
    await expect(
      runExtractionBatch(prisma, { actor: owner, provider: garbage, extractionService: fast(garbage), body: batch(documents[1].id, plRun.id, 0, [1], "PACKING_LIST") }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(garbage.calls).toBe(1); // invalid output is not retried
    const failed = await prisma.extractionRun.findUniqueOrThrow({ where: { id: plRun.id }, include: { fields: true } });
    expect(failed.status).toBe("FAILED");
    expect(failed.fields).toHaveLength(0); // nothing from schema-invalid output is trusted
  });

  it("keeps the shipment EXTRACTING until every started document finishes (partial completion)", async () => {
    const { shipment, documents } = await shipmentWith([{ type: "INVOICE", pageCount: 1 }, { type: "BILL_OF_LADING", pageCount: 1 }]);
    const provider = new ScriptedProvider("scripted-6", (input) => invoiceJson(input.pages.map((p) => p.pageNumber)));
    const invRun = (await startDocumentExtraction(prisma, { documentId: documents[0].id, actor: owner, provider })).run;
    const blRun = (await startDocumentExtraction(prisma, { documentId: documents[1].id, actor: owner, provider })).run;

    await runExtractionBatch(prisma, { actor: owner, provider, extractionService: fast(provider), body: batch(documents[0].id, invRun.id, 0, [1]) });
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("EXTRACTING");

    const persistence = new ExtractionPersistenceService(prisma);
    const partial = await persistence.checkShipmentExtractionReadiness(shipment.id);
    expect(partial).toMatchObject({ isReadyForReview: false, completedSlots: ["INVOICE"], pendingSlots: ["BILL_OF_LADING"], missingSlots: ["PACKING_LIST"] });

    // The BL page's header reads as an invoice: a document-type mismatch blocker, not a silent pass.
    const mislabelled = new ScriptedProvider("scripted-6", () => billOfLadingJson([1], "INVOICE"));
    await runExtractionBatch(prisma, { actor: owner, provider: mislabelled, extractionService: fast(mislabelled), body: batch(documents[1].id, blRun.id, 0, [1], "BILL_OF_LADING") });
    const settled = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(settled.status).toBe("NEEDS_REVIEW");
    const bl = await prisma.document.findUniqueOrThrow({ where: { id: documents[1].id } });
    expect(bl).toMatchObject({ typeMismatch: true, detectedDocType: "INVOICE", extractionStatus: "REVIEW_REQUIRED" });
    const readiness = await persistence.checkShipmentExtractionReadiness(shipment.id);
    expect(readiness.blockingReasons.join(" ")).toMatch(/type mismatch on BILL OF LADING/i);
  });

  it("creates exactly one run when two starts race", async () => {
    const { documents } = await shipmentWith([{ type: "INVOICE", pageCount: 1 }]);
    const provider = new ScriptedProvider("scripted-7", () => invoiceJson([1]));
    const [a, b] = await Promise.all([
      startDocumentExtraction(prisma, { documentId: documents[0].id, actor: owner, provider }),
      startDocumentExtraction(prisma, { documentId: documents[0].id, actor: owner, provider }),
    ]);
    expect(a.run.id).toBe(b.run.id);
    expect(await prisma.extractionRun.count({ where: { documentId: documents[0].id } })).toBe(1);
  });

  it("refuses extraction on submitted, approved or exported shipments", async () => {
    for (const status of ["READY_FOR_APPROVAL", "APPROVED", "EXPORTED"]) {
      const { documents } = await shipmentWith([{ type: "INVOICE", pageCount: 1 }], status);
      const provider = new ScriptedProvider("scripted-8", () => invoiceJson([1]));
      await expect(
        startDocumentExtraction(prisma, { documentId: documents[0].id, actor: owner, provider }),
      ).rejects.toMatchObject({ code: "EXTRACTION_LOCKED", status: 409 });
    }
  });

  it("expires abandoned PROCESSING runs as FAILED (ABANDONED)", async () => {
    const { shipment, documents } = await shipmentWith([{ type: "INVOICE", pageCount: 1 }]);
    const provider = new ScriptedProvider("scripted-9", () => invoiceJson([1]));
    const run = (await startDocumentExtraction(prisma, { documentId: documents[0].id, actor: owner, provider })).run;
    await prisma.extractionRun.update({ where: { id: run.id }, data: { startedAt: new Date(Date.now() - STALE_RUN_AFTER_MS - 1000) } });

    expect(await new ExtractionPersistenceService(prisma).expireStaleRuns(shipment.id)).toBe(1);
    expect(await prisma.extractionRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED", errorCode: "ABANDONED" });
  });

  it("unreadable page: AI flags it, a person marks it, and only that page's fields unlock for manual entry", async () => {
    const { shipment, documents } = await shipmentWith([{ type: "INVOICE", pageCount: 2 }]);
    const doc = documents[0];
    const provider = new ScriptedProvider("scripted-10", () =>
      invoiceJson([1, 2], {
        pageReadability: [
          { pageNumber: 1, isReadable: true, reviewNote: null },
          { pageNumber: 2, isReadable: false, reviewNote: "Heavy cross-hatching" },
        ],
        invoiceTotal: { value: null, unit: null, confidence: null, sourceQuote: null, pageNumber: null, reviewReason: "BLURRED_MARGIN" },
      }),
    );
    const run = (await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider })).run;
    await runExtractionBatch(prisma, { actor: owner, provider, extractionService: fast(provider), body: batch(doc.id, run.id, 0, [1, 2]) });

    const page2 = await prisma.documentPage.findUniqueOrThrow({ where: { documentId_pageNumber: { documentId: doc.id, pageNumber: 2 } } });
    expect(page2).toMatchObject({ isReadable: false, manualEntryRequired: false, reviewNote: "Heavy cross-hatching" });
    const persistence = new ExtractionPersistenceService(prisma);
    expect((await persistence.checkShipmentExtractionReadiness(shipment.id)).blockingReasons.join(" ")).toMatch(/page\(s\) 2/);

    // Manual entry is locked for a field the AI read on a readable page, and for unknown keys or bad numbers.
    await expect(
      saveManualField(prisma, { documentId: doc.id, actor: owner, body: { fieldKey: "documentNumber", value: "INV-X", reason: "Typo" } }),
    ).rejects.toMatchObject({ code: "MANUAL_ENTRY_NOT_UNLOCKED" });

    await expect(
      markPageForManualEntry(prisma, { documentId: doc.id, actor: owner, body: { pageNumber: 9 } }),
    ).rejects.toMatchObject({ code: "INVALID_PAGE" });
    const before = (await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).currentRevision;
    await markPageForManualEntry(prisma, { documentId: doc.id, actor: owner, body: { pageNumber: 2, expectedRevision: before } });
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).currentRevision).toBe(before + 1);
    await expect(
      markPageForManualEntry(prisma, { documentId: doc.id, actor: owner, body: { pageNumber: 2, expectedRevision: before } }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });

    await expect(
      saveManualField(prisma, { documentId: doc.id, actor: owner, body: { fieldKey: "notAField", value: "1", reason: "x" } }),
    ).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });
    await expect(
      saveManualField(prisma, { documentId: doc.id, actor: owner, body: { fieldKey: "invoiceTotal", value: "about 16k", reason: "Read from scan" } }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD_VALUE" });

    const saved = await saveManualField(prisma, {
      documentId: doc.id,
      actor: owner,
      body: { fieldKey: "invoiceTotal", value: "16,320.00", unit: "USD", pageNumber: 2, reason: "Read from page 2 scan" },
    });
    expect(saved.field).toMatchObject({ extractionRunId: run.id, modelValue: null, currentValue: "16320.00", reviewStatus: "MANUAL_ENTRY" });
    const correction = await prisma.fieldCorrection.findFirstOrThrow({ where: { fieldId: saved.field.id } });
    expect(correction).toMatchObject({ correctedById: owner.id, newValue: "16320.00" });
    expect(correction.createdAt).toBeInstanceOf(Date);
    expect((await persistence.checkShipmentExtractionReadiness(shipment.id)).blockingReasons.join(" ")).not.toMatch(/page\(s\)/);
  });

  it("after a failed AI run, manual values go into a separate manual run and the failed run is preserved", async () => {
    const { shipment, documents } = await shipmentWith([{ type: "PACKING_LIST", pageCount: 1 }]);
    const doc = documents[0];
    const down = new ScriptedProvider("scripted-11", () => new ProviderError("Groq service is temporarily unavailable.", "UNAVAILABLE", 503));
    const run = (await startDocumentExtraction(prisma, { documentId: doc.id, actor: owner, provider: down })).run;
    await expect(
      runExtractionBatch(prisma, { actor: owner, provider: down, extractionService: fast(down), body: batch(doc.id, run.id, 0, [1], "PACKING_LIST") }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(down.calls).toBe(2); // 503 gets exactly one retry

    const saved = await saveManualField(prisma, {
      documentId: doc.id,
      actor: owner,
      body: { fieldKey: "grossWeight", value: "3165", unit: "kg", pageNumber: 1, reason: "Provider down; typed from PDF" },
    });
    const manualRun = await prisma.extractionRun.findUniqueOrThrow({ where: { id: saved.field.extractionRunId } });
    expect(manualRun).toMatchObject({ provider: "manual", status: "COMPLETED", retryOfRunId: run.id });
    expect(await prisma.extractionRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED" });

    // A second manual value reuses the same manual run.
    const second = await saveManualField(prisma, {
      documentId: doc.id,
      actor: owner,
      body: { fieldKey: "packageCount", value: "120", pageNumber: 1, reason: "Typed from PDF" },
    });
    expect(second.field.extractionRunId).toBe(manualRun.id);
    const readiness = await new ExtractionPersistenceService(prisma).checkShipmentExtractionReadiness(shipment.id);
    expect(readiness.completedSlots).toEqual(["PACKING_LIST"]);
    expect(readiness.failedSlots).toEqual([]);
  });
});
