import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLineMapping, removeLineMapping } from "@/lib/crosschecks/line-mapping";
import { createCrossCheckRun, getCrossCheckHistory, getLatestCrossCheckRun } from "@/lib/crosschecks/service";
import { ReviewError } from "@/lib/errors";

/**
 * Week 4 Step 4/5 against PostgreSQL: line mappings, DB constraints, run history.
 * Synthetic records only, tagged with a unique reference prefix and removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

describe.skipIf(!enabled)("Week 4 line mappings, constraints and history (PostgreSQL)", { timeout: 60_000 }, () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const executive = { id: randomUUID(), role: "EXECUTIVE" as const, email: `${randomUUID()}@example.test` };
  const other = { id: randomUUID(), role: "EXECUTIVE" as const, email: `${randomUUID()}@example.test` };
  let counter = 0;

  beforeAll(async () => {
    await prisma.user.createMany({ data: [executive, other].map((u) => ({ id: u.id, email: u.email, role: u.role })) });
  });

  afterAll(async () => {
    try {
      await prisma.shipment.deleteMany({ where: { reference: { startsWith: `IT-W4M-${tag}` } } });
      await prisma.user.deleteMany({ where: { id: { in: [executive.id, other.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function seed(status: "NEEDS_REVIEW" | "APPROVED" = "NEEDS_REVIEW") {
    counter += 1;
    const shipment = await prisma.shipment.create({
      data: { reference: `IT-W4M-${tag}-${counter}`, status, createdById: executive.id },
    });
    const lines: Record<string, string> = {};
    const runs: Record<string, string> = {};
    const docs: Record<string, string> = {};
    for (const docType of ["INVOICE", "PACKING_LIST"] as const) {
      const document = await prisma.document.create({
        data: {
          shipmentId: shipment.id,
          docType,
          selectedDocType: docType,
          storageKey: `it-w4m/${tag}/${counter}/${docType}.pdf`,
          originalFileName: `${docType}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedById: executive.id,
          extractionStatus: "EXTRACTED",
        },
      });
      const run = await prisma.extractionRun.create({
        data: { documentId: document.id, provider: "test", model: "test", promptVersion: "test", status: "COMPLETED", pageCount: 1 },
      });
      docs[docType] = document.id;
      runs[docType] = run.id;
      const prefix = docType === "INVOICE" ? "inv" : "pl";
      const items =
        docType === "INVOICE"
          ? [
              { lineNumber: 1, description: "Steel bolts M8", quantity: "10" },
              { lineNumber: 2, description: "Steel bolts M8", quantity: "20" },
              { lineNumber: 3, description: "Ocean freight", quantity: "1" },
            ]
          : [
              { lineNumber: 1, description: "Steel bolts M8", quantity: "10" },
              { lineNumber: 2, description: "Steel bolts M8", quantity: "20" },
            ];
      for (const item of items) {
        const row = await prisma.lineItem.create({
          data: {
            documentId: document.id,
            extractionRunId: run.id,
            lineNumber: item.lineNumber,
            description: item.description,
            quantity: item.quantity,
            quantityUnit: "pcs",
          },
        });
        lines[`${prefix}${item.lineNumber}`] = row.id;
      }
    }
    return { shipment, lines, runs, docs };
  }

  const actor = { id: executive.id, role: "EXECUTIVE" as const };
  const lineCheck = (results: Array<{ ruleKey: string; status: string; details: unknown }>) =>
    results.find((r) => r.ruleKey === "invoice_quantity_vs_packing_list")!;
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return "OK";
    } catch (error) {
      return error instanceof ReviewError ? error.code : String((error as { code?: string }).code ?? (error as Error).message);
    }
  };

  it("duplicate lines are INCOMPLETE until mapped; mapping bumps the revision, audits and re-runs checks with actor evidence", async () => {
    const { shipment, lines } = await seed();
    const before = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
    expect(lineCheck(before.results).status).toBe("INCOMPLETE");
    // The freight line is excluded from goods matching.
    expect((lineCheck(before.results).details as { totalInvoiceLines: number }).totalInvoiceLines).toBe(2);

    await createLineMapping(prisma, {
      shipmentId: shipment.id,
      actor,
      body: { invoiceLineId: lines.inv1, packingListLineId: lines.pl1, reason: "Same lot number", expectedRevision: 1 },
    });
    const second = await createLineMapping(prisma, {
      shipmentId: shipment.id,
      actor,
      body: { invoiceLineId: lines.inv2, packingListLineId: lines.pl2, reason: "Same lot number", expectedRevision: 2 },
    });

    expect(second.revision).toBe(3);
    const check = lineCheck(second.crossChecks);
    const details = check.details as { matchedPairs: Array<{ mappingMethod: string; manualEvidence?: { mappedBy?: string; mappedAt?: string } }> };
    expect(check.status).toBe("PASS");
    expect(details.matchedPairs.every((p) => p.mappingMethod === "MANUAL" && p.manualEvidence?.mappedBy === executive.id && p.manualEvidence?.mappedAt)).toBe(true);
    expect(await prisma.auditEvent.count({ where: { shipmentId: shipment.id, action: "LINE_MAPPING_CREATED" } })).toBe(2);
    expect((await prisma.crossCheckRun.findFirst({ where: { shipmentId: shipment.id }, orderBy: { createdAt: "desc" } }))?.triggeredBy).toBe("LINE_MAPPING");
  });

  it("rejects conflicts, stale revisions, charge lines, foreign shipments and locked shipments", async () => {
    const { shipment, lines } = await seed();
    await createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv1, packingListLineId: lines.pl1, reason: "Same lot number", expectedRevision: 1 } });

    expect(await codeOf(createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv1, packingListLineId: lines.pl2, reason: "Different line", expectedRevision: 2 } }))).toBe("MAPPING_CONFLICT");
    expect(await codeOf(createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv2, packingListLineId: lines.pl2, reason: "Stale request", expectedRevision: 1 } }))).toBe("STALE_REVISION");
    expect(await codeOf(createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv3, packingListLineId: lines.pl2, reason: "Freight line", expectedRevision: 2 } }))).toBe("MAPPING_LINE_INVALID");
    expect(await codeOf(createLineMapping(prisma, { shipmentId: shipment.id, actor: { id: other.id, role: "EXECUTIVE" }, body: { invoiceLineId: lines.inv2, packingListLineId: lines.pl2, reason: "Not my shipment", expectedRevision: 2 } }))).toBe("SHIPMENT_NOT_FOUND");

    const approved = await seed("APPROVED");
    expect(await codeOf(createLineMapping(prisma, { shipmentId: approved.shipment.id, actor, body: { invoiceLineId: approved.lines.inv1, packingListLineId: approved.lines.pl1, reason: "Locked shipment", expectedRevision: 1 } }))).toBe("SHIPMENT_LOCKED");

    // Failed attempts leave the revision untouched.
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).currentRevision).toBe(2);
  });

  it("replace supersedes the old mapping; removal supersedes (never deletes) and re-runs checks", async () => {
    const { shipment, lines } = await seed();
    const first = await createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv1, packingListLineId: lines.pl1, reason: "First choice", expectedRevision: 1 } });
    const replaced = await createLineMapping(prisma, {
      shipmentId: shipment.id,
      actor,
      body: { invoiceLineId: lines.inv1, packingListLineId: lines.pl2, reason: "Corrected choice", expectedRevision: 2, replace: true },
    });
    expect(replaced.supersededMappingIds).toEqual([first.mapping.id]);
    expect((await prisma.lineItemMapping.findUniqueOrThrow({ where: { id: first.mapping.id } })).supersededById).toBe(executive.id);

    const removed = await removeLineMapping(prisma, { shipmentId: shipment.id, mappingId: replaced.mapping.id, actor, body: { expectedRevision: 3 } });
    expect(removed.revision).toBe(4);
    expect(await prisma.lineItemMapping.count({ where: { shipmentId: shipment.id } })).toBe(2);
    expect(await prisma.lineItemMapping.count({ where: { shipmentId: shipment.id, supersededAt: null } })).toBe(0);
    expect(await codeOf(removeLineMapping(prisma, { shipmentId: shipment.id, mappingId: replaced.mapping.id, actor, body: { expectedRevision: 4 } }))).toBe("MAPPING_NOT_FOUND");
  });

  it("a mapping to a line from an older extraction is rejected, and a mapping made stale by re-extraction is reported", async () => {
    const { shipment, lines, docs } = await seed();
    await createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv1, packingListLineId: lines.pl1, reason: "Same lot number", expectedRevision: 1 } });

    // Re-extraction of the packing list: a newer completed run with fresh line items.
    const newer = await prisma.extractionRun.create({
      data: { documentId: docs.PACKING_LIST, provider: "test", model: "test", promptVersion: "test", status: "COMPLETED", pageCount: 1, createdAt: new Date(Date.now() + 60_000) },
    });
    await prisma.lineItem.create({ data: { documentId: docs.PACKING_LIST, extractionRunId: newer.id, lineNumber: 1, description: "Steel bolts M8", quantity: "30", quantityUnit: "pcs" } });

    expect(await codeOf(createLineMapping(prisma, { shipmentId: shipment.id, actor, body: { invoiceLineId: lines.inv2, packingListLineId: lines.pl2, reason: "Old extraction line", expectedRevision: 2 } }))).toBe("MAPPING_LINE_INVALID");

    const run = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
    const stale = (lineCheck(run.results).details as { staleManualMappings: Array<{ reason: string }> }).staleManualMappings;
    expect(stale).toEqual([expect.objectContaining({ reason: "LINE_NOT_IN_CURRENT_EXTRACTION" })]);
  });

  it("the database enforces one active mapping per line and the CHECK constraints", async () => {
    const { shipment, lines } = await seed();
    await prisma.lineItemMapping.create({
      data: { shipmentId: shipment.id, invoiceLineItemId: lines.inv1, packingListLineItemId: lines.pl1, reason: "direct", revision: 1, createdById: executive.id },
    });
    expect(await codeOf(prisma.lineItemMapping.create({
      data: { shipmentId: shipment.id, invoiceLineItemId: lines.inv1, packingListLineItemId: lines.pl2, reason: "dup", revision: 1, createdById: executive.id },
    }))).toBe("P2002");
    expect(await codeOf(prisma.lineItemMapping.create({
      data: { shipmentId: shipment.id, invoiceLineItemId: lines.inv2, packingListLineItemId: lines.pl1, reason: "dup", revision: 1, createdById: executive.id },
    }))).toBe("P2002");
    expect(await codeOf(prisma.lineItemMapping.create({
      data: { shipmentId: shipment.id, invoiceLineItemId: lines.inv2, packingListLineItemId: lines.inv2, reason: "same", revision: 1, createdById: executive.id },
    }))).not.toBe("OK");
    expect(await codeOf(prisma.lineItemMapping.create({
      data: { shipmentId: shipment.id, invoiceLineItemId: lines.inv2, packingListLineItemId: lines.pl2, reason: "half", revision: 1, createdById: executive.id, supersededAt: new Date() },
    }))).not.toBe("OK");

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'LineItemMapping' AND indexname LIKE 'LineItemMapping_one_active_%'`;
    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      "LineItemMapping_one_active_per_invoice_line",
      "LineItemMapping_one_active_per_packing_line",
    ]);
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conname IN ('LineItemMapping_distinct_lines', 'LineItemMapping_superseded_pair')`;
    expect(constraints).toHaveLength(2);
  });

  it("run history accumulates immutably with deterministic ordering", async () => {
    const { shipment } = await seed();
    const first = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
    await new Promise((resolve) => setTimeout(resolve, 10)); // distinct createdAt (ms precision)
    const second = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });

    expect(second.run.id).not.toBe(first.run.id);
    expect(second.run.inputHash).toBe(first.run.inputHash); // same inputs, new row
    const history = await getCrossCheckHistory({ shipmentId: shipment.id, prismaClient: prisma });
    expect(history.map((run) => run.id)).toEqual([second.run.id, first.run.id]);
    expect(history[1].results).toHaveLength(first.results.length);
    const latest = await getLatestCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
    expect(latest?.id).toBe(second.run.id);
    const snapshot = second.run.inputSnapshot as { schemaVersion: number; tolerances: Record<string, string> };
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.tolerances.weightPercent).toBe("0.5");
  });
});
