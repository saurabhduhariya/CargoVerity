import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as correctionRoute } from "@/app/api/fields/[id]/correction/route";
import { GET as readinessRoute, POST as submitRoute } from "@/app/api/shipments/[id]/submit/route";
import * as auth from "@/lib/auth";
import { createCrossCheckRun } from "@/lib/crosschecks/service";

/**
 * Week 5 Step 1 against PostgreSQL: the real submission route, guard, row lock and audit.
 * Synthetic records only, tagged with a unique reference prefix and removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

type DocKey = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";

const COMMON = { exporter: "Nordic Valve AB", importer: "Delta Imports Pvt Ltd", issueDate: "2026-10-15" };
const FIELDS: Record<DocKey, Array<[string, string, string | null]>> = {
  INVOICE: [
    ["documentNumber", "INV-24811", null],
    ["currency", "USD", null],
    ["invoiceTotal", "16320", "USD"],
  ],
  PACKING_LIST: [
    ["documentNumber", "PL-24811", null],
    ["packageCount", "120", "cartons"],
    ["grossWeight", "3165", "kg"],
  ],
  BILL_OF_LADING: [
    ["documentNumber", "BL-24811", null],
    ["packageCount", "120", "cartons"],
    ["grossWeight", "3165", "kg"],
    ["portOfLoading", "SEGOT", null],
    ["portOfDischarge", "INNSA", null],
  ],
};

describe.skipIf(!enabled)("Week 5 Step 1 submission gates (PostgreSQL)", { timeout: 90_000 }, () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const executive = { id: randomUUID(), role: "EXECUTIVE" as const, email: `${randomUUID()}@example.test` };
  const otherExecutive = { id: randomUUID(), role: "EXECUTIVE" as const, email: `${randomUUID()}@example.test` };
  let counter = 0;

  beforeAll(async () => {
    await prisma.user.createMany({ data: [executive, otherExecutive].map((u) => ({ id: u.id, email: u.email, role: u.role })) });
  });

  afterAll(async () => {
    try {
      await prisma.shipment.deleteMany({ where: { reference: { startsWith: `IT-W5S-${tag}` } } });
      await prisma.user.deleteMany({ where: { id: { in: [executive.id, otherExecutive.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function actAs(user: typeof executive) {
    vi.spyOn(auth, "requireAppUser").mockResolvedValue({
      appUser: user as never,
      authUser: { id: user.id, email: user.email } as never,
    });
  }

  /** A fully reviewed SHP-24811-like shipment whose checks all pass. */
  async function seedSubmittable(options: { confirmAll?: boolean } = {}) {
    counter += 1;
    const shipment = await prisma.shipment.create({
      data: { reference: `IT-W5S-${tag}-${counter}`, status: "NEEDS_REVIEW", createdById: executive.id },
    });
    const fieldIds: Record<string, string> = {};
    for (const docType of ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as DocKey[]) {
      const document = await prisma.document.create({
        data: {
          shipmentId: shipment.id,
          docType,
          selectedDocType: docType,
          storageKey: `it-w5s/${tag}/${counter}/${docType}.pdf`,
          originalFileName: `${docType}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          pageCount: 1,
          uploadedById: executive.id,
          extractionStatus: "EXTRACTED",
        },
      });
      const run = await prisma.extractionRun.create({
        data: { documentId: document.id, provider: "test", model: "test", promptVersion: "test", status: "COMPLETED", pageCount: 1 },
      });
      const rows: Array<[string, string, string | null]> = [
        ["exporter", COMMON.exporter, null],
        ["importer", COMMON.importer, null],
        ["issueDate", COMMON.issueDate, null],
        ...FIELDS[docType],
      ];
      for (const [fieldKey, value, unit] of rows) {
        const field = await prisma.extractedField.create({
          data: {
            documentId: document.id,
            extractionRunId: run.id,
            fieldKey,
            modelValue: value,
            currentValue: value,
            unit,
            modelConfidence: "0.9700",
            sourceQuote: value,
            pageNumber: 1,
            reviewStatus: options.confirmAll === false && fieldKey === "grossWeight" ? "REQUIRES_REVIEW" : "CONFIRMED",
          },
        });
        fieldIds[`${docType}.${fieldKey}`] = field.id;
      }
      if (docType !== "BILL_OF_LADING") {
        await prisma.lineItem.create({
          data: {
            documentId: document.id,
            extractionRunId: run.id,
            lineNumber: 1,
            description: "Ball valves DN50",
            quantity: "2400",
            quantityUnit: "pcs",
            unitPrice: docType === "INVOICE" ? "6.80" : null,
            lineTotal: docType === "INVOICE" ? "16320" : null,
            currency: docType === "INVOICE" ? "USD" : null,
          },
        });
      }
    }
    const checks = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
    return { shipment, fieldIds, checks };
  }

  const submit = (shipmentId: string, body?: unknown) =>
    submitRoute(
      new Request(`http://localhost/api/shipments/${shipmentId}/submit`, {
        method: "POST",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      }),
      { params: Promise.resolve({ id: shipmentId }) },
    );
  const readiness = (shipmentId: string) =>
    readinessRoute(new Request(`http://localhost/api/shipments/${shipmentId}/submit`), { params: Promise.resolve({ id: shipmentId }) });
  const correct = (fieldId: string, body: unknown) =>
    correctionRoute(
      new Request(`http://localhost/api/fields/${fieldId}/correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: fieldId }) },
    );
  const shipmentRow = (id: string) => prisma.shipment.findUniqueOrThrow({ where: { id } });

  it("the seeded shipment passes every deterministic check", async () => {
    const { checks } = await seedSubmittable();
    const failing = checks.results.filter((r) => r.status === "MISMATCH" || r.status === "INCOMPLETE");
    expect(failing.map((r) => `${r.ruleKey}:${r.status}`)).toEqual([]);
  });

  it("a cleared shipment is submitted: READY_FOR_APPROVAL, same revision, audited with the real previous status", async () => {
    const { shipment, checks } = await seedSubmittable();
    actAs(executive);

    const response = await submit(shipment.id, { expectedRevision: 1 });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const row = await shipmentRow(shipment.id);
    expect(row).toMatchObject({ status: "READY_FOR_APPROVAL", currentRevision: 1 });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, action: "SHIPMENT_SUBMITTED_FOR_APPROVAL" } });
    expect(audit.actorId).toBe(executive.id);
    expect(audit.metadata).toMatchObject({ previousStatus: "NEEDS_REVIEW", revision: 1, checkRunId: checks.run.id });

    // Submitting again is rejected with an exact reason and writes nothing.
    const again = await submit(shipment.id);
    expect(again.status).toBe(422);
    expect(((await again.json()) as { reasons: string[] }).reasons).toEqual(["INVALID_SHIPMENT_STATUS"]);
    expect(await prisma.auditEvent.count({ where: { shipmentId: shipment.id, action: "SHIPMENT_SUBMITTED_FOR_APPROVAL" } })).toBe(1);
  });

  it("an unconfirmed required value blocks with exact reasons and leaves the status unchanged", async () => {
    const { shipment } = await seedSubmittable({ confirmAll: false });
    actAs(executive);

    const response = await submit(shipment.id);
    const body = (await response.json()) as { reasons: string[]; blockers: Array<{ code: string; documentType?: string; fieldKey?: string }> };

    expect(response.status).toBe(422);
    expect(body.reasons).toEqual(["REQUIRED_FIELD_UNCONFIRMED"]);
    expect(body.blockers.map((b) => `${b.documentType}.${b.fieldKey}`).sort()).toEqual(["BILL_OF_LADING.grossWeight", "PACKING_LIST.grossWeight"]);
    expect((await shipmentRow(shipment.id)).status).toBe("NEEDS_REVIEW");
  });

  it("a stale check run blocks submission (STALE_CHECK_RUN)", async () => {
    const { shipment } = await seedSubmittable();
    await prisma.shipment.update({ where: { id: shipment.id }, data: { currentRevision: 2 } });
    actAs(executive);

    const response = await submit(shipment.id);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { reasons: string[] }).reasons).toEqual(["STALE_CHECK_RUN"]);
  });

  it("a stale expectedRevision is a 409 and changes nothing", async () => {
    const { shipment } = await seedSubmittable();
    actAs(executive);

    const response = await submit(shipment.id, { expectedRevision: 7 });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("STALE_REVISION");
    expect((await shipmentRow(shipment.id)).status).toBe("NEEDS_REVIEW");
  });

  it("another Executive can neither read readiness nor submit the shipment (404)", async () => {
    const { shipment } = await seedSubmittable();
    actAs(otherExecutive);

    expect((await readiness(shipment.id)).status).toBe(404);
    const response = await submit(shipment.id);
    expect(response.status).toBe(404);
    expect((await shipmentRow(shipment.id)).status).toBe("NEEDS_REVIEW");
  });

  it("a submission racing a field correction never leaves READY_FOR_APPROVAL on unreviewed data", async () => {
    const { shipment, fieldIds } = await seedSubmittable();
    actAs(executive);

    const [submitResponse, correctionResponse] = await Promise.all([
      submit(shipment.id, { expectedRevision: 1 }),
      correct(fieldIds["PACKING_LIST.grossWeight"], { value: "3170", reason: "Re-read from the packing list", expectedRevision: 1 }),
    ]);

    expect(correctionResponse.status).toBe(200);
    expect([200, 409]).toContain(submitResponse.status);
    const row = await shipmentRow(shipment.id);
    // Whichever committed first, the correction always ends in NEEDS_REVIEW at the new revision.
    expect(row).toMatchObject({ status: "NEEDS_REVIEW", currentRevision: 2 });

    const correctionAudit = await prisma.auditEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, action: "FIELD_CORRECTED" } });
    const submittedCount = await prisma.auditEvent.count({ where: { shipmentId: shipment.id, action: "SHIPMENT_SUBMITTED_FOR_APPROVAL" } });
    if (submitResponse.status === 200) {
      // Submit won: the later correction withdrew it.
      expect(submittedCount).toBe(1);
      expect(correctionAudit.metadata).toMatchObject({ previousStatus: "READY_FOR_APPROVAL", approvalInvalidated: true });
    } else {
      expect(submittedCount).toBe(0);
      expect(((await submitResponse.json()) as { code: string }).code).toBe("STALE_REVISION");
    }
  });
});
