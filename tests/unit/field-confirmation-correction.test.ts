import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as reviewFieldRoute } from "@/app/api/fields/[id]/review/route";
import { POST as correctFieldRoute } from "@/app/api/fields/[id]/correction/route";
import { POST as manualFieldRoute } from "@/app/api/documents/[id]/fields/manual/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as crosscheckService from "@/lib/crosschecks/service";

/**
 * Week 4 Step 7: field confirm / correct / manual entry.
 *
 * Uses a small in-memory fake with transaction rollback so the conditional revision lock,
 * atomic writes and rollback-on-error behave like PostgreSQL. Real concurrency against
 * PostgreSQL is covered in tests/integration/week4-crosscheck-review.test.ts.
 */

const executiveUser = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "executive@example.test",
  role: "EXECUTIVE" as const,
};

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const fieldId = "44444444-4444-4444-8444-444444444444";
const runId = "55555555-5555-4555-8555-555555555555";

type State = {
  shipment: { id: string; status: string; currentRevision: number; createdById: string };
  document: { id: string; shipmentId: string; isCurrent: boolean; selectedDocType: string };
  runs: Array<{ id: string; documentId: string; status: string; createdAt: Date }>;
  field: {
    id: string;
    documentId: string;
    extractionRunId: string;
    fieldKey: string;
    modelValue: string | null;
    currentValue: string | null;
    reviewStatus: string;
    reviewReason: string | null;
  };
  corrections: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
};

function makeState(overrides: { status?: string; revision?: number; currentValue?: string | null; fieldKey?: string } = {}): State {
  const value = overrides.currentValue === undefined ? "3120" : overrides.currentValue;
  return {
    shipment: { id: shipmentId, status: overrides.status ?? "NEEDS_REVIEW", currentRevision: overrides.revision ?? 2, createdById: executiveUser.id },
    document: { id: documentId, shipmentId, isCurrent: true, selectedDocType: "PACKING_LIST" },
    runs: [{ id: runId, documentId, status: "COMPLETED", createdAt: new Date("2026-11-06T10:00:00Z") }],
    field: {
      id: fieldId,
      documentId,
      extractionRunId: runId,
      fieldKey: overrides.fieldKey ?? "grossWeight",
      modelValue: value,
      currentValue: value,
      reviewStatus: "REQUIRES_REVIEW",
      reviewReason: null,
    },
    corrections: [],
    audits: [],
  };
}

function fakePrisma(state: State) {
  const client = {
    shipment: {
      findUnique: vi.fn(async () => ({ ...state.shipment })),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; currentRevision: number; status: { in: string[] } }; data: { status: string } }) => {
        const s = state.shipment;
        if (s.id !== where.id || s.currentRevision !== where.currentRevision || !where.status.in.includes(s.status)) return { count: 0 };
        s.currentRevision += 1;
        s.status = data.status;
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.shipment })),
    },
    document: { findUnique: vi.fn(async () => ({ isCurrent: state.document.isCurrent })) },
    extractionRun: {
      findFirst: vi.fn(async () => {
        const completed = state.runs.filter((run) => run.status === "COMPLETED");
        completed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
        return completed[0] ? { id: completed[0].id } : null;
      }),
    },
    extractedField: {
      findFirst: vi.fn(async () => ({
        ...state.field,
        document: { ...state.document, shipment: { ...state.shipment } },
      })),
      update: vi.fn(async ({ data }: { data: Partial<State["field"]> }) => {
        Object.assign(state.field, data);
        return { ...state.field };
      }),
    },
    fieldCorrection: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (state.corrections.push(data), data)) },
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (state.audits.push(data), data)) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({ shipment: state.shipment, field: state.field, corrections: state.corrections, audits: state.audits });
      try {
        return await callback(client);
      } catch (error) {
        Object.assign(state.shipment, snapshot.shipment);
        Object.assign(state.field, snapshot.field);
        state.corrections.splice(0, state.corrections.length, ...snapshot.corrections);
        state.audits.splice(0, state.audits.length, ...snapshot.audits);
        throw error;
      }
    }),
  };
  return client;
}

function actAsExecutive() {
  vi.spyOn(auth, "requireAppUser").mockResolvedValue({
    appUser: executiveUser as never,
    authUser: { id: executiveUser.id, email: executiveUser.email } as never,
  });
}

function mockRecompute() {
  return vi.spyOn(crosscheckService, "createCrossCheckRun").mockResolvedValue({
    run: { id: "run-new", shipmentId, revision: 3, inputHash: "h", inputSnapshot: {}, triggeredBy: "FIELD_CORRECTED", requestedById: executiveUser.id, createdAt: new Date() },
    revision: 3,
    results: [
      {
        id: "res-1",
        shipmentId,
        runId: "run-new",
        revision: 3,
        ruleKey: "gross_weight_comparison",
        ruleCode: "CHK_GROSS_WEIGHT",
        severity: "BLOCKING",
        status: "PASS",
        details: {},
        createdAt: new Date(),
        resolutions: [],
      },
    ],
  } as never);
}

const review = (body: unknown) =>
  reviewFieldRoute(
    new Request(`http://localhost:3000/api/fields/${fieldId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: fieldId }) },
  );

const correct = (body: unknown) =>
  correctFieldRoute(
    new Request(`http://localhost:3000/api/fields/${fieldId}/correction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: fieldId }) },
  );

describe("Field Confirmation and Correction (Week 4 Step 7)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when user is unauthenticated", async () => {
    vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
    const response = await review({ status: "CONFIRMED", expectedRevision: 2 });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Authentication required.");
  });

  it("requires expectedRevision (400) and changes nothing", async () => {
    actAsExecutive();
    const state = makeState();
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await correct({ value: "3165", reason: "Corrected from packing list" });

    expect(response.status).toBe(400);
    expect(state.shipment.currentRevision).toBe(2);
    expect(state.corrections).toHaveLength(0);
  });

  it("requires a reason when correcting or manually entering a value", async () => {
    actAsExecutive();
    const state = makeState();
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await review({ status: "CORRECTED", value: "3165", expectedRevision: 2 });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/reason/i);
    expect(state.shipment.currentRevision).toBe(2);
  });

  it.each(["APPROVED", "EXPORTED", "EXTRACTING"])("blocks edits while the shipment is %s (409 SHIPMENT_LOCKED)", async (status) => {
    actAsExecutive();
    const state = makeState({ status });
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await review({ status: "CORRECTED", value: "3165", reason: "Fixed weight error", expectedRevision: 2 });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SHIPMENT_LOCKED");
    expect(state.shipment.currentRevision).toBe(2);
  });

  it("returns 409 STALE_REVISION when expectedRevision does not match", async () => {
    actAsExecutive();
    const state = makeState({ revision: 3 });
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await review({ status: "CORRECTED", value: "3165", reason: "Corrected from packing list", expectedRevision: 2 });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("STALE_REVISION");
    expect(state.field.currentValue).toBe("3120");
  });

  it("a second edit at the same expectedRevision loses with 409 (conditional lock)", async () => {
    actAsExecutive();
    mockRecompute();
    const state = makeState();
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const first = await correct({ value: "3165", reason: "first edit", expectedRevision: 2 });
    const second = await correct({ value: "3170", reason: "second edit", expectedRevision: 2 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("STALE_REVISION");
    expect(state.shipment.currentRevision).toBe(3);
    expect(state.corrections).toHaveLength(1);
    expect(state.field.currentValue).toBe("3165");
  });

  it("CONFIRMED keeps the value, bumps the revision, writes an audit event and no FieldCorrection, then recomputes", async () => {
    actAsExecutive();
    const recompute = mockRecompute();
    const state = makeState();
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await review({ status: "CONFIRMED", expectedRevision: 2 });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.field.reviewStatus).toBe("CONFIRMED");
    expect(json.field.currentValue).toBe("3120");
    expect(json.revision).toBe(3);
    expect(state.corrections).toHaveLength(0);
    expect(state.audits[0]).toMatchObject({ action: "FIELD_CONFIRMED" });
    expect(recompute).toHaveBeenCalledWith(expect.objectContaining({ shipmentId, triggeredBy: "FIELD_CONFIRMED" }));
  });

  it("CONFIRMED on an empty value is rejected (422 EMPTY_CONFIRM_VALUE) without bumping the revision", async () => {
    actAsExecutive();
    const state = makeState({ currentValue: null, fieldKey: "netWeight" });
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await review({ status: "CONFIRMED", expectedRevision: 2 });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("EMPTY_CONFIRM_VALUE");
    expect(state.shipment.currentRevision).toBe(2);
  });

  it("a correction records FieldCorrection, keeps the original AI value, bumps the revision and invalidates approval atomically", async () => {
    actAsExecutive();
    const recompute = mockRecompute();
    const state = makeState({ status: "READY_FOR_APPROVAL" });
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await review({ status: "CORRECTED", value: "3,165", reason: "Corrected per packing list total", expectedRevision: 2 });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(state.field.currentValue).toBe("3165"); // canonicalized
    expect(state.field.modelValue).toBe("3120"); // original AI value preserved
    expect(state.corrections).toEqual([
      { fieldId, previousValue: "3120", newValue: "3165", reason: "Corrected per packing list total", correctedById: executiveUser.id },
    ]);
    expect(state.shipment).toMatchObject({ currentRevision: 3, status: "NEEDS_REVIEW" });
    expect(state.audits[0]).toMatchObject({
      action: "FIELD_CORRECTED",
      metadata: expect.objectContaining({
        previousStatus: "READY_FOR_APPROVAL",
        approvalInvalidated: true,
        expectedRevision: 2,
        revision: 3,
        modelValue: "3120",
      }),
    });
    expect(json).toMatchObject({ revision: 3, shipmentStatus: "NEEDS_REVIEW", approvalInvalidated: true, crossChecksStale: false });
    expect(json.crossChecks[0].status).toBe("PASS");
    expect(recompute).toHaveBeenCalledWith(expect.objectContaining({ triggeredBy: "FIELD_CORRECTED" }));
  });

  it("a correction equal to the canonical current value is rejected (422 NO_CHANGE)", async () => {
    actAsExecutive();
    const state = makeState({ currentValue: "3165" });
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await correct({ value: "3,165", reason: "same value again", expectedRevision: 2 });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("NO_CHANGE");
    expect(state.shipment.currentRevision).toBe(2);
  });

  it("rejects malformed numeric values via the manual-entry rules", async () => {
    actAsExecutive();
    const state = makeState();
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await correct({ value: "3,120.00.00", reason: "malformed on purpose", expectedRevision: 2 });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("INVALID_FIELD_VALUE");
    expect(state.field.currentValue).toBe("3120");
    expect(state.shipment.currentRevision).toBe(2);
  });

  it("a field from a superseded extraction run returns 409 FIELD_SUPERSEDED and rolls back the revision bump", async () => {
    actAsExecutive();
    const state = makeState();
    state.runs.push({ id: "newer-run", documentId, status: "COMPLETED", createdAt: new Date("2026-11-07T10:00:00Z") });
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await correct({ value: "3165", reason: "edit old run", expectedRevision: 2 });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("FIELD_SUPERSEDED");
    expect(state.shipment.currentRevision).toBe(2);
    expect(state.corrections).toHaveLength(0);
  });

  it("a recompute failure keeps the edit, returns crossChecksStale: true and logs only a safe code", async () => {
    actAsExecutive();
    vi.spyOn(crosscheckService, "createCrossCheckRun").mockRejectedValue(new Error("secret value 3165 leaked"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = makeState();
    vi.spyOn(db, "getPrisma").mockReturnValue(fakePrisma(state) as never);

    const response = await correct({ value: "3165", reason: "recompute will fail", expectedRevision: 2 });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.crossChecksStale).toBe(true);
    expect(json.crossChecks).toBeNull();
    expect(state.shipment.currentRevision).toBe(3);
    expect(errorLog).toHaveBeenCalledWith("[fields.recompute_failed]", "UNEXPECTED");
    for (const call of errorLog.mock.calls) {
      for (const arg of call) expect(String(arg)).not.toContain("secret");
    }
  });

  describe("POST /api/documents/[id]/fields/manual", () => {
    it("returns 409 Conflict when expectedRevision is stale", async () => {
      actAsExecutive();
      const mockDoc = {
        id: documentId,
        shipment: { id: shipmentId, status: "NEEDS_REVIEW", currentRevision: 5, createdById: executiveUser.id },
        extractionRuns: [],
      };
      vi.spyOn(db, "getPrisma").mockReturnValue({
        document: { findFirst: vi.fn().mockResolvedValue(mockDoc) },
      } as never);

      const request = new Request(`http://localhost:3000/api/documents/${documentId}/fields/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: "packageCount", value: "50", reason: "Found in document header", expectedRevision: 4 }),
      });

      const response = await manualFieldRoute(request, { params: Promise.resolve({ id: documentId }) });
      expect(response.status).toBe(409);
    });
  });
});
