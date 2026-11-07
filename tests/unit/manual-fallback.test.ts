import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Week 3 Step 5: manual fallback routes and value rules. The unlock rules, the manual run and
 * history preservation are exercised against PostgreSQL in
 * tests/integration/extraction-workflow.test.ts.
 */

const markPageForManualEntry = vi.fn();
const saveManualField = vi.fn();
vi.mock("@/lib/ai/manual-fallback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/manual-fallback")>()),
  markPageForManualEntry: (...args: unknown[]) => markPageForManualEntry(...args),
  saveManualField: (...args: unknown[]) => saveManualField(...args),
}));
const createCrossCheckRun = vi.fn();
vi.mock("@/lib/crosschecks/service", () => ({ createCrossCheckRun: (...a: unknown[]) => createCrossCheckRun(...a) }));
vi.mock("@/lib/db", () => ({ getPrisma: () => ({}) }));
const requireAppUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAppUser: () => requireAppUser() }));

const { POST: postPage } = await import("@/app/api/documents/[id]/pages/manual/route");
const { POST: postField } = await import("@/app/api/documents/[id]/fields/manual/route");
const { normalizeManualValue, manualFieldSchema } = await import("@/lib/ai/manual-fallback");
const { ExtractionError } = await import("@/lib/errors");

const params = { params: Promise.resolve({ id: "doc-1" }) };
const req = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAppUser.mockResolvedValue({ appUser: { id: "u1", role: "EXECUTIVE" } });
});

describe("Manual Fallback & Page State (Week 3 Step 5)", () => {
  it("returns 401 when unauthenticated", async () => {
    requireAppUser.mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
    expect((await postPage(req({ pageNumber: 1 }), params)).status).toBe(401);
    expect((await postField(req({ fieldKey: "x" }), params)).status).toBe(401);
    expect(markPageForManualEntry).not.toHaveBeenCalled();
  });

  it("marks a page and returns the new revision", async () => {
    markPageForManualEntry.mockResolvedValue({ page: { pageNumber: 2, manualEntryRequired: true }, shipment: { currentRevision: 5, status: "NEEDS_REVIEW" } });
    const response = await postPage(req({ pageNumber: 2 }), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revision: 5, shipmentStatus: "NEEDS_REVIEW", page: { manualEntryRequired: true } });
    expect(markPageForManualEntry.mock.calls[0][1]).toMatchObject({ documentId: "doc-1", actor: { id: "u1" } });
  });

  it("saves a manual field, recomputes cross-checks and returns them", async () => {
    saveManualField.mockResolvedValue({ field: { id: "f1", reviewStatus: "MANUAL_ENTRY" }, shipment: { id: "s1", currentRevision: 6, status: "NEEDS_REVIEW" } });
    createCrossCheckRun.mockResolvedValue({ results: [{ ruleKey: "gross_weight" }] });
    const response = await postField(req({ fieldKey: "grossWeight", value: "3165", reason: "typed" }), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revision: 6, crossChecks: [{ ruleKey: "gross_weight" }] });
    expect(createCrossCheckRun.mock.calls[0][0]).toMatchObject({ shipmentId: "s1", triggeredBy: "FIELD_MANUAL_ENTRY" });
  });

  it.each([
    ["MANUAL_ENTRY_NOT_UNLOCKED", 409],
    ["UNKNOWN_FIELD", 400],
    ["STALE_REVISION", 409],
    ["EXTRACTION_LOCKED", 409],
  ] as const)("surfaces %s with its status", async (code, status) => {
    saveManualField.mockRejectedValue(new ExtractionError("blocked", code, status));
    const response = await postField(req({}), params);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it("requires a reason for every manual value", () => {
    expect(manualFieldSchema.safeParse({ fieldKey: "grossWeight", value: "1" }).success).toBe(false);
    expect(manualFieldSchema.safeParse({ fieldKey: "grossWeight", value: "1", reason: "  " }).success).toBe(false);
  });

  it("canonicalizes numbers, validates dates and rejects unknown or empty required fields", () => {
    expect(normalizeManualValue("INVOICE", "invoiceTotal", " 16,320.00 ")).toBe("16320.00");
    expect(normalizeManualValue("PACKING_LIST", "issueDate", "2026-10-16")).toBe("2026-10-16");
    expect(normalizeManualValue("INVOICE", "incoterm", "  ")).toBeNull();
    expect(() => normalizeManualValue("INVOICE", "invoiceTotal", "about 16k")).toThrow(expect.objectContaining({ code: "INVALID_FIELD_VALUE" }));
    expect(() => normalizeManualValue("INVOICE", "issueDate", "next tuesday")).toThrow(expect.objectContaining({ code: "INVALID_FIELD_VALUE" }));
    expect(() => normalizeManualValue("INVOICE", "invoiceTotal", "")).toThrow(/required/);
    expect(() => normalizeManualValue("INVOICE", "vessel", "EVER GIVEN")).toThrow(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });
});
