import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET } from "@/app/api/shipments/[id]/export/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { formatExportBlocker } from "@/lib/export/preview";
import { getExportProfile } from "@/lib/export/csv";

describe("Export Preview & Verification (Week 5 Step 5)", () => {
  const managerUser = {
    id: "manager-uuid",
    email: "manager@cargoverity.test",
    role: "MANAGER" as const,
  };

  const executiveUser = {
    id: "executive-uuid",
    email: "executive@cargoverity.test",
    role: "EXECUTIVE" as const,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Blocker Formatting & Labeling (Rules 1 & 3)", () => {
    it("formats known blocker reason codes into human-readable messages (Rule 3)", () => {
      expect(formatExportBlocker("shipment_not_approved")).toEqual(
        expect.objectContaining({
          code: "shipment_not_approved",
          title: "Shipment Not Approved",
          category: "approval",
        }),
      );

      expect(formatExportBlocker("manager_approval_required")).toEqual(
        expect.objectContaining({
          code: "manager_approval_required",
          title: "Manager Approval Required",
          category: "approval",
        }),
      );

      expect(formatExportBlocker("approval_is_stale")).toEqual(
        expect.objectContaining({
          code: "approval_is_stale",
          title: "Approval Is Stale",
          category: "revision",
        }),
      );

      expect(formatExportBlocker("documents_missing")).toEqual(
        expect.objectContaining({
          code: "documents_missing",
          title: "Required Documents Missing",
          category: "documents",
        }),
      );

      expect(formatExportBlocker("cross_checks_unresolved")).toEqual(
        expect.objectContaining({
          code: "cross_checks_unresolved",
          title: "Unresolved Cross-Checks",
          category: "cross_checks",
        }),
      );

      expect(formatExportBlocker("unapproved_exceptions_present")).toEqual(
        expect.objectContaining({
          code: "unapproved_exceptions_present",
          title: "Accepted Exceptions Awaiting Manager Sign-off",
          category: "cross_checks",
        }),
      );

      expect(formatExportBlocker("missing_field_Gross_Weight_KG")).toEqual(
        expect.objectContaining({
          code: "missing_field_Gross_Weight_KG",
          title: "Missing Field: Gross Weight KG",
          category: "fields",
        }),
      );
    });

    it("verifies demo-v1 profile and its provisional assumption label (Rule 1)", () => {
      const profile = getExportProfile("demo-v1");
      expect(profile.id).toBe("demo-v1");
      expect(profile.version).toBe("1.0.0");
      expect(profile.assumptionLabel).toContain("[ASSUMPTION]");
      expect(profile.assumptionLabel).toContain("demo-v1");
      expect(profile.assumptionLabel).toContain("awaiting client specification");
    });
  });

  describe("Server Preview Endpoint: GET /api/shipments/[id]/export?preview=1", () => {
    it("returns structured blockers with 400 when shipment is not approved (Rule 3)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockShipment = {
        id: "shp-unapproved",
        reference: "SHP-DRAFT-01",
        status: "NEEDS_REVIEW",
        currentRevision: 1,
        createdById: executiveUser.id,
        supplier: { name: "Supplier Co" },
        importerName: "Importer Co",
        documents: [],
        exportEvents: [],
      };

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(null) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue([]) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/shp-unapproved/export?preview=1");
      const response = await GET(request, { params: Promise.resolve({ id: "shp-unapproved" }) });

      expect([400, 422]).toContain(response.status);
      const json = await response.json();
      expect(json.ready).toBe(false);
      expect(json.allowed).toBe(false);
      expect(json.blockers).toContain("shipment_not_approved");
      expect(json.blockers).toContain("manager_approval_required");
      expect(json.profileId).toBe("demo-v1");
      expect(json.assumptionLabel).toContain("[ASSUMPTION]");
      expect(json.approvedRevision).toBeNull();
    });

    it("detects stale revision blocker when approval was granted for an earlier revision (Rules 2 & 3)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockShipment = {
        id: "shp-stale",
        reference: "SHP-STALE-02",
        status: "APPROVED",
        currentRevision: 3, // current is rev 3
        createdById: executiveUser.id,
        supplier: { name: "Supplier Co" },
        importerName: "Importer Co",
        documents: [
          { docType: "INVOICE", isCurrent: true, extractionRuns: [] },
          { docType: "PACKING_LIST", isCurrent: true, extractionRuns: [] },
          { docType: "BILL_OF_LADING", isCurrent: true, extractionRuns: [] },
        ],
        exportEvents: [],
      };

      const mockApproval = {
        revision: 2, // approved revision was rev 2!
        approvedAt: new Date("2026-11-04T10:00:00Z"),
        approvedBy: { email: "manager@test.com", fullName: "Manager Test" },
      };

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(mockApproval) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue([]) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/shp-stale/export?preview=1");
      const response = await GET(request, { params: Promise.resolve({ id: "shp-stale" }) });

      expect([400, 422]).toContain(response.status);
      const json = await response.json();
      expect(json.ready).toBe(false);
      expect(json.blockers).toContain("approval_is_stale");
      expect(json.approvedRevision).toBe(2);
      expect(json.currentRevision).toBe(3);
    });

    it("detects unapproved exceptions requiring manager sign-off (Rule 3)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: managerUser as never,
        authUser: { id: managerUser.id, email: managerUser.email } as never,
      });

      const mockShipment = {
        id: "shp-exception",
        reference: "SHP-EXC-01",
        status: "APPROVED",
        currentRevision: 1,
        createdById: executiveUser.id,
        supplier: { name: "Supplier Co" },
        importerName: "Importer Co",
        documents: [
          { docType: "INVOICE", isCurrent: true, extractionRuns: [] },
          { docType: "PACKING_LIST", isCurrent: true, extractionRuns: [] },
          { docType: "BILL_OF_LADING", isCurrent: true, extractionRuns: [] },
        ],
        exportEvents: [],
      };

      const mockApproval = {
        revision: 1,
        approvedAt: new Date("2026-11-05T12:00:00Z"),
        approvedBy: { email: "manager@test.com" },
      };

      const mockChecks = [
        {
          ruleKey: "invoice_total_matches_line_sum",
          status: "MISMATCH",
          createdAt: new Date("2026-11-05T11:00:00Z"),
          resolutions: [
            {
              type: "ACCEPTED_EXCEPTION",
              managerApprovedAt: null, // NOT approved by manager!
            },
          ],
        },
      ];

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(mockApproval) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue(mockChecks) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/shp-exception/export?preview=1");
      const response = await GET(request, { params: Promise.resolve({ id: "shp-exception" }) });

      expect([400, 422]).toContain(response.status);
      const json = await response.json();
      expect(json.ready).toBe(false);
      expect(json.blockers).toContain("unapproved_exceptions_present");
    });

    it("confirms readiness and renders CSV preview when all guards pass (Rules 1, 2, 4, 5)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockShipment = {
        id: "shp-ready",
        reference: "SHP-2026-READY",
        status: "APPROVED",
        currentRevision: 2,
        createdById: executiveUser.id,
        supplier: { name: "Apex Logistics Global Ltd" },
        importerName: "Target Imports Inc",
        documents: [
          {
            docType: "INVOICE",
            isCurrent: true,
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "documentNumber", currentValue: "INV-9901", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "issueDate", currentValue: "2026-11-02", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "currency", currentValue: "USD", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "incoterm", currentValue: "FOB", unit: null, sourceQuote: null, pageNumber: 1 },
                ],
                lineItems: [
                  {
                    lineNumber: 1,
                    description: "High-End Pressure Gauge",
                    hsnCode: "9026.20",
                    quantity: "25",
                    quantityUnit: "PCS",
                    unitPrice: "80.00",
                    lineTotal: "2000.00",
                  },
                ],
              },
            ],
          },
          {
            docType: "PACKING_LIST",
            isCurrent: true,
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "grossWeight", currentValue: "450.000", unit: "kg", sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "netWeight", currentValue: "410.000", unit: "kg", sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "packageCount", currentValue: "10", unit: "BOXES", sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "packageType", currentValue: "Cartons", unit: null, sourceQuote: null, pageNumber: 1 },
                ],
                lineItems: [],
              },
            ],
          },
          {
            docType: "BILL_OF_LADING",
            isCurrent: true,
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "documentNumber", currentValue: "BL-OCEAN-88", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "containerNumber", currentValue: "TGHU1234567", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "portOfLoading", currentValue: "SGSIN", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "portOfDischarge", currentValue: "USLAX", unit: null, sourceQuote: null, pageNumber: 1 },
                ],
                lineItems: [],
              },
            ],
          },
        ],
        exportEvents: [],
      };

      const mockApproval = {
        revision: 2,
        approvedAt: new Date("2026-11-06T15:45:00Z"),
        approvedBy: { email: "manager@cargoverity.test", fullName: "Customs Manager" },
      };

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(mockApproval) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/shp-ready/export?preview=1");
      const response = await GET(request, { params: Promise.resolve({ id: "shp-ready" }) });

      expect(response.status).toBe(200);
      const json = await response.json();

      // Rule 1: demo-v1 and assumption label
      expect(json.profileId).toBe("demo-v1");
      expect(json.profileVersion).toBe("1.0.0");
      expect(json.assumptionLabel).toMatch(/\[ASSUMPTION\]/);

      // Rule 2: current approved revision and timestamp
      expect(json.approvedRevision).toBe(2);
      expect(json.currentRevision).toBe(2);
      expect(json.approvedAt).toBe("2026-11-06T15:45:00.000Z");
      expect(json.approvedBy).toBe("manager@cargoverity.test");

      // Rule 3: readiness confirmed (zero blockers)
      expect(json.ready).toBe(true);
      expect(json.allowed).toBe(true);
      expect(json.blockers).toEqual([]);

      // Rule 4: small CSV preview table
      expect(json.headers).toHaveLength(24);
      expect(json.rows).toHaveLength(1);
      expect(json.rows[0][0]).toBe("SHP-2026-READY");
      expect(json.rows[0][1]).toBe("Apex Logistics Global Ltd");
      expect(json.rows[0][8]).toBe("High-End Pressure Gauge");
      expect(json.rowCount).toBe(1);
      expect(json.checksumSha256).toBeDefined();

      // Ensure DB was NOT mutated for preview
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("surfaces previous export record when shipment was previously exported (Rule 7)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockExportEvent = {
        id: "export-event-123",
        profileId: "demo-v1",
        revision: 1,
        createdAt: new Date("2026-11-06T16:00:00Z"),
        exportedBy: { email: "exec@cargoverity.test", fullName: "Executive User" },
      };

      const mockShipment = {
        id: "shp-exported",
        reference: "SHP-EXPORTED-01",
        status: "APPROVED",
        currentRevision: 1,
        createdById: executiveUser.id,
        supplier: { name: "Apex Ltd" },
        importerName: "Target Imports",
        documents: [
          {
            docType: "INVOICE",
            isCurrent: true,
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "documentNumber", currentValue: "INV-1", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "issueDate", currentValue: "2026-11-01", unit: null, sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "currency", currentValue: "USD", unit: null, sourceQuote: null, pageNumber: 1 },
                ],
                lineItems: [{ lineNumber: 1, description: "Item 1", hsnCode: "1234", quantity: "1", unitPrice: "10", lineTotal: "10" }],
              },
            ],
          },
          {
            docType: "PACKING_LIST",
            isCurrent: true,
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "grossWeight", currentValue: "100", unit: "kg", sourceQuote: null, pageNumber: 1 },
                  { fieldKey: "packageCount", currentValue: "1", unit: "BOX", sourceQuote: null, pageNumber: 1 },
                ],
                lineItems: [],
              },
            ],
          },
          {
            docType: "BILL_OF_LADING",
            isCurrent: true,
            extractionRuns: [
              {
                fields: [{ fieldKey: "documentNumber", currentValue: "BL-1", unit: null, sourceQuote: null, pageNumber: 1 }],
                lineItems: [],
              },
            ],
          },
        ],
        exportEvents: [mockExportEvent],
      };

      const mockApproval = {
        revision: 1,
        approvedAt: new Date("2026-11-06T15:50:00Z"),
        approvedBy: { email: "manager@test.com" },
      };

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(mockApproval) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue([]) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/shp-exported/export?preview=1");
      const response = await GET(request, { params: Promise.resolve({ id: "shp-exported" }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.recentExport).toEqual(
        expect.objectContaining({
          id: "export-event-123",
          profileId: "demo-v1",
          revision: 1,
          exportedBy: "exec@cargoverity.test",
        }),
      );
    });
  });

  describe("Guarded Endpoint Security: Button Manipulation Resistance (Rule 6)", () => {
    it("strictly blocks direct CSV download with 400 when guards fail, preventing bypass (Rule 6)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      // Shipment is NOT approved
      const mockShipment = {
        id: "shp-bypass-attempt",
        reference: "SHP-BYPASS",
        status: "NEEDS_REVIEW",
        currentRevision: 1,
        createdById: executiveUser.id,
        supplier: { name: "Supplier" },
        documents: [],
        exportEvents: [],
      };

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(null) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      // Malicious or manipulated client calls direct download without meeting guards
      const request = new Request("http://localhost:3000/api/shipments/shp-bypass-attempt/export");
      const response = await GET(request, { params: Promise.resolve({ id: "shp-bypass-attempt" }) });

      expect([400, 422]).toContain(response.status);
      const json = await response.json();
      expect(json.error).toContain("shipment_not_approved");
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
