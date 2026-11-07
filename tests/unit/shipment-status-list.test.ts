import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET } from "@/app/api/shipments/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import {
  deriveDocumentSlots,
  deriveCrossChecksSummary,
  deriveNextAction,
  calculateShipmentRiskScore,
  sortShipments,
  buildShipmentWhere,
} from "@/lib/shipments";

describe("Shipment Status List & Queue Actions (Week 5 Step 7)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Document Slot Presence & Extraction Status (Rule 2)", () => {
    it("detects all 3 slots when CI, PL, and BL are present", () => {
      const documents = [
        { id: "d-1", docType: "INVOICE", extractionStatus: "COMPLETED", originalFileName: "inv.pdf", isCurrent: true },
        { id: "d-2", docType: "PACKING_LIST", extractionStatus: "REVIEW_REQUIRED", originalFileName: "pl.pdf", isCurrent: true },
        { id: "d-3", docType: "BILL_OF_LADING", extractionStatus: "COMPLETED", originalFileName: "bl.pdf", isCurrent: true },
      ];

      const slots = deriveDocumentSlots(documents);

      expect(slots.allPresent).toBe(true);
      expect(slots.presentCount).toBe(3);
      expect(slots.invoice.present).toBe(true);
      expect(slots.invoice.status).toBe("COMPLETED");
      expect(slots.packingList.present).toBe(true);
      expect(slots.packingList.status).toBe("REVIEW_REQUIRED");
      expect(slots.billOfLading.present).toBe(true);
      expect(slots.billOfLading.status).toBe("COMPLETED");
    });

    it("identifies missing slots when only partial documents are uploaded", () => {
      const documents = [
        { id: "d-1", docType: "INVOICE", extractionStatus: "COMPLETED", originalFileName: "inv.pdf", isCurrent: true },
      ];

      const slots = deriveDocumentSlots(documents);

      expect(slots.allPresent).toBe(false);
      expect(slots.presentCount).toBe(1);
      expect(slots.invoice.present).toBe(true);
      expect(slots.packingList.present).toBe(false);
      expect(slots.packingList.status).toBeNull();
      expect(slots.billOfLading.present).toBe(false);
    });
  });

  describe("Current Revision Cross-Checks Summary (Rule 3)", () => {
    it("aggregates passed, mismatch, incomplete, and resolved checks for current revision", () => {
      const checks = [
        // Current revision (rev 2)
        {
          id: "c-1",
          ruleKey: "invoice_arithmetic",
          status: "PASS",
          severity: "BLOCKING",
          createdAt: new Date("2026-11-06T10:00:00Z"),
          revision: 2,
        },
        {
          id: "c-2",
          ruleKey: "gross_weight_vs_net_weight",
          status: "MISMATCH",
          severity: "BLOCKING",
          createdAt: new Date("2026-11-06T10:00:00Z"),
          revision: 2,
          resolutions: [], // Unresolved!
        },
        {
          id: "c-3",
          ruleKey: "currency_uniformity",
          status: "MISMATCH",
          severity: "BLOCKING",
          createdAt: new Date("2026-11-06T10:00:00Z"),
          revision: 2,
          // Week 4 fix: SOURCE_CORRECTED is an audit link only; it never clears a current failure.
          resolutions: [{ id: "r-1", type: "SOURCE_CORRECTED", managerApprovedAt: null }],
        },
        {
          id: "c-4",
          ruleKey: "container_number_format",
          status: "INCOMPLETE",
          severity: "WARNING",
          createdAt: new Date("2026-11-06T10:00:00Z"),
          revision: 2,
          resolutions: [],
        },
        // Old revision (rev 1) - must be ignored!
        {
          id: "c-old",
          ruleKey: "invoice_arithmetic",
          status: "MISMATCH",
          severity: "BLOCKING",
          createdAt: new Date("2026-11-05T10:00:00Z"),
          revision: 1,
        },
      ];

      const summary = deriveCrossChecksSummary(checks, 2);

      expect(summary.total).toBe(4);
      expect(summary.passed).toBe(1);
      expect(summary.mismatch).toBe(2);
      expect(summary.incomplete).toBe(1);
      expect(summary.resolved).toBe(0);
      // c-2 (unresolved mismatch) and c-3 (audit-link only). c-4 is WARNING severity and never blocks.
      expect(summary.blockingUnresolved).toBe(2);
      expect(summary.hasBlockingMismatches).toBe(true);
    });

    it("requires manager sign-off on accepted exceptions to count as resolved", () => {
      const checks = [
        {
          id: "c-1",
          ruleKey: "weight_rule",
          status: "MISMATCH",
          severity: "BLOCKING",
          createdAt: new Date("2026-11-06T10:00:00Z"),
          revision: 1,
          resolutions: [
            {
              id: "r-1",
              type: "ACCEPTED_EXCEPTION",
              reason: "Supplier confirmed weight variance in writing",
              evidence: "TKT-8492",
              managerApprovedAt: null as Date | null,
            }, // Not signed off yet
          ],
        },
      ];

      const summary = deriveCrossChecksSummary(checks, 1);
      expect(summary.resolved).toBe(0);
      expect(summary.blockingUnresolved).toBe(1);

      // Now with manager approval
      checks[0].resolutions[0].managerApprovedAt = new Date("2026-11-06T11:00:00Z");
      const approvedSummary = deriveCrossChecksSummary(checks, 1);
      expect(approvedSummary.resolved).toBe(1);
      expect(approvedSummary.blockingUnresolved).toBe(0);
    });
  });

  describe("Deterministic Next Action Resolution (Rule 5)", () => {
    const baseSlots = {
      invoice: { present: true, status: "COMPLETED", documentId: "1", fileName: "inv.pdf" },
      packingList: { present: true, status: "COMPLETED", documentId: "2", fileName: "pl.pdf" },
      billOfLading: { present: true, status: "COMPLETED", documentId: "3", fileName: "bl.pdf" },
      allPresent: true,
      presentCount: 3,
    };

    const cleanChecks = {
      total: 5,
      passed: 5,
      mismatch: 0,
      incomplete: 0,
      resolved: 0,
      blockingUnresolved: 0,
      hasBlockingMismatches: false,
    };

    it("recommends upload when required documents are missing", () => {
      const missingSlots = { ...baseSlots, allPresent: false, presentCount: 2 };
      const action = deriveNextAction({
        id: "shp-1",
        status: "DRAFT",
        slots: missingSlots,
        checks: cleanChecks,
        reviewRequiredCount: 0,
      });

      expect(action.type).toBe("upload");
      expect(action.label).toBe("Upload Missing Documents");
      expect(action.href).toBe("/shipments/shp-1");
    });

    it("recommends resolve when cross-checks have blocking discrepancies", () => {
      const checksWithMismatch = { ...cleanChecks, blockingUnresolved: 2, hasBlockingMismatches: true };
      const action = deriveNextAction({
        id: "shp-1",
        status: "NEEDS_REVIEW",
        slots: baseSlots,
        checks: checksWithMismatch,
        reviewRequiredCount: 0,
      });

      expect(action.type).toBe("resolve");
      expect(action.label).toBe("Resolve Discrepancies");
      expect(action.href).toBe("/review/shp-1");
      expect(action.urgency).toBe("high");
    });

    it("recommends review when extracted fields require human confirmation", () => {
      const action = deriveNextAction({
        id: "shp-1",
        status: "NEEDS_REVIEW",
        slots: baseSlots,
        checks: cleanChecks,
        reviewRequiredCount: 3,
      });

      expect(action.type).toBe("review");
      expect(action.label).toBe("Review Extracted Fields");
      expect(action.href).toBe("/review/shp-1");
      expect(action.urgency).toBe("high");
    });

    it("recommends submit when all documents are present, fields verified, and checks clear", () => {
      const action = deriveNextAction({
        id: "shp-1",
        status: "NEEDS_REVIEW",
        slots: baseSlots,
        checks: cleanChecks,
        reviewRequiredCount: 0,
      });

      expect(action.type).toBe("submit");
      expect(action.label).toBe("Submit for Approval");
      expect(action.href).toBe("/review/shp-1");
      expect(action.urgency).toBe("high");
    });

    it("recommends approve for Manager when shipment is READY_FOR_APPROVAL", () => {
      const action = deriveNextAction({
        id: "shp-1",
        status: "READY_FOR_APPROVAL",
        slots: baseSlots,
        checks: cleanChecks,
        reviewRequiredCount: 0,
        userRole: "MANAGER",
      });

      expect(action.type).toBe("approve");
      expect(action.label).toBe("Manager Review & Decision");
      expect(action.href).toBe("/review/shp-1");
      expect(action.urgency).toBe("high");
    });

    it("recommends export when shipment is APPROVED", () => {
      const action = deriveNextAction({
        id: "shp-1",
        status: "APPROVED",
        slots: baseSlots,
        checks: cleanChecks,
        reviewRequiredCount: 0,
      });

      expect(action.type).toBe("export");
      expect(action.label).toBe("Export Customs CSV");
      expect(action.href).toBe("/review/shp-1");
    });

    it("marks completed when shipment is EXPORTED", () => {
      const action = deriveNextAction({
        id: "shp-1",
        status: "EXPORTED",
        slots: baseSlots,
        checks: cleanChecks,
        reviewRequiredCount: 0,
      });

      expect(action.type).toBe("completed");
      expect(action.label).toBe("View Exported CSV");
      expect(action.urgency).toBe("none");
    });
  });

  describe("High-Risk Review Priority Sorting (Rule 8)", () => {
    it("calculates deterministic risk scores based on real stored state", () => {
      // 1. Ready for approval = 100
      expect(calculateShipmentRiskScore({ status: "READY_FOR_APPROVAL", blockingUnresolved: 0, reviewRequiredCount: 0, allDocumentsPresent: true })).toBe(100);

      // 2. Blocking unresolved cross-checks = 90
      expect(calculateShipmentRiskScore({ status: "NEEDS_REVIEW", blockingUnresolved: 2, reviewRequiredCount: 0, allDocumentsPresent: true })).toBe(90);

      // 3. Fields requiring review = 80
      expect(calculateShipmentRiskScore({ status: "NEEDS_REVIEW", blockingUnresolved: 0, reviewRequiredCount: 4, allDocumentsPresent: true })).toBe(80);

      // 4. Missing required documents = 70
      expect(calculateShipmentRiskScore({ status: "DRAFT", blockingUnresolved: 0, reviewRequiredCount: 0, allDocumentsPresent: false })).toBe(70);

      // 5. Approved = 40
      expect(calculateShipmentRiskScore({ status: "APPROVED", blockingUnresolved: 0, reviewRequiredCount: 0, allDocumentsPresent: true })).toBe(40);

      // 6. Exported = 10
      expect(calculateShipmentRiskScore({ status: "EXPORTED", blockingUnresolved: 0, reviewRequiredCount: 0, allDocumentsPresent: true })).toBe(10);
    });

    it("sorts high-risk review shipments to top of the queue", () => {
      const shipments = [
        {
          id: "shp-low",
          reference: "SHP-EXPORTED",
          status: "EXPORTED",
          currentRevision: 1,
          importerName: null,
          exporterName: null,
          createdAt: "2026-11-06T10:00:00Z",
          updatedAt: "2026-11-06T12:00:00Z",
          supplier: null,
          documentSlots: { allPresent: true } as never,
          checksSummary: {} as never,
          reviewRequiredCount: 0,
          nextAction: {} as never,
          riskScore: 10,
        },
        {
          id: "shp-high",
          reference: "SHP-DISCREPANCY",
          status: "NEEDS_REVIEW",
          currentRevision: 1,
          importerName: null,
          exporterName: null,
          createdAt: "2026-11-06T09:00:00Z",
          updatedAt: "2026-11-06T11:00:00Z",
          supplier: null,
          documentSlots: { allPresent: true } as never,
          checksSummary: {} as never,
          reviewRequiredCount: 0,
          nextAction: {} as never,
          riskScore: 90,
        },
        {
          id: "shp-urgent",
          reference: "SHP-APPROVAL",
          status: "READY_FOR_APPROVAL",
          currentRevision: 1,
          importerName: null,
          exporterName: null,
          createdAt: "2026-11-06T08:00:00Z",
          updatedAt: "2026-11-06T10:00:00Z",
          supplier: null,
          documentSlots: { allPresent: true } as never,
          checksSummary: {} as never,
          reviewRequiredCount: 0,
          nextAction: {} as never,
          riskScore: 100,
        },
      ];

      const sorted = sortShipments(shipments, "risk");

      expect(sorted[0].id).toBe("shp-urgent"); // Score 100
      expect(sorted[1].id).toBe("shp-high");   // Score 90
      expect(sorted[2].id).toBe("shp-low");    // Score 10
    });
  });

  describe("Date and Scope Filters (Rules 6 & 7)", () => {
    it("applies date filters using fromDate and toDate", () => {
      const where = buildShipmentWhere(
        { fromDate: "2026-11-01", toDate: "2026-11-05" },
        { id: "mgr-1", role: "MANAGER" },
      );

      expect(where).toEqual({
        AND: [
          { createdAt: { gte: new Date("2026-11-01") } },
          { createdAt: { lte: expect.any(Date) } },
        ],
      });
    });

    it("scopes executive to their own shipments and applies reference search", () => {
      const where = buildShipmentWhere(
        { search: "SHP-2026" },
        { id: "exec-1", role: "EXECUTIVE" },
      );

      expect(where).toEqual({
        AND: [
          { createdById: "exec-1" },
          {
            OR: [
              { reference: { contains: "SHP-2026", mode: "insensitive" } },
              { importerName: { contains: "SHP-2026", mode: "insensitive" } },
              { exporterName: { contains: "SHP-2026", mode: "insensitive" } },
              { supplier: { name: { contains: "SHP-2026", mode: "insensitive" } } },
            ],
          },
        ],
      });
    });
  });

  describe("API Route Integration: GET /api/shipments", () => {
    const executiveUser = {
      id: "exec-1",
      email: "exec@cargoverity.test",
      role: "EXECUTIVE" as const,
    };

    it("returns enriched shipments with slots, checks, next action, and real stats (Rules 1-9)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockDbShipments = [
        {
          id: "shp-1",
          reference: "SHP-MOCK-01",
          status: "APPROVED",
          currentRevision: 1,
          importerName: "Target Imports",
          exporterName: "Apex Exports",
          createdAt: new Date("2026-11-06T10:00:00Z"),
          updatedAt: new Date("2026-11-06T11:00:00Z"),
          supplier: { id: "sup-1", name: "Apex Global Supplies Ltd" },
          documents: [
            { id: "d-1", docType: "INVOICE", extractionStatus: "COMPLETED", originalFileName: "inv.pdf", documentVersion: 1, isCurrent: true, fields: [], pages: [] },
            { id: "d-2", docType: "PACKING_LIST", extractionStatus: "COMPLETED", originalFileName: "pl.pdf", documentVersion: 1, isCurrent: true, fields: [], pages: [] },
            { id: "d-3", docType: "BILL_OF_LADING", extractionStatus: "COMPLETED", originalFileName: "bl.pdf", documentVersion: 1, isCurrent: true, fields: [], pages: [] },
          ],
          crossChecks: [],
        },
      ];

      const mockPrisma = {
        shipment: { findMany: vi.fn().mockResolvedValue(mockDbShipments) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments?sort=risk");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.shipments).toHaveLength(1);
      const item = json.shipments[0];

      // Rule 1: Reference and Supplier
      expect(item.reference).toBe("SHP-MOCK-01");
      expect(item.supplier.name).toBe("Apex Global Supplies Ltd");

      // Rule 2: CI / PL / BL Slots
      expect(item.documentSlots.allPresent).toBe(true);
      expect(item.documentSlots.invoice.present).toBe(true);

      // Rule 3: Checks Summary
      expect(item.checksSummary.total).toBe(0);

      // Rule 4: Status and Revision
      expect(item.status).toBe("APPROVED");
      expect(item.currentRevision).toBe(1);

      // Rule 5: Next Action
      expect(item.nextAction.type).toBe("export");
      expect(item.nextAction.label).toBe("Export Customs CSV");

      // Rule 9: Real stored KPIs
      expect(json.stats).toEqual({
        totalShipments: 1,
        highRiskReviewPending: 0,
        awaitingManagerApproval: 0,
        clearedOrExported: 1,
      });
    });
  });
});
