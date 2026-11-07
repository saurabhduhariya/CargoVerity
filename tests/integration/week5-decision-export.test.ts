import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as decisionRoute } from "@/app/api/shipments/[id]/decision/route";
import { GET as exportRoute } from "@/app/api/shipments/[id]/export/route";
import { POST as submitRoute } from "@/app/api/shipments/[id]/submit/route";
import { GET as reportRoute } from "@/app/api/reports/accuracy/route";
import { GET as listRoute } from "@/app/api/shipments/route";
import * as auth from "@/lib/auth";
import { createCrossCheckRun } from "@/lib/crosschecks/service";

/**
 * Week 5 Steps 2-7 against PostgreSQL through the real routes: decision, guarded export and its
 * record, edit-after-approval invalidation, accuracy report and status list.
 * Synthetic records only, tagged with a unique reference prefix and removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

type DocKey = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";
const FIELDS: Record<DocKey, Array<[string, string, string | null]>> = {
  INVOICE: [
    ["exporter", "Nordic Valve AB", null],
    ["importer", "Delta Imports Pvt Ltd", null],
    ["issueDate", "2026-10-15", null],
    ["documentNumber", "INV-24811", null],
    ["currency", "USD", null],
    ["invoiceTotal", "16320", "USD"],
  ],
  PACKING_LIST: [
    ["exporter", "Nordic Valve AB", null],
    ["importer", "Delta Imports Pvt Ltd", null],
    ["issueDate", "2026-10-15", null],
    ["documentNumber", "PL-24811", null],
    ["packageCount", "120", "cartons"],
    ["grossWeight", "3.165", "MT"],
  ],
  BILL_OF_LADING: [
    ["exporter", "Nordic Valve AB", null],
    ["importer", "Delta Imports Pvt Ltd", null],
    ["issueDate", "2026-10-16", null],
    ["documentNumber", "BL-24811", null],
    ["packageCount", "120", "cartons"],
    ["grossWeight", "3165", "kg"],
    ["portOfLoading", "SEGOT", null],
    ["portOfDischarge", "INNSA", null],
  ],
};

describe.skipIf(!enabled)("Week 5 decision, export, reports and list (PostgreSQL)", { timeout: 120_000 }, () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const executive = { id: randomUUID(), role: "EXECUTIVE" as const, email: `${randomUUID()}@example.test` };
  const manager = { id: randomUUID(), role: "MANAGER" as const, email: `${randomUUID()}@example.test` };
  let supplierId = "";
  let counter = 0;

  beforeAll(async () => {
    await prisma.user.createMany({ data: [executive, manager].map((u) => ({ id: u.id, email: u.email, role: u.role })) });
    const supplier = await prisma.supplier.create({ data: { name: `IT W5 Supplier ${tag}`, normalizedName: `it w5 supplier ${tag.toLowerCase()}` } });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    try {
      await prisma.shipment.deleteMany({ where: { reference: { startsWith: `IT-W5D-${tag}` } } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: { in: [executive.id, manager.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  afterEach(() => vi.restoreAllMocks());

  function actAs(user: typeof executive | typeof manager) {
    vi.spyOn(auth, "requireAppUser").mockResolvedValue({ appUser: user as never, authUser: { id: user.id, email: user.email } as never });
    vi.spyOn(auth, "requireRole").mockImplementation(async (role) => {
      if (user.role !== role) throw new Error("FORBIDDEN");
      return { appUser: user as never, authUser: { id: user.id, email: user.email } as never };
    });
  }

  async function seedSubmitted() {
    counter += 1;
    const shipment = await prisma.shipment.create({
      data: { reference: `IT-W5D-${tag}-${counter}`, status: "NEEDS_REVIEW", createdById: executive.id, supplierId },
    });
    for (const docType of ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as DocKey[]) {
      const document = await prisma.document.create({
        data: {
          shipmentId: shipment.id,
          docType,
          selectedDocType: docType,
          storageKey: `it-w5d/${tag}/${counter}/${docType}.pdf`,
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
      for (const [fieldKey, value, unit] of FIELDS[docType]) {
        await prisma.extractedField.create({
          data: {
            documentId: document.id,
            extractionRunId: run.id,
            fieldKey,
            modelValue: fieldKey === "documentNumber" && docType === "INVOICE" ? "INV-2481l" : value,
            currentValue: value,
            unit,
            modelConfidence: "0.9700",
            sourceQuote: value,
            pageNumber: 1,
            reviewStatus: fieldKey === "documentNumber" && docType === "INVOICE" ? "CORRECTED" : "CONFIRMED",
          },
        });
      }
      if (docType !== "BILL_OF_LADING") {
        await prisma.lineItem.create({
          data: {
            documentId: document.id,
            extractionRunId: run.id,
            lineNumber: 1,
            description: "Ball valves DN50, \"brass\"",
            quantity: "2400",
            quantityUnit: "pcs",
            unitPrice: docType === "INVOICE" ? "6.80" : null,
            lineTotal: docType === "INVOICE" ? "16320" : null,
            currency: docType === "INVOICE" ? "USD" : null,
          },
        });
      }
    }
    await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
    actAs(executive);
    const submitted = await submitRoute(
      new Request(`http://localhost/api/shipments/${shipment.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      { params: Promise.resolve({ id: shipment.id }) },
    );
    expect(submitted.status).toBe(200);
    return shipment;
  }

  const decide = (shipmentId: string, body: unknown) =>
    decisionRoute(
      new Request(`http://localhost/api/shipments/${shipmentId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: shipmentId }) },
    );
  const exportCsv = (shipmentId: string, preview = false) =>
    exportRoute(new Request(`http://localhost/api/shipments/${shipmentId}/export${preview ? "?preview=1" : ""}`), {
      params: Promise.resolve({ id: shipmentId }),
    });
  const row = (id: string) => prisma.shipment.findUniqueOrThrow({ where: { id } });

  it("an Executive gets 403 and a never-submitted shipment cannot be approved", async () => {
    const shipment = await seedSubmitted();
    actAs(executive);
    expect((await decide(shipment.id, { decision: "APPROVE", expectedRevision: 1 })).status).toBe(403);

    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "NEEDS_REVIEW" } });
    actAs(manager);
    const response = await decide(shipment.id, { decision: "APPROVE", expectedRevision: 1 });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("NOT_SUBMITTED");
    expect(await prisma.approval.count({ where: { shipmentId: shipment.id } })).toBe(0);
  });

  it("rejection needs a comment and returns the shipment to NEEDS_REVIEW with an audit event", async () => {
    const shipment = await seedSubmitted();
    actAs(manager);
    expect((await decide(shipment.id, { decision: "REJECT", comment: "no", expectedRevision: 1 })).status).toBe(422);

    const response = await decide(shipment.id, { decision: "REJECT", comment: "BL weight must be re-read", expectedRevision: 1 });
    expect(response.status).toBe(200);
    expect((await row(shipment.id)).status).toBe("NEEDS_REVIEW");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, action: "SHIPMENT_REJECTED" } });
    expect(audit).toMatchObject({ actorId: manager.id, metadata: expect.objectContaining({ comment: "BL weight must be re-read", revision: 1 }) });
  });

  it("approve -> export: CSV in kg with the plan columns, stored record with checksum, reproducible re-download", async () => {
    const shipment = await seedSubmitted();
    actAs(manager);
    expect((await decide(shipment.id, { decision: "APPROVE", expectedRevision: 2 })).status).toBe(409); // stale revision

    const approved = await decide(shipment.id, { decision: "APPROVE", comment: "Complete", expectedRevision: 1 });
    expect(approved.status).toBe(200);
    expect(await prisma.approval.findUnique({ where: { shipmentId_revision: { shipmentId: shipment.id, revision: 1 } } })).toMatchObject({
      approvedById: manager.id,
    });

    const preview = (await (await exportCsv(shipment.id, true)).json()) as Record<string, unknown>;
    expect(preview).toMatchObject({ ready: true, blockers: [], approvedRevision: 1, rowCount: 1, profileVersion: "1.1.0" });

    actAs(executive);
    const first = await exportCsv(shipment.id);
    const csv = await first.text();
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Disposition")).toContain(`IT-W5D-${tag}-`);
    const [header, line] = csv.split("\r\n");
    expect(header).toBe(
      '"Shipment_Ref","Supplier_Name","Invoice_No","Invoice_Date","Currency","Incoterm","Item_Sr","HSN_Code","Item_Description","Quantity","Unit","Unit_Price","Line_Total","Gross_Weight_KG","Net_Weight_KG","Package_Count","Package_Type","Container_No","BL_No","Port_Of_Loading","Port_Of_Discharge"',
    );
    expect(line).toContain('"3165"'); // 3.165 MT on the packing list, converted to kg
    expect(line).toContain('"Ball valves DN50, ""brass"""');
    expect(line).toContain('"CARTON"');
    expect(preview.checksumSha256).toBe(createHash("sha256").update(csv, "utf-8").digest("hex"));

    const record = await prisma.exportEvent.findFirstOrThrow({ where: { shipmentId: shipment.id } });
    expect(record).toMatchObject({
      exportedById: executive.id,
      profileId: "demo-v1",
      profileVersion: "1.1.0",
      checksumSha256: preview.checksumSha256,
      rowCount: 1,
      revision: 1,
    });
    expect((await row(shipment.id)).status).toBe("EXPORTED");

    const again = await exportCsv(shipment.id);
    expect(again.status).toBe(200);
    expect(await again.text()).toBe(csv);
    expect(await prisma.exportEvent.count({ where: { shipmentId: shipment.id } })).toBe(2);
  });

  it("a material change after approval invalidates export", async () => {
    const shipment = await seedSubmitted();
    actAs(manager);
    expect((await decide(shipment.id, { decision: "APPROVE", expectedRevision: 1 })).status).toBe(200);

    // A document replacement bumps the revision and reopens review (same effect as upload-service).
    await prisma.shipment.update({ where: { id: shipment.id }, data: { currentRevision: 2, status: "IN_REVIEW" } });

    const response = await exportCsv(shipment.id);
    const body = (await response.json()) as { blockers: string[] };
    expect(response.status).toBe(422);
    expect(body.blockers).toEqual(expect.arrayContaining(["shipment_not_approved", "manager_approval_required", "cross_checks_not_run"]));
    expect(await prisma.exportEvent.count({ where: { shipmentId: shipment.id } })).toBe(0);
  });

  it("an approval racing a field edit never approves the edited revision", async () => {
    const shipment = await seedSubmitted();
    actAs(manager);
    const [decision] = await Promise.all([
      decide(shipment.id, { decision: "APPROVE", expectedRevision: 1 }),
      prisma.shipment.updateMany({
        where: { id: shipment.id, currentRevision: 1 },
        data: { currentRevision: { increment: 1 }, status: "NEEDS_REVIEW" },
      }),
    ]);
    const final = await row(shipment.id);
    if (decision.status === 200) {
      // Approval committed first; the edit then reopened review at revision 2.
      expect(final).toMatchObject({ currentRevision: 2, status: "NEEDS_REVIEW" });
    } else {
      expect(decision.status).toBe(409);
      expect(await prisma.approval.count({ where: { shipmentId: shipment.id } })).toBe(0);
    }
    expect(await prisma.approval.count({ where: { shipmentId: shipment.id, revision: 2 } })).toBe(0);
  });

  it("the accuracy report separates corrected values and uses shipments as the sample size", async () => {
    await seedSubmitted();
    actAs(executive);
    const report = (await (await reportRoute()).json()) as {
      summary: { evaluated: number; corrected: number; correctAsExtracted: number; shipmentsEvaluated: number; accuracy: { sampleSize: number } };
      dataset: { type: string };
      bySupplier: Array<{ groupKey: string }>;
    };
    expect(report.dataset.type).toBe("SYNTHETIC_DEMO");
    expect(report.summary.evaluated).toBeGreaterThan(0);
    expect(report.summary.corrected).toBeGreaterThanOrEqual(1); // INV-2481l -> INV-24811
    expect(report.summary.accuracy.sampleSize).toBe(report.summary.shipmentsEvaluated);
    expect(report.bySupplier.some((group) => group.groupKey === supplierId)).toBe(true);
  });

  it("the status list shows the Executive their submitted shipment as waiting, and the Manager as approve", async () => {
    const shipment = await seedSubmitted();
    const listAs = async (user: typeof executive | typeof manager) => {
      actAs(user);
      const json = (await (await listRoute(new Request(`http://localhost/api/shipments?search=${shipment.reference}`))).json()) as {
        shipments: Array<{ id: string; nextAction: { type: string }; riskScore: number; checksSummary: { total: number } }>;
      };
      return json.shipments.find((s) => s.id === shipment.id)!;
    };
    const asExecutive = await listAs(executive);
    const asManager = await listAs(manager);
    expect(asExecutive).toMatchObject({ nextAction: { type: "review" }, riskScore: 30 });
    expect(asManager).toMatchObject({ nextAction: { type: "approve" }, riskScore: 100 });
    expect(asManager.checksSummary.total).toBeGreaterThan(0);
  });
});
