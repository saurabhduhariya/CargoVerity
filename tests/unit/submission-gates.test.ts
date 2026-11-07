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

    it("returns 401 when user is unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/submit", {
        method: "POST",
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: "test-shipment" }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toMatch(/authentication required/i);
    });

    it("returns 403 when user is not an Executive (Rule 9)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: managerUser as never,
        authUser: { id: managerUser.id, email: managerUser.email } as never,
      });

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/submit", {
        method: "POST",
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: "test-shipment" }),
      });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toMatch(/permission/i);
    });

    it("returns 422 with exact blocking reasons when submission guard fails (Rule 11)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      // Mock prisma returning shipment with missing Packing List and stale check run
      const mockPrisma = {
        shipment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "test-shipment",
            reference: "SHP-2026-001",
            status: "NEEDS_REVIEW",
            currentRevision: 2,
            documents: [
              {
                id: "doc-inv",
                selectedDocType: "INVOICE",
                isCurrent: true,
                documentVersion: 1,
                extractionStatus: "EXTRACTED",
                typeMismatch: false,
                pages: [],
                // The guard reads fields from the latest COMPLETED extraction run.
                extractionRuns: [{ fields: [] }],
              },
            ],
            crossCheckRuns: [
              {
                id: "run-1",
                revision: 1, // Stale! Current is 2
                results: [],
              },
            ],
          }),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/submit", {
        method: "POST",
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: "test-shipment" }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.allowed).toBe(false);
      expect(json.reasons).toContain("MISSING_REQUIRED_DOCUMENT");
      expect(json.reasons).toContain("STALE_CHECK_RUN");
      expect(json.blockingReasons).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/missing required document/i),
          expect.stringMatching(/cross-checks are stale/i),
        ]),
      );
    });

    it("successfully submits shipment, transitions status to READY_FOR_APPROVAL, and creates AuditEvent (Rule 10)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const validDocInv = createValidSubmissionDocument("INVOICE");
      const validDocPL = createValidSubmissionDocument("PACKING_LIST");
      const validDocBL = createValidSubmissionDocument("BILL_OF_LADING");

      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-001",
        status: "NEEDS_REVIEW",
        currentRevision: 1,
        documents: [
          {
            ...validDocInv,
            selectedDocType: "INVOICE",
            pages: validDocInv.pages,
            extractionRuns: [{ fields: validDocInv.fields.map((f) => ({ ...f, modelConfidence: f.modelConfidence })) }],
          },
          {
            ...validDocPL,
            selectedDocType: "PACKING_LIST",
            pages: validDocPL.pages,
            extractionRuns: [{ fields: validDocPL.fields.map((f) => ({ ...f, modelConfidence: f.modelConfidence })) }],
          },
          {
            ...validDocBL,
            selectedDocType: "BILL_OF_LADING",
            pages: validDocBL.pages,
            extractionRuns: [{ fields: validDocBL.fields.map((f) => ({ ...f, modelConfidence: f.modelConfidence })) }],
          },
        ],
        crossCheckRuns: [
          {
            id: "run-1",
            revision: 1,
            results: [
              {
                id: "c-1",
                ruleKey: "invoice-arithmetic",
                status: "PASS",
                severity: "BLOCKING",
                resolutions: [],
              },
            ],
          },
        ],
      };

      const mockTx = {
        shipment: {
          update: vi.fn().mockResolvedValue({
            ...mockShipment,
            status: "READY_FOR_APPROVAL",
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };

      const mockPrisma = {
        shipment: {
          findUnique: vi.fn().mockResolvedValue(mockShipment),
        },
        $transaction: vi.fn().mockImplementation(async (callback) => callback(mockTx)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/submit", {
        method: "POST",
      });
      const response = await POST(request, {
        params: Promise.resolve({ id: "test-shipment" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.shipment.status).toBe("READY_FOR_APPROVAL");
      expect(mockTx.shipment.update).toHaveBeenCalledWith({
        where: { id: "test-shipment" },
        data: { status: "READY_FOR_APPROVAL" },
      });
      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SHIPMENT_SUBMITTED_FOR_APPROVAL",
          entityType: "Shipment",
          entityId: "test-shipment",
          actorId: executiveUser.id,
        }),
      });
    });

    it("GET /api/shipments/[id]/submit evaluates and returns current submission readiness", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockPrisma = {
        shipment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "test-shipment",
            reference: "SHP-2026-001",
            status: "NEEDS_REVIEW",
            currentRevision: 1,
            documents: [],
            crossCheckRuns: [],
          }),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/submit", {
        method: "GET",
      });
      const response = await GET(request, {
        params: Promise.resolve({ id: "test-shipment" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.allowed).toBe(false);
      expect(json.reasons).toContain("MISSING_REQUIRED_DOCUMENT");
    });
  });
});

