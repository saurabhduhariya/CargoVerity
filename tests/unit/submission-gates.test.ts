import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  evaluateSubmissionGuard,
  SubmissionGuardInput,
  SubmissionGuardDocument,
} from "@/lib/submission/guard";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { POST, GET } from "@/app/api/shipments/[id]/submit/route";

function createValidSubmissionDocument(
  docType: "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING",
): SubmissionGuardDocument {
  const commonFields = [
    {
      id: `${docType}-exporter`,
      fieldKey: "exporter",
      currentValue: "Global Logistics Exports Ltd",
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
    {
      id: `${docType}-importer`,
      fieldKey: "importer",
      currentValue: "CargoVerity Imports Inc",
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
    {
      id: `${docType}-docNum`,
      fieldKey: "documentNumber",
      currentValue: `${docType}-1001`,
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
    {
      id: `${docType}-issueDate`,
      fieldKey: "issueDate",
      currentValue: "2026-11-01",
      modelConfidence: 0.95,
      reviewStatus: "CONFIRMED" as const,
      pageNumber: 1,
    },
  ];

  if (docType === "INVOICE") {
    return {
      id: "doc-invoice",
      docType: "INVOICE",
      isCurrent: true,
      documentVersion: 1,
      extractionStatus: "EXTRACTED",
      pages: [{ pageNumber: 1, isReadable: true, manualEntryRequired: false }],
      fields: [
        ...commonFields,
        {
          id: "inv-curr",
          fieldKey: "currency",
          currentValue: "USD",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
        {
          id: "inv-total",
          fieldKey: "invoiceTotal",
          currentValue: "52400.00",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
      ],
    };
  }

  if (docType === "PACKING_LIST") {
    return {
      id: "doc-packing-list",
      docType: "PACKING_LIST",
      isCurrent: true,
      documentVersion: 1,
      extractionStatus: "EXTRACTED",
      pages: [{ pageNumber: 1, isReadable: true, manualEntryRequired: false }],
      fields: [
        ...commonFields,
        {
          id: "pl-pkg",
          fieldKey: "packageCount",
          currentValue: "120",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
        {
          id: "pl-gross",
          fieldKey: "grossWeight",
          currentValue: "3165",
          modelConfidence: 0.95,
          reviewStatus: "CONFIRMED" as const,
          pageNumber: 1,
        },
      ],
    };
  }

  return {
    id: "doc-bill-of-lading",
    docType: "BILL_OF_LADING",
    isCurrent: true,
    documentVersion: 1,
    extractionStatus: "EXTRACTED",
    pages: [{ pageNumber: 1, isReadable: true, manualEntryRequired: false }],
    fields: [
      ...commonFields,
      {
        id: "bl-pkg",
        fieldKey: "packageCount",
        currentValue: "120",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
      {
        id: "bl-gross",
        fieldKey: "grossWeight",
        currentValue: "3165",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
      {
        id: "bl-pol",
        fieldKey: "portOfLoading",
        currentValue: "INBOM",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
      {
        id: "bl-pod",
        fieldKey: "portOfDischarge",
        currentValue: "USLAX",
        modelConfidence: 0.95,
        reviewStatus: "CONFIRMED" as const,
        pageNumber: 1,
      },
    ],
  };
}

function createValidSubmissionInput(): SubmissionGuardInput {
  return {
    shipmentId: "shipment-uuid-001",
    currentRevision: 1,
    shipmentStatus: "NEEDS_REVIEW",
    userRole: "EXECUTIVE",
    documents: [
      createValidSubmissionDocument("INVOICE"),
      createValidSubmissionDocument("PACKING_LIST"),
      createValidSubmissionDocument("BILL_OF_LADING"),
    ],
    latestCheckRun: {
      id: "run-uuid-001",
      revision: 1,
      results: [
        {
          id: "check-1",
          ruleKey: "invoice-arithmetic",
          status: "PASS",
          severity: "BLOCKING",
          resolutions: [],
        },
        {
          id: "check-2",
          ruleKey: "weight-gross",
          status: "PASS",
          severity: "BLOCKING",
          resolutions: [],
        },
      ],
    },
    lowConfidenceThreshold: 0.85,
  };
}

describe("Submission Gates & Validation (Week 5 Step 1)", () => {
  describe("Pure Guard: evaluateSubmissionGuard", () => {
    it("passes when all documents, fields, and cross-checks satisfy submission rules", () => {
      const input = createValidSubmissionInput();
      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.reasons).toHaveLength(0);
      expect(result.blockingReasons).toHaveLength(0);
    });

    it("blocks submission when a required document is missing (Rule 2)", () => {
      const input = createValidSubmissionInput();
      // Remove Packing List
      input.documents = input.documents.filter((d) => d.docType !== "PACKING_LIST");

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("MISSING_REQUIRED_DOCUMENT");
      expect(result.blockingReasons[0]).toMatch(/missing required document: packing list/i);
    });

    it("blocks submission when document has an unresolved type mismatch (Rule 2)", () => {
      const input = createValidSubmissionInput();
      input.documents[0].typeMismatch = true;

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("DOCUMENT_TYPE_MISMATCH");
    });

    it("blocks submission when document extraction failed with no manual fallback (Rule 2)", () => {
      const input = createValidSubmissionInput();
      input.documents[0].extractionStatus = "FAILED";
      input.documents[0].fields = [];

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("DOCUMENT_EXTRACTION_FAILED");
    });

    it("blocks submission when a required field is missing or empty (Rule 3)", () => {
      const input = createValidSubmissionInput();
      const invDoc = input.documents.find((d) => d.docType === "INVOICE")!;
      const totalField = invDoc.fields.find((f) => f.fieldKey === "invoiceTotal")!;
      totalField.currentValue = null;

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("REQUIRED_FIELD_MISSING");
      expect(result.blockingReasons.some((r) => r.includes("invoiceTotal"))).toBe(true);
    });

    it("blocks submission when a required field is present but unconfirmed (Rule 3)", () => {
      const input = createValidSubmissionInput();
      const invDoc = input.documents.find((d) => d.docType === "INVOICE")!;
      const totalField = invDoc.fields.find((f) => f.fieldKey === "invoiceTotal")!;
      totalField.reviewStatus = "REQUIRES_REVIEW";

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("REQUIRED_FIELD_UNCONFIRMED");
      expect(result.blockingReasons.some((r) => r.includes("must be confirmed"))).toBe(true);
    });

    it("blocks submission when a low-confidence field is unconfirmed (Rule 4)", () => {
      const input = createValidSubmissionInput();
      const invDoc = input.documents.find((d) => d.docType === "INVOICE")!;
      // Add optional field with low confidence
      invDoc.fields.push({
        id: "inv-opt-incoterm",
        fieldKey: "incoterm",
        currentValue: "FOB",
        modelConfidence: 0.62,
        reviewStatus: "REQUIRES_REVIEW",
        reviewReason: "LOW_CONFIDENCE",
        pageNumber: 1,
      });

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("LOW_CONFIDENCE_FIELD_UNCONFIRMED");
      expect(result.blockingReasons.some((r) => r.includes("low confidence (62%)"))).toBe(true);
    });

    it("blocks submission when unreadable-page manual fields are unconfirmed (Rule 5)", () => {
      const input = createValidSubmissionInput();
      const invDoc = input.documents.find((d) => d.docType === "INVOICE")!;
      invDoc.pages[0].isReadable = false;
      invDoc.pages[0].manualEntryRequired = true;
      // All fields unconfirmed
      invDoc.fields.forEach((f) => {
        f.reviewStatus = "REQUIRES_REVIEW";
      });

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("UNREADABLE_PAGE_FIELD_UNCONFIRMED");
    });

    it("blocks submission when a cross-check failed with no resolution (Rule 6)", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push({
        id: "check-mismatch",
        ruleKey: "package-count-comparison",
        status: "MISMATCH",
        severity: "BLOCKING",
        resolutions: [],
      });

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("UNRESOLVED_CROSS_CHECK");
      expect(result.blockingReasons.some((r) => r.includes("package-count-comparison"))).toBe(true);
    });

    it("blocks submission when accepted exception lacks external evidence (Rule 7)", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push({
        id: "check-exception",
        ruleKey: "package-count-comparison",
        status: "MISMATCH",
        severity: "BLOCKING",
        resolutions: [
          {
            id: "res-1",
            type: "ACCEPTED_EXCEPTION",
            reason: "Tolerance variance approved by client",
            evidence: null, // missing evidence!
            managerApprovedAt: null,
          },
        ],
      });

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("ACCEPTED_EXCEPTION_MISSING_EVIDENCE");
    });

    it("permits submission when accepted exception has valid evidence and is pending manager approval (Rule 7)", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push({
        id: "check-exception-valid",
        ruleKey: "weight-gross",
        status: "MISMATCH",
        severity: "BLOCKING",
        resolutions: [
          {
            id: "res-valid",
            type: "ACCEPTED_EXCEPTION",
            reason: "Pallet weight delta approved per vendor packing spec",
            evidence: "TICKET-78921 / email ref 2026-11-04",
            managerApprovedAt: null, // pending manager approval
          },
        ],
      });

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("blocks submission when cross-check run is missing or stale (Rule 8)", () => {
      const input = createValidSubmissionInput();
      input.currentRevision = 3;
      input.latestCheckRun!.revision = 2; // stale run!

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("STALE_CHECK_RUN");
      expect(result.blockingReasons[0]).toMatch(/cross-checks are stale/i);

      // Missing check run entirely
      input.latestCheckRun = null;
      const resultNoRun = evaluateSubmissionGuard(input);
      expect(resultNoRun.allowed).toBe(false);
      expect(resultNoRun.reasons).toContain("MISSING_CHECK_RUN");
    });

    it("blocks submission when submitted by a non-Executive role (Rule 9)", () => {
      const input = createValidSubmissionInput();
      input.userRole = "MANAGER";

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("UNAUTHORIZED_ROLE");
      expect(result.blockingReasons[0]).toMatch(/only documentation executives can submit/i);
    });

    it("blocks submission if shipment is already approved or exported", () => {
      const input = createValidSubmissionInput();
      input.shipmentStatus = "APPROVED";

      const result = evaluateSubmissionGuard(input);

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("INVALID_SHIPMENT_STATUS");
    });
  });

  describe("Week 5 Step 1 fixes (pure guard)", () => {
    it.each(["READY_FOR_APPROVAL", "EXTRACTING", "EXPORTED"] as const)("blocks submission while the shipment is %s", (status) => {
      const input = createValidSubmissionInput();
      input.shipmentStatus = status;
      const result = evaluateSubmissionGuard(input);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toEqual(["INVALID_SHIPMENT_STATUS"]);
    });

    it.each(["DRAFT", "IN_REVIEW", "NEEDS_REVIEW"] as const)("allows submission from %s", (status) => {
      const input = createValidSubmissionInput();
      input.shipmentStatus = status;
      expect(evaluateSubmissionGuard(input).allowed).toBe(true);
    });

    it("reports a never-extracted document once instead of one blocker per missing field", () => {
      const input = createValidSubmissionInput();
      input.documents[0].extractionStatus = "UPLOADED";
      input.documents[0].fields = [];
      const result = evaluateSubmissionGuard(input);
      expect(result.reasons).toEqual(["DOCUMENT_NOT_EXTRACTED"]);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ documentType: "INVOICE" });
    });

    it("an approved manual fallback (failed extraction + confirmed manual values) can be submitted", () => {
      const input = createValidSubmissionInput();
      input.documents[0].extractionStatus = "FAILED";
      input.documents[0].fields = input.documents[0].fields.map((f) => ({ ...f, reviewStatus: "MANUAL_ENTRY" as const, modelConfidence: null }));
      expect(evaluateSubmissionGuard(input).allowed).toBe(true);
    });

    it("a page marked for manual entry with no entered values blocks with an exact reason", () => {
      const input = createValidSubmissionInput();
      input.documents[0].pages.push({ pageNumber: 2, isReadable: false, manualEntryRequired: true });
      const result = evaluateSubmissionGuard(input);
      expect(result.reasons).toEqual(["UNREADABLE_PAGE_FIELD_UNCONFIRMED"]);
      expect(result.blockers[0]).toMatchObject({ pageNumber: 2 });
      expect(result.blockingReasons[0]).toMatch(/page 2 .* no manually entered values/i);
    });

    it("confirmed manual values on a marked page clear it; a blank page only the AI flagged does not deadlock", () => {
      const input = createValidSubmissionInput();
      const invoice = input.documents[0];
      invoice.pages.push({ pageNumber: 2, isReadable: false, manualEntryRequired: true });
      invoice.pages.push({ pageNumber: 3, isReadable: false, manualEntryRequired: false });
      invoice.fields.push({ id: "inv-incoterm", fieldKey: "incoterm", currentValue: "FOB", modelConfidence: null, reviewStatus: "MANUAL_ENTRY", pageNumber: 2 });
      expect(evaluateSubmissionGuard(input).allowed).toBe(true);

      invoice.fields.push({ id: "inv-p3", fieldKey: "netWeight", currentValue: "3000", modelConfidence: 0.9, reviewStatus: "REQUIRES_REVIEW", pageNumber: 3 });
      const result = evaluateSubmissionGuard(input);
      expect(result.reasons).toContain("UNREADABLE_PAGE_FIELD_UNCONFIRMED");
      expect(result.blockingReasons.some((r) => r.includes("netWeight"))).toBe(true);
    });

    it("a reason-only SOURCE_CORRECTED does not clear a current failure", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push({
        id: "c-src",
        ruleKey: "gross_weight_comparison",
        status: "MISMATCH",
        severity: "BLOCKING",
        resolutions: [{ id: "r", type: "SOURCE_CORRECTED", reason: "Fixed weight typo", evidence: null, managerApprovedAt: null }],
      });
      expect(evaluateSubmissionGuard(input).reasons).toEqual(["UNRESOLVED_CROSS_CHECK"]);
    });

    it("a failing WARNING check does not block submission", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push({ id: "c-w", ruleKey: "exporter_consistency", status: "MISMATCH", severity: "WARNING", resolutions: [] });
      expect(evaluateSubmissionGuard(input).allowed).toBe(true);
    });

    it("lists accepted exceptions that are explicitly pending manager approval (Rule 7)", () => {
      const input = createValidSubmissionInput();
      input.latestCheckRun!.results.push(
        {
          id: "c-pending",
          ruleKey: "gross_weight_comparison",
          status: "MISMATCH",
          severity: "BLOCKING",
          resolutions: [{ id: "r-pending", type: "ACCEPTED_EXCEPTION", reason: "Supplier confirmed the 45 kg variance", evidence: "TKT-8492", managerApprovedAt: null }],
        },
        {
          id: "c-approved",
          ruleKey: "package_count_comparison",
          status: "MISMATCH",
          severity: "BLOCKING",
          resolutions: [{ id: "r-ok", type: "ACCEPTED_EXCEPTION", reason: "Manager already signed off", evidence: "TKT-1", managerApprovedAt: new Date() }],
        },
      );
      const result = evaluateSubmissionGuard(input);
      expect(result.allowed).toBe(true);
      expect(result.pendingManagerExceptions).toEqual([
        { checkId: "c-pending", checkRuleKey: "gross_weight_comparison", resolutionId: "r-pending", evidence: "TKT-8492" },
      ]);
    });
  });

  describe("API Route: /api/shipments/[id]/submit", () => {
    const executiveUser = {
      id: "executive-uuid",
      email: "executive@cargoverity.test",
      role: "EXECUTIVE" as const,
    };

    const managerUser = {
      id: "manager-uuid",
      email: "manager@cargoverity.test",
      role: "MANAGER" as const,
    };

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    function asDbShipment(overrides: { status?: string; currentRevision?: number; checkRevision?: number } = {}) {
      const docs = (["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const).map((type) => {
        const doc = createValidSubmissionDocument(type);
        return { ...doc, selectedDocType: type, extractionRuns: [{ fields: doc.fields }] };
      });
      return {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: overrides.status ?? "NEEDS_REVIEW",
        currentRevision: overrides.currentRevision ?? 1,
        createdById: executiveUser.id,
        documents: docs,
        crossCheckRuns: [
          {
            id: "run-1",
            revision: overrides.checkRevision ?? overrides.currentRevision ?? 1,
            results: [{ id: "c-1", ruleKey: "invoice_line_total", status: "PASS", severity: "BLOCKING", resolutions: [] }],
          },
        ],
      };
    }

    /** Prisma fake: the transaction client sees `txShipment` (state after the row lock). */
    function fakePrisma(shipment: ReturnType<typeof asDbShipment> | null, options: { txShipment?: ReturnType<typeof asDbShipment>; lockCount?: number } = {}) {
      const tx = {
        shipment: {
          updateMany: vi.fn().mockResolvedValue({ count: options.lockCount ?? 1 }),
          findUnique: vi.fn().mockResolvedValue(options.txShipment ?? shipment),
          findFirst: vi.fn().mockResolvedValue(options.txShipment ?? shipment),
          update: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => ({ ...(options.txShipment ?? shipment), ...data })),
        },
        auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      };
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(shipment) },
        $transaction: vi.fn().mockImplementation(async (callback: (t: typeof tx) => unknown) => callback(tx)),
      };
      return { prisma, tx };
    }

    const post = (body?: unknown) =>
      POST(
        new Request("http://localhost:3000/api/shipments/test-shipment/submit", {
          method: "POST",
          ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ id: "test-shipment" }) },
      );

    function actAs(user: typeof executiveUser | typeof managerUser) {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: user as never,
        authUser: { id: user.id, email: user.email } as never,
      });
    }

    it("returns 401 when user is unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
      const response = await post();
      expect(response.status).toBe(401);
      expect((await response.json()).error).toMatch(/authentication required/i);
    });

    it("returns 403 when user is not an Executive (Rule 9)", async () => {
      actAs(managerUser);
      const response = await post();
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/permission/i);
    });

    it("scopes Executives to their own shipments (404 otherwise, no status change)", async () => {
      actAs(executiveUser);
      const { prisma } = fakePrisma(null);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post();

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("SHIPMENT_NOT_FOUND");
      expect(prisma.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "test-shipment", createdById: executiveUser.id } }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns 422 with exact blocking reasons when submission guard fails (Rule 11)", async () => {
      actAs(executiveUser);
      const shipment = asDbShipment({ currentRevision: 2, checkRevision: 1 });
      shipment.documents = shipment.documents.filter((d) => d.selectedDocType === "INVOICE");
      const { prisma } = fakePrisma(shipment);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post();

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.allowed).toBe(false);
      expect(json.reasons).toEqual(expect.arrayContaining(["MISSING_REQUIRED_DOCUMENT", "STALE_CHECK_RUN"]));
      expect(json.blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIRED_DOCUMENT", documentType: "PACKING_LIST" })]),
      );
      expect(json.blockingReasons).toEqual(
        expect.arrayContaining([expect.stringMatching(/missing required document/i), expect.stringMatching(/cross-checks are stale/i)]),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns 409 STALE_REVISION when expectedRevision does not match", async () => {
      actAs(executiveUser);
      const { prisma } = fakePrisma(asDbShipment({ currentRevision: 3 }));
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post({ expectedRevision: 2 });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("STALE_REVISION");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns 409 when a concurrent edit bumped the revision before the row lock", async () => {
      actAs(executiveUser);
      const { prisma, tx } = fakePrisma(asDbShipment(), { lockCount: 0, txShipment: asDbShipment({ currentRevision: 2 }) });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post({ expectedRevision: 1 });

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("STALE_REVISION");
      expect(tx.shipment.update).not.toHaveBeenCalled();
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
    });

    it("returns 409 SHIPMENT_LOCKED when the shipment was already submitted", async () => {
      actAs(executiveUser);
      const { prisma } = fakePrisma(asDbShipment(), { lockCount: 0, txShipment: asDbShipment({ status: "READY_FOR_APPROVAL" }) });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post();

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("SHIPMENT_LOCKED");
    });

    it("re-evaluates the guard on the locked row and blocks if it no longer passes", async () => {
      actAs(executiveUser);
      const changed = asDbShipment();
      changed.crossCheckRuns[0].results.push({ id: "c-2", ruleKey: "gross_weight_comparison", status: "MISMATCH", severity: "BLOCKING", resolutions: [] });
      const { prisma, tx } = fakePrisma(asDbShipment(), { txShipment: changed });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post({ expectedRevision: 1 });

      expect(response.status).toBe(422);
      expect((await response.json()).reasons).toEqual(["UNRESOLVED_CROSS_CHECK"]);
      expect(tx.shipment.update).not.toHaveBeenCalled();
    });

    it("successfully submits, locks the row at the evaluated revision, moves to READY_FOR_APPROVAL and audits the real previous status (Rule 10)", async () => {
      actAs(executiveUser);
      const shipment = asDbShipment({ status: "IN_REVIEW" });
      const { prisma, tx } = fakePrisma(shipment);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await post({ expectedRevision: 1 });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.shipment.status).toBe("READY_FOR_APPROVAL");
      expect(json.guard.pendingManagerExceptions).toEqual([]);
      expect(tx.shipment.updateMany).toHaveBeenCalledWith({
        where: { id: "test-shipment", currentRevision: 1, status: { in: ["DRAFT", "IN_REVIEW", "NEEDS_REVIEW"] } },
        data: { currentRevision: 1 },
      });
      expect(tx.shipment.update).toHaveBeenCalledWith({ where: { id: "test-shipment" }, data: { status: "READY_FOR_APPROVAL" } });
      expect(tx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SHIPMENT_SUBMITTED_FOR_APPROVAL",
          entityType: "Shipment",
          entityId: "test-shipment",
          actorId: executiveUser.id,
          metadata: expect.objectContaining({ previousStatus: "IN_REVIEW", revision: 1, checkRunId: "run-1" }),
        }),
      });
    });

    it("GET /api/shipments/[id]/submit evaluates and returns current submission readiness", async () => {
      actAs(executiveUser);
      const empty = { ...asDbShipment(), documents: [], crossCheckRuns: [] };
      const { prisma } = fakePrisma(empty as never);
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await GET(new Request("http://localhost:3000/api/shipments/test-shipment/submit", { method: "GET" }), {
        params: Promise.resolve({ id: "test-shipment" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.allowed).toBe(false);
      expect(json.reasons).toContain("MISSING_REQUIRED_DOCUMENT");
      expect(json.currentRevision).toBe(1);
    });
  });
});
