import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as correctionRoute } from "@/app/api/fields/[id]/correction/route";
import { POST as reviewRoute } from "@/app/api/fields/[id]/review/route";
import { POST as resolveRoute } from "@/app/api/crosschecks/[id]/resolve/route";
import { GET as exportRoute } from "@/app/api/shipments/[id]/export/route";
import * as auth from "@/lib/auth";
import * as crosscheckService from "@/lib/crosschecks/service";
import { createCrossCheckRun, getLatestCrossCheckRun } from "@/lib/crosschecks/service";
import { processManagerDecision } from "@/lib/manager/decision";
import { evaluateShipmentSubmission } from "@/lib/submission/guard";

/**
 * Week 4 bug condition exploration tests (C4-C8, PostgreSQL-backed and concurrency).
 *
 * Written against the EXPECTED (fixed) behavior, so they are meant to FAIL on the unfixed code.
 * All records are synthetic, tagged with a unique reference prefix, and removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_INTEGRATION_TESTS === "1" && Boolean(connectionString);

type DocKey = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";

describe.skipIf(!enabled)("Week 4 cross-check and review bug exploration (PostgreSQL)", { timeout: 60_000 }, () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const executive = { id: randomUUID(), role: "EXECUTIVE" as const, email: `${randomUUID()}@example.test`, fullName: "Exec" };
  const manager = { id: randomUUID(), role: "MANAGER" as const, email: `${randomUUID()}@example.test`, fullName: "Mgr" };
  let counter = 0;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [executive, manager].map((u) => ({ id: u.id, email: u.email, role: u.role })),
    });
  });

  afterAll(async () => {
    try {
      await prisma.shipment.deleteMany({ where: { reference: { startsWith: `IT-W4-${tag}` } } });
      await prisma.user.deleteMany({ where: { id: { in: [executive.id, manager.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function actAs(user: typeof executive | typeof manager) {
    vi.spyOn(auth, "requireAppUser").mockResolvedValue({
      appUser: user as never,
      authUser: { id: user.id, email: user.email } as never,
    });
  }

  async function seedShipment(options: {
    status?: "DRAFT" | "NEEDS_REVIEW" | "EXTRACTING" | "READY_FOR_APPROVAL" | "APPROVED" | "EXPORTED";
    gross?: Partial<Record<DocKey, string>>;
  } = {}) {
    counter += 1;
    const gross = { INVOICE: "3120", PACKING_LIST: "3165", BILL_OF_LADING: "3165", ...options.gross };
    const shipment = await prisma.shipment.create({
      data: {
        reference: `IT-W4-${tag}-${counter}`,
        status: options.status ?? "NEEDS_REVIEW",
        createdById: executive.id,
      },
    });
    const fields: Record<DocKey, { id: string; remarksId: string }> = {} as never;
    const documents: Record<DocKey, { id: string; runId: string }> = {} as never;
    for (const docType of ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as DocKey[]) {
      const document = await prisma.document.create({
        data: {
          shipmentId: shipment.id,
          docType,
          selectedDocType: docType,
          storageKey: `it-w4/${tag}/${counter}/${docType}.pdf`,
          originalFileName: `${docType}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedById: executive.id,
          extractionStatus: "EXTRACTED",
        },
      });
      const run = await prisma.extractionRun.create({
        data: {
          documentId: document.id,
          provider: "test",
          model: "test",
          promptVersion: "test",
          status: "COMPLETED",
          pageCount: 1,
        },
      });
      const grossField = await prisma.extractedField.create({
        data: {
          documentId: document.id,
          extractionRunId: run.id,
          fieldKey: "grossWeight",
          modelValue: gross[docType],
          currentValue: gross[docType],
          unit: "kg",
          reviewStatus: "REQUIRES_REVIEW",
        },
      });
      const remarks = await prisma.extractedField.create({
        data: {
          documentId: document.id,
          extractionRunId: run.id,
          fieldKey: "remarks",
          modelValue: null,
          currentValue: null,
          reviewStatus: "REQUIRES_REVIEW",
        },
      });
      fields[docType] = { id: grossField.id, remarksId: remarks.id };
      documents[docType] = { id: document.id, runId: run.id };
    }
    return { shipment, fields, documents };
  }

  const jsonRequest = (url: string, body: unknown, method = "POST") =>
    new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const callCorrection = (fieldId: string, body: unknown) =>
    correctionRoute(jsonRequest(`http://localhost/api/fields/${fieldId}/correction`, body), {
      params: Promise.resolve({ id: fieldId }),
    });
  const callReview = (fieldId: string, body: unknown) =>
    reviewRoute(jsonRequest(`http://localhost/api/fields/${fieldId}/review`, body), {
      params: Promise.resolve({ id: fieldId }),
    });
  const callResolve = (checkId: string, body: unknown) =>
    resolveRoute(jsonRequest(`http://localhost/api/crosschecks/${checkId}/resolve`, body), {
      params: Promise.resolve({ id: checkId }),
    });

  const revisionOf = async (shipmentId: string) =>
    (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).currentRevision;

  async function bodyOf(response: Response) {
    return (await response.json()) as Record<string, unknown>;
  }

  describe("C1/C5 - SHP-24811 through the real createCrossCheckRun", () => {
    it("reports an exact 45 kg MISMATCH with 15.825 kg / 0.5% tolerance and an unknown cause; revision matches", async () => {
      const { shipment } = await seedShipment();
      const { run, results } = await createCrossCheckRun({ shipmentId: shipment.id, requestedById: executive.id, prismaClient: prisma });
      const gross = results.find((r) => r.ruleKey === "gross_weight_comparison");
      const details = gross?.details as Record<string, unknown>;

      expect(gross?.status).toBe("MISMATCH");
      expect(Number(details.differenceKg)).toBe(45);
      expect(Number(details.toleranceKg)).toBe(15.825);
      expect(Number(details.tolerancePercent)).toBe(0.5);
      expect(details.cause).toBe("unknown");
      expect(run.revision).toBe(shipment.currentRevision);
    });

    it("input hash is stable on rerun and changes after a field value changes (3165 -> 3156)", async () => {
      const { shipment, fields } = await seedShipment();
      const first = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
      const again = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
      await prisma.extractedField.update({ where: { id: fields.PACKING_LIST.id }, data: { currentValue: "3156" } });
      const changed = await createCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });

      expect(again.run.inputHash).toBe(first.run.inputHash);
      expect(changed.run.inputHash).not.toBe(first.run.inputHash);
    });
  });

  describe("C7 - Field confirm/correct", () => {
    it("two concurrent corrections with the same expectedRevision commit exactly one (other gets 409 STALE_REVISION)", async () => {
      const { shipment, fields } = await seedShipment();
      actAs(executive);

      const responses = await Promise.all([
        callCorrection(fields.PACKING_LIST.id, { value: "3200", reason: "first edit", expectedRevision: 1 }),
        callCorrection(fields.PACKING_LIST.id, { value: "3201", reason: "second edit", expectedRevision: 1 }),
      ]);
      const statuses = responses.map((r) => r.status).sort();
      const losers = await Promise.all(responses.filter((r) => r.status !== 200).map(bodyOf));

      expect(statuses).toEqual([200, 409]);
      expect(losers[0]?.code).toBe("STALE_REVISION");
      expect(await revisionOf(shipment.id)).toBe(2);
      expect(await prisma.fieldCorrection.count({ where: { fieldId: fields.PACKING_LIST.id } })).toBe(1);
    });

    it("a missing expectedRevision is rejected without changing the shipment", async () => {
      const { shipment, fields } = await seedShipment();
      actAs(executive);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3200", reason: "no revision supplied" });

      expect(response.status).toBe(400);
      expect(await revisionOf(shipment.id)).toBe(1);
      expect(await prisma.fieldCorrection.count({ where: { fieldId: fields.PACKING_LIST.id } })).toBe(0);
    });

    it.each(["EXTRACTING", "APPROVED", "EXPORTED"] as const)("blocks edits while the shipment is %s with 409 SHIPMENT_LOCKED", async (status) => {
      const { shipment, fields } = await seedShipment({ status });
      actAs(executive);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3200", reason: "should be blocked", expectedRevision: 1 });
      const body = await bodyOf(response);

      expect(response.status).toBe(409);
      expect(body.code).toBe("SHIPMENT_LOCKED");
      expect(await revisionOf(shipment.id)).toBe(1);
    });

    it("an edit on READY_FOR_APPROVAL reverts to NEEDS_REVIEW and audits approvalInvalidated + previousStatus", async () => {
      const { shipment, fields } = await seedShipment({ status: "READY_FOR_APPROVAL" });
      actAs(executive);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3200", reason: "post-submission fix", expectedRevision: 1 });
      const audit = await prisma.auditEvent.findFirst({ where: { shipmentId: shipment.id, action: "FIELD_CORRECTED" } });
      const metadata = (audit?.metadata ?? {}) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("NEEDS_REVIEW");
      expect(metadata.approvalInvalidated).toBe(true);
      expect(metadata.previousStatus).toBe("READY_FOR_APPROVAL");
    });

    it("a field from a superseded extraction run returns 409 FIELD_SUPERSEDED and leaves the revision alone", async () => {
      const { shipment, fields, documents } = await seedShipment();
      const newer = await prisma.extractionRun.create({
        data: {
          documentId: documents.PACKING_LIST.id,
          provider: "test",
          model: "test",
          promptVersion: "test",
          status: "COMPLETED",
          pageCount: 1,
          createdAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.extractedField.create({
        data: { documentId: documents.PACKING_LIST.id, extractionRunId: newer.id, fieldKey: "grossWeight", currentValue: "3165", unit: "kg" },
      });
      actAs(executive);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3200", reason: "edit old run", expectedRevision: 1 });
      const body = await bodyOf(response);

      expect(response.status).toBe(409);
      expect(body.code).toBe("FIELD_SUPERSEDED");
      expect(await revisionOf(shipment.id)).toBe(1);
    });

    it("CONFIRM on an empty value is rejected (422 EMPTY_CONFIRM_VALUE) without bumping the revision", async () => {
      const { shipment, fields } = await seedShipment();
      actAs(executive);

      const response = await callReview(fields.PACKING_LIST.remarksId, { status: "CONFIRMED", expectedRevision: 1 });
      const body = await bodyOf(response);

      expect(response.status).toBe(422);
      expect(body.code).toBe("EMPTY_CONFIRM_VALUE");
      expect(await revisionOf(shipment.id)).toBe(1);
    });

    it("a correction equal to the current value is rejected (422 NO_CHANGE) without bumping the revision", async () => {
      const { shipment, fields } = await seedShipment();
      actAs(executive);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3165", reason: "same value again", expectedRevision: 1 });
      const body = await bodyOf(response);

      expect(response.status).toBe(422);
      expect(body.code).toBe("NO_CHANGE");
      expect(await revisionOf(shipment.id)).toBe(1);
    });

    it("an invalid weight value is rejected by the manual-entry rules (no commit)", async () => {
      const { shipment, fields } = await seedShipment();
      actAs(executive);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3,120.00.00", reason: "malformed on purpose", expectedRevision: 1 });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await revisionOf(shipment.id)).toBe(1);
      expect((await prisma.extractedField.findUniqueOrThrow({ where: { id: fields.PACKING_LIST.id } })).currentValue).toBe("3165");
    });

    it("a recompute failure returns crossChecksStale: true and logs only a safe code", async () => {
      const { shipment, fields } = await seedShipment();
      actAs(executive);
      vi.spyOn(crosscheckService, "createCrossCheckRun").mockRejectedValue(new Error("secret value 3200 leaked"));
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await callCorrection(fields.PACKING_LIST.id, { value: "3200", reason: "recompute will fail", expectedRevision: 1 });
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(body.crossChecksStale).toBe(true);
      expect(await revisionOf(shipment.id)).toBe(2);
      for (const call of errorLog.mock.calls) {
        for (const arg of call) {
          expect(typeof arg).toBe("string");
          expect(String(arg)).not.toContain("secret");
        }
      }
    });
  });

  describe("C8 - Failed-check resolution", () => {
    async function seedFailingCheck(severity: "BLOCKING" | "WARNING" = "BLOCKING", ruleKey = "gross_weight_comparison") {
      const seeded = await seedShipment();
      const run = await prisma.crossCheckRun.create({
        data: { shipmentId: seeded.shipment.id, revision: 1, inputHash: randomUUID(), inputSnapshot: {}, triggeredBy: "TEST" },
      });
      const check = await prisma.crossCheckResult.create({
        data: {
          shipmentId: seeded.shipment.id,
          runId: run.id,
          revision: 1,
          ruleKey,
          ruleCode: ruleKey.toUpperCase(),
          severity,
          status: "MISMATCH",
          details: { differenceKg: "45", cause: "unknown" },
        },
      });
      return { ...seeded, run, check };
    }

    it("a reason-only SOURCE_CORRECTED returns 409 RESOLUTION_LINK_INVALID and does not clear the check", async () => {
      const { check } = await seedFailingCheck();
      actAs(executive);

      const response = await callResolve(check.id, { type: "SOURCE_CORRECTED", reason: "fixed", valuesConfirmed: true, expectedRevision: 1 });
      const body = await bodyOf(response);

      expect(response.status).toBe(409);
      expect(body.code).toBe("RESOLUTION_LINK_INVALID");
      expect(await prisma.crossCheckResolution.count({ where: { crossCheckId: check.id } })).toBe(0);
    });

    it("an ACCEPTED_EXCEPTION without evidence is rejected", async () => {
      const { check } = await seedFailingCheck();
      actAs(executive);

      const response = await callResolve(check.id, { type: "ACCEPTED_EXCEPTION", reason: "supplier agreed", valuesConfirmed: true, expectedRevision: 1 });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.crossCheckResolution.count({ where: { crossCheckId: check.id } })).toBe(0);
    });

    it("a missing expectedRevision is rejected", async () => {
      const { check } = await seedFailingCheck();
      actAs(executive);

      const response = await callResolve(check.id, { type: "ACCEPTED_EXCEPTION", reason: "supplier agreed", evidence: "TKT-8492", valuesConfirmed: true });

      expect(response.status).toBe(400);
      expect(await prisma.crossCheckResolution.count({ where: { crossCheckId: check.id } })).toBe(0);
    });

    it("a missing valuesConfirmed is rejected", async () => {
      const { check } = await seedFailingCheck();
      actAs(executive);

      const response = await callResolve(check.id, { type: "ACCEPTED_EXCEPTION", reason: "supplier agreed", evidence: "TKT-8492", expectedRevision: 1 });

      expect(response.status).toBe(400);
      expect(await prisma.crossCheckResolution.count({ where: { crossCheckId: check.id } })).toBe(0);
    });

    it("the resolve route logs no raw error object when it fails", async () => {
      const { check } = await seedFailingCheck();
      actAs(executive);
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(crosscheckService, "getLatestCrossCheckRun").mockRejectedValue(new Error("secret detail"));

      await callResolve(check.id, {
        type: "ACCEPTED_EXCEPTION",
        reason: "supplier agreed",
        evidence: "TKT-8492",
        valuesConfirmed: true,
        expectedRevision: 1,
      });

      for (const call of errorLog.mock.calls) {
        expect(call.some((arg) => arg instanceof Error)).toBe(false);
      }
    });

    type Scenario = {
      name: string;
      resolution: null | { type: "SOURCE_CORRECTED" | "ACCEPTED_EXCEPTION"; evidence: string | null; approved: boolean };
      expected: { submissionBlocks: boolean; approvalBlocks: boolean; exportBlocks: boolean; clearedForSubmission: boolean; clearedForApproval: boolean };
    };
    const scenarios: Scenario[] = [
      {
        name: "reason-only SOURCE_CORRECTED",
        resolution: { type: "SOURCE_CORRECTED", evidence: null, approved: false },
        expected: { submissionBlocks: true, approvalBlocks: true, exportBlocks: true, clearedForSubmission: false, clearedForApproval: false },
      },
      {
        name: "valid ACCEPTED_EXCEPTION, not manager-approved",
        resolution: { type: "ACCEPTED_EXCEPTION", evidence: "TKT-8492", approved: false },
        expected: { submissionBlocks: false, approvalBlocks: false, exportBlocks: true, clearedForSubmission: true, clearedForApproval: false },
      },
      {
        name: "valid ACCEPTED_EXCEPTION, manager-approved",
        resolution: { type: "ACCEPTED_EXCEPTION", evidence: "TKT-8492", approved: true },
        expected: { submissionBlocks: false, approvalBlocks: false, exportBlocks: false, clearedForSubmission: true, clearedForApproval: true },
      },
    ];

    it.each(scenarios)("all five consumers agree for: $name", async ({ resolution, expected }) => {
      const { shipment, check } = await seedFailingCheck();
      if (resolution) {
        await prisma.crossCheckResolution.create({
          data: {
            crossCheckId: check.id,
            type: resolution.type,
            reason: "reviewed with supplier",
            evidence: resolution.evidence,
            resolvedById: executive.id,
            managerApprovedAt: resolution.approved ? new Date() : null,
          },
        });
      }

      const submission = await evaluateShipmentSubmission(shipment.id, "EXECUTIVE");
      const submissionBlocks = submission.blockers.some((b) => b.checkRuleKey === check.ruleKey);

      actAs(manager);
      const exportResponse = await exportRoute(new Request(`http://localhost/api/shipments/${shipment.id}/export?preview=1`), {
        params: Promise.resolve({ id: shipment.id }),
      });
      const exportBody = await bodyOf(exportResponse);
      const exportReasons = (exportBody.blockers as string[] | undefined) ?? [];
      const exportBlocks = exportReasons.includes("cross_checks_unresolved") || exportReasons.includes("unapproved_exceptions_present");

      const latest = await getLatestCrossCheckRun({ shipmentId: shipment.id, prismaClient: prisma });
      const latestResult = latest?.results[0] as unknown as { clearedForSubmission?: boolean; clearedForApproval?: boolean } | undefined;

      // Week 5: a manager decides only on a submitted shipment.
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "READY_FOR_APPROVAL" } });
      let approvalBlocks = false;
      try {
        await processManagerDecision({
          shipmentId: shipment.id,
          managerUser: manager,
          decision: "APPROVE",
          comment: "approved with documented exception",
          expectedRevision: 1,
        });
      } catch (error) {
        if (!/unresolved cross-checks/i.test((error as Error).message)) throw error;
        approvalBlocks = true;
      }

      expect({
        submissionBlocks,
        approvalBlocks,
        exportBlocks,
        clearedForSubmission: latestResult?.clearedForSubmission,
        clearedForApproval: latestResult?.clearedForApproval,
      }).toEqual(expected);
    });

    it("a failing WARNING exporter_consistency check never blocks submission, approval or export", async () => {
      const { shipment, check } = await seedFailingCheck("WARNING", "exporter_consistency");

      const submission = await evaluateShipmentSubmission(shipment.id, "EXECUTIVE");
      actAs(manager);
      const exportResponse = await exportRoute(new Request(`http://localhost/api/shipments/${shipment.id}/export?preview=1`), {
        params: Promise.resolve({ id: shipment.id }),
      });
      const exportReasons = ((await bodyOf(exportResponse)).blockers as string[] | undefined) ?? [];
      // Week 5: a manager decides only on a submitted shipment.
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "READY_FOR_APPROVAL" } });
      const decision = await processManagerDecision({
        shipmentId: shipment.id,
        managerUser: manager,
        decision: "APPROVE",
        comment: "warning only",
        expectedRevision: 1,
      }).then(
        () => "approved",
        (error: Error) => error.message,
      );

      expect(submission.blockers.some((b) => b.checkRuleKey === check.ruleKey)).toBe(false);
      expect(exportReasons).not.toContain("cross_checks_unresolved");
      expect(decision).toBe("approved");
    });
  });
});
