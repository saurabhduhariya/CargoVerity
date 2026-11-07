import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Week 3 Step 6: shipment-level extraction API and the slot status shown in the UI.
 */

const startDocumentExtraction = vi.fn();
vi.mock("@/lib/ai/extraction-workflow", () => ({
  startDocumentExtraction: (...args: unknown[]) => startDocumentExtraction(...args),
}));
vi.mock("@/lib/ai/provider-factory", () => ({ createAIProvider: () => ({ name: "groq", model: "m" }) }));
const requireAppUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAppUser: () => requireAppUser() }));

const readiness = { isReadyForReview: false, completedSlots: ["INVOICE"], pendingSlots: [], missingSlots: [], failedSlots: [], blockingReasons: [] };
const expireStaleRuns = vi.fn().mockResolvedValue(0);
vi.mock("@/lib/ai/persistence.service", () => ({
  ExtractionPersistenceService: class {
    expireStaleRuns = expireStaleRuns;
    checkShipmentExtractionReadiness = async () => readiness;
  },
}));

const prisma = {
  shipment: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  extractionRun: { findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ getPrisma: () => prisma }));

const { POST, GET } = await import("@/app/api/shipments/[id]/extract/route");
const { deriveSlotExtractionState, formatPlainLanguageError } = await import("@/features/documents/shipment-document-slots");

const shipmentId = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id: shipmentId }) };
const post = (body: unknown = {}) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const doc = (id: string, selectedDocType: string, latest?: { status: string }) => ({
  id,
  selectedDocType,
  documentVersion: 1,
  extractionRuns: latest ? [latest] : [],
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAppUser.mockResolvedValue({ appUser: { id: "u1", role: "EXECUTIVE" } });
  startDocumentExtraction.mockImplementation(async ({ documentId, retry }) => ({
    run: { id: `run-${documentId}`, status: "PROCESSING", provider: "groq", model: "m", retryOfRunId: retry ? "old" : null },
    isExisting: false,
  }));
  prisma.shipment.findUniqueOrThrow.mockResolvedValue({ id: shipmentId, status: "EXTRACTING" });
});

describe("POST /api/shipments/[id]/extract", () => {
  it("returns 401 when unauthenticated", async () => {
    requireAppUser.mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
    expect((await POST(post(), params)).status).toBe(401);
  });

  it("scopes the lookup to the Executive's own shipments and returns 404 otherwise", async () => {
    prisma.shipment.findFirst.mockResolvedValue(null);
    const response = await POST(post(), params);
    expect(response.status).toBe(404);
    expect(prisma.shipment.findFirst.mock.calls[0][0].where).toEqual({ id: shipmentId, createdById: "u1" });
  });

  it("returns 400 when nothing is uploaded", async () => {
    prisma.shipment.findFirst.mockResolvedValue({ id: shipmentId, documents: [] });
    expect((await POST(post(), params)).status).toBe(400);
  });

  it("starts one run per current document and reports the server-decided status", async () => {
    prisma.shipment.findFirst.mockResolvedValue({
      id: shipmentId,
      documents: [doc("ci", "INVOICE"), doc("pl", "PACKING_LIST"), doc("bl", "BILL_OF_LADING")],
    });
    const response = await POST(post(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("EXTRACTING");
    expect(body.runs.map((r: { documentType: string }) => r.documentType)).toEqual(["INVOICE", "PACKING_LIST", "BILL_OF_LADING"]);
    expect(startDocumentExtraction).toHaveBeenCalledTimes(3);
    expect(startDocumentExtraction.mock.calls.every((c) => c[1].retry === false)).toBe(true);
  });

  it("with forceRetry, retries only documents whose latest run FAILED", async () => {
    prisma.shipment.findFirst.mockResolvedValue({
      id: shipmentId,
      documents: [doc("ci", "INVOICE", { status: "FAILED" }), doc("pl", "PACKING_LIST", { status: "COMPLETED" })],
    });
    await POST(post({ forceRetry: true }), params);
    expect(startDocumentExtraction.mock.calls.map((c) => [c[1].documentId, c[1].retry])).toEqual([
      ["ci", true],
      ["pl", false],
    ]);
  });

  it("supports targeted extraction by document type", async () => {
    prisma.shipment.findFirst.mockResolvedValue({ id: shipmentId, documents: [doc("ci", "INVOICE"), doc("pl", "PACKING_LIST")] });
    await POST(post({ documentTypes: ["PACKING_LIST"] }), params);
    expect(startDocumentExtraction).toHaveBeenCalledTimes(1);
    expect(startDocumentExtraction.mock.calls[0][1].documentId).toBe("pl");
  });
});

describe("GET /api/shipments/[id]/extract", () => {
  it("counts fields from each document's latest completed run and reports partial state", async () => {
    prisma.shipment.findFirst.mockResolvedValue({ id: shipmentId });
    prisma.shipment.findUniqueOrThrow.mockResolvedValue({
      id: shipmentId,
      status: "EXTRACTING",
      currentRevision: 4,
      documents: [
        { id: "ci", selectedDocType: "INVOICE", documentVersion: 1, extractionStatus: "REVIEW_REQUIRED", typeMismatch: false, pages: [], extractionRuns: [{ id: "r2", status: "COMPLETED", provider: "groq" }] },
        { id: "pl", selectedDocType: "PACKING_LIST", documentVersion: 1, extractionStatus: "PROCESSING", typeMismatch: false, pages: [{ pageNumber: 2, isReadable: false, manualEntryRequired: false }], extractionRuns: [{ id: "r3", status: "PROCESSING", provider: "groq" }] },
      ],
    });
    prisma.extractionRun.findMany.mockResolvedValue([
      { documentId: "ci", fields: [{ reviewStatus: "PENDING", reviewReason: null }, { reviewStatus: "REQUIRES_REVIEW", reviewReason: "LOW_MODEL_CONFIDENCE" }, { reviewStatus: "NOT_PRESENT", reviewReason: null }] },
      // An older completed run of the same document must not be counted again.
      { documentId: "ci", fields: [{ reviewStatus: "REQUIRES_REVIEW", reviewReason: "LOW_MODEL_CONFIDENCE" }] },
    ]);

    const response = await GET(new Request("http://localhost/x"), params);
    const body = await response.json();
    expect(expireStaleRuns).toHaveBeenCalledWith(shipmentId);
    expect(body).toMatchObject({ shipmentStatus: "EXTRACTING", shipmentRevision: 4, isExtracting: true, readiness });
    expect(body.documents[0]).toMatchObject({ extractedFieldCount: 2, reviewRequiredCount: 1, lowConfidenceCount: 1 });
    expect(body.documents[1]).toMatchObject({ extractedFieldCount: 0, unreadablePageCount: 1, unreadablePages: [2] });
  });
});

describe("slot extraction state (UI)", () => {
  it.each([
    [{ extractionStatus: "UPLOADED", latestRun: null }, "NOT_EXTRACTED"],
    [{ extractionStatus: "PROCESSING", latestRun: { status: "PROCESSING", provider: "groq" } }, "EXTRACTING"],
    [{ extractionStatus: "EXTRACTED", latestRun: { status: "COMPLETED", provider: "groq" } }, "EXTRACTED"],
    [{ extractionStatus: "REVIEW_REQUIRED", latestRun: { status: "COMPLETED", provider: "groq" } }, "NEEDS_REVIEW"],
    [{ extractionStatus: "FAILED", latestRun: { status: "FAILED", provider: "groq" } }, "FAILED"],
    [{ extractionStatus: "FAILED", latestRun: { status: "COMPLETED", provider: "manual" } }, "MANUAL_ENTRY"],
  ])("maps %o to %s", (doc, state) => {
    expect(deriveSlotExtractionState(doc as never)).toBe(state);
  });

  it("explains provider failures with retry and manual options", () => {
    expect(formatPlainLanguageError("QUOTA_EXCEEDED")).toMatch(/Enter the values manually/);
    expect(formatPlainLanguageError("RATE_LIMIT")).toMatch(/enter the values manually/);
    expect(formatPlainLanguageError("INVALID_RESPONSE")).toMatch(/nothing was saved/);
    expect(formatPlainLanguageError("ABANDONED")).toMatch(/Retry/);
    expect(formatPlainLanguageError("EXTRACTION_LOCKED")).toMatch(/cannot be re-run/);
  });
});
