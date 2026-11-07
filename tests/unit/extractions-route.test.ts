import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Week 3 Step 3: route-level behaviour of POST /api/extractions and POST /api/documents/:id/extract
 * plus the pure batch/image guards. Workflow logic against PostgreSQL is covered by
 * tests/integration/extraction-workflow.test.ts.
 */

const runExtractionBatch = vi.fn();
const startDocumentExtraction = vi.fn();
vi.mock("@/lib/ai/extraction-workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/extraction-workflow")>()),
  runExtractionBatch: (...args: unknown[]) => runExtractionBatch(...args),
  startDocumentExtraction: (...args: unknown[]) => startDocumentExtraction(...args),
}));
vi.mock("@/lib/ai/provider-factory", () => ({ createAIProvider: () => ({ name: "groq", model: "m", extractDocument: vi.fn() }) }));
vi.mock("@/lib/db", () => ({ getPrisma: () => ({}) }));
const requireAppUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAppUser: () => requireAppUser() }));

const { POST: postExtraction } = await import("@/app/api/extractions/route");
const { POST: postDocumentExtract } = await import("@/app/api/documents/[id]/extract/route");
const { assertValidBatchPages, assertValidPageImages } = await import("@/lib/ai/extraction-workflow");
const { ExtractionError, ProviderError } = await import("@/lib/errors");

const user = { id: "u1", role: "EXECUTIVE" };
const request = (body: unknown) =>
  new Request("http://localhost/api/extractions", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAppUser.mockResolvedValue({ appUser: user });
});

describe("POST /api/extractions (Week 3 Step 3)", () => {
  it("returns 401 when unauthenticated and never runs extraction", async () => {
    requireAppUser.mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
    const response = await postExtraction(request({}));
    expect(response.status).toBe(401);
    expect(runExtractionBatch).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor (not a client-supplied one) to the workflow", async () => {
    runExtractionBatch.mockResolvedValue({ runId: "r1", result: null, isFinal: true, cached: true });
    const response = await postExtraction(request({ documentId: "d", actor: { id: "attacker", role: "MANAGER" } }));
    expect(response.status).toBe(200);
    expect(runExtractionBatch.mock.calls[0][1].actor).toEqual(user);
    await expect(response.json()).resolves.toMatchObject({ runId: "r1", cached: true });
  });

  it.each([
    [new ExtractionError("Extraction run not found for this document.", "RUN_NOT_FOUND", 404), 404, "RUN_NOT_FOUND"],
    [new ExtractionError("This extraction run has ended.", "RUN_CLOSED", 409), 409, "RUN_CLOSED"],
    [new ProviderError("Groq rate limit reached.", "RATE_LIMIT", 429), 429, "RATE_LIMIT"],
    [new ProviderError("Groq returned a response that does not match the extraction schema.", "INVALID_RESPONSE"), 502, "INVALID_RESPONSE"],
    [new ProviderError("Groq rejected the request because the account quota is exhausted.", "QUOTA_EXCEEDED", 402), 503, "QUOTA_EXCEEDED"],
    [new ProviderError("Groq extraction request timed out.", "TIMEOUT", 504), 504, "TIMEOUT"],
  ])("maps %s to a safe status and code", async (error, status, code) => {
    runExtractionBatch.mockRejectedValue(error);
    const response = await postExtraction(request({}));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toEqual({ error: error.message, code });
  });
});

describe("POST /api/documents/[id]/extract", () => {
  it("starts or resumes a run and reports whether it already existed", async () => {
    startDocumentExtraction.mockResolvedValue({ run: { id: "r1", status: "PROCESSING", retryOfRunId: null, provider: "groq", model: "m" }, isExisting: false });
    const response = await postDocumentExtract(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ retry: true }) }),
      { params: Promise.resolve({ id: "doc-1" }) },
    );
    expect(response.status).toBe(200);
    expect(startDocumentExtraction.mock.calls[0][1]).toMatchObject({ documentId: "doc-1", actor: user, retry: true });
    await expect(response.json()).resolves.toMatchObject({ runId: "r1", status: "PROCESSING", existing: false });
  });

  it("returns 409 EXTRACTION_LOCKED for submitted/approved/exported shipments", async () => {
    startDocumentExtraction.mockRejectedValue(new ExtractionError("locked", "EXTRACTION_LOCKED", 409));
    const response = await postDocumentExtract(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: "doc-1" }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "EXTRACTION_LOCKED" });
  });
});

describe("batch and image guards", () => {
  it("accepts only the exact pages of the batch slot and reports finality from the stored page count", () => {
    expect(assertValidBatchPages([1, 2, 3], 0, 7, 3)).toBe(false);
    expect(assertValidBatchPages([7], 2, 7, 3)).toBe(true);
    expect(assertValidBatchPages([1], 0, 1, 3)).toBe(true);
    for (const [pages, batch] of [[[1, 2], 0], [[2, 3, 4], 0], [[8], 2], [[1, 1, 2], 0], [[3, 2, 1], 0], [[4], 3]] as const) {
      expect(() => assertValidBatchPages([...pages], batch, 7, 3)).toThrow(expect.objectContaining({ code: "INVALID_PAGES" }));
    }
  });

  it("requires decodable base64 whose bytes match the declared image type and size", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]).toString("base64");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]).toString("base64");
    expect(() => assertValidPageImages([{ pageNumber: 1, mimeType: "image/jpeg", imageBase64: jpeg }], 10_000)).not.toThrow();
    expect(() => assertValidPageImages([{ pageNumber: 1, mimeType: "image/png", imageBase64: png }], 10_000)).not.toThrow();
    expect(() => assertValidPageImages([{ pageNumber: 1, mimeType: "image/png", imageBase64: jpeg }], 10_000)).toThrow(/not a image\/png/);
    expect(() => assertValidPageImages([{ pageNumber: 1, mimeType: "image/jpeg", imageBase64: "%%%notbase64" }], 10_000)).toThrow(/base64/);
    expect(() => assertValidPageImages([{ pageNumber: 1, mimeType: "image/jpeg", imageBase64: jpeg }], 50)).toThrow(/larger/);
  });
});
