import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET } from "@/app/api/shipments/[id]/export/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { canExport } from "@/lib/export/guard";
import { buildDemoV1Export, sanitizeCsvCell, escapeCsvCell } from "@/lib/export/csv";

describe("Guarded CSV Generation (Week 5 Step 4)", () => {
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

  describe("Pure Export Guard Tests (Rules 3, 4, 5, 6, 7, 8)", () => {
    it("blocks export when shipment status is not APPROVED (Rule 4)", () => {
      const guard = canExport({
        shipmentStatus: "NEEDS_REVIEW",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        hasCurrentDocuments: true,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("shipment_not_approved");
    });

    it("blocks export when manager approval is missing or stale (Rule 5)", () => {
      // Missing approval
      const missingApproval = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: false,
        approvedRevision: null,
        currentRevision: 1,
        hasCurrentDocuments: true,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });
      expect(missingApproval.allowed).toBe(false);
      expect(missingApproval.reasons).toContain("manager_approval_required");

      // Stale approval
      const staleApproval = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 2, // Current is 2!
        hasCurrentDocuments: true,
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });
      expect(staleApproval.allowed).toBe(false);
      expect(staleApproval.reasons).toContain("approval_is_stale");
    });

    it("blocks export when required documents are missing (Rule 6)", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        hasCurrentDocuments: false, // Missing required docs!
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("documents_missing");
    });

    it("blocks export when required fields are missing (Rule 6)", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        hasCurrentDocuments: true,
        hasMissingRequiredFields: true, // Missing required fields!
        unresolvedStatuses: [],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("required_fields_missing");
    });

    it("blocks export when unresolved cross-check mismatches exist (Rule 7)", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        hasCurrentDocuments: true,
        unresolvedStatuses: ["MISMATCH"],
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("cross_checks_unresolved");
    });

    it("blocks export when accepted exceptions have not been approved by manager (Rule 7)", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        hasCurrentDocuments: true,
        unresolvedStatuses: [],
        unapprovedExceptionCount: 1, // Exception pending manager approval!
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(false);
      expect(guard.reasons).toContain("unapproved_exceptions_present");
    });

    it("permits export when all guard conditions pass cleanly", () => {
      const guard = canExport({
        shipmentStatus: "APPROVED",
        hasManagerApproval: true,
        approvedRevision: 1,
        currentRevision: 1,
        hasCurrentDocuments: true,
        unresolvedStatuses: [],
        unapprovedExceptionCount: 0,
        profileId: "demo-v1",
      });

      expect(guard.allowed).toBe(true);
      expect(guard.reasons).toHaveLength(0);
    });
  });

  describe("Formatting & Security Verification (Rules 9 - 15)", () => {
    it("safely handles commas, quotes, newlines, and Unicode (Rules 11 - 14)", () => {
      const docs = [
        {
          docType: "INVOICE",
          fields: [
            { fieldKey: "exporter", currentValue: 'München "Global", GmbH', unit: null, sourceQuote: null, pageNumber: 1 },
            { fieldKey: "documentNumber", currentValue: "INV,2026/01", unit: null, sourceQuote: null, pageNumber: 1 },
            { fieldKey: "issueDate", currentValue: "2026-11-01", unit: null, sourceQuote: null, pageNumber: 1 },
            { fieldKey: "currency", currentValue: "EUR", unit: null, sourceQuote: null, pageNumber: 1 },
          ],
          lineItems: [
            {
              lineNumber: 1,
              description: "High-Precision Sensor\nModel São Paulo / €100 / ¥15000",
              hsnCode: "9026.10",
              quantity: "10.5",
              quantityUnit: "KG",
              unitPrice: "100.00",
              lineTotal: "1050.00",
            },
          ],
        },
        {
          docType: "PACKING_LIST",
          fields: [
            { fieldKey: "grossWeight", currentValue: "1200.500", unit: "kg", sourceQuote: null, pageNumber: 1 },
            { fieldKey: "packageCount", currentValue: "50", unit: "PKGS", sourceQuote: null, pageNumber: 1 },
          ],
          lineItems: [],
        },
        {
          docType: "BILL_OF_LADING",
          fields: [
            { fieldKey: "documentNumber", currentValue: "BL-999", unit: null, sourceQuote: null, pageNumber: 1 },
          ],
          lineItems: [],
        },
      ];

      const result = buildDemoV1Export("SHP-UNICODE-001", docs, {
        approvedBy: "manager@cargoverity.test",
        approvedAt: "2026-11-02",
      });

      expect(escapeCsvCell('Alpha "Beta", Gamma')).toBe('"Alpha ""Beta"", Gamma"');
      expect(result.csv).toContain('"München ""Global"", GmbH"');
      expect(result.csv).toContain('"INV,2026/01"');
      expect(result.csv).toContain('"High-Precision Sensor\nModel São Paulo / €100 / ¥15000"');
      expect(result.csv).toContain('"1050.00"');
    });

    it("sanitizes formula-like text while preserving valid typed negative numbers (Rule 15)", () => {
      // Formula-injection leading characters
      expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
      expect(sanitizeCsvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(sanitizeCsvCell("@SUM(A1:B2)")).toBe("'@SUM(A1:B2)");
      expect(sanitizeCsvCell("-cmd")).toBe("'-cmd");

      // Valid negative numbers must remain uncorrupted
      expect(sanitizeCsvCell("-15.00")).toBe("-15.00");
      expect(sanitizeCsvCell("-0.5")).toBe("-0.5");
      expect(sanitizeCsvCell("-120")).toBe("-120");
    });

    it("multiplies rows across multiple line items (Rule 9 & 10)", () => {
      const docs = [
        {
          docType: "INVOICE",
          fields: [
            { fieldKey: "documentNumber", currentValue: "INV-100", unit: null, sourceQuote: null, pageNumber: 1 },
            { fieldKey: "issueDate", currentValue: "2026-11-01", unit: null, sourceQuote: null, pageNumber: 1 },
            { fieldKey: "currency", currentValue: "USD", unit: null, sourceQuote: null, pageNumber: 1 },
          ],
          lineItems: [
            { lineNumber: 1, description: "Item 1", hsnCode: "8471.30", quantity: "5", unitPrice: "100.00", lineTotal: "500.00" },
            { lineNumber: 2, description: "Item 2", hsnCode: "8471.40", quantity: "2", unitPrice: "200.00", lineTotal: "400.00" },
            { lineNumber: 3, description: "Item 3", hsnCode: "8471.50", quantity: "1", unitPrice: "300.00", lineTotal: "300.00" },
          ],
        },
      ];

      const result = buildDemoV1Export("SHP-MULTI-LINE", docs);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0][6]).toBe("1");
      expect(result.rows[1][6]).toBe("2");
      expect(result.rows[2][6]).toBe("3");
      expect(result.rows[0][0]).toBe("SHP-MULTI-LINE");
      expect(result.rows[1][0]).toBe("SHP-MULTI-LINE");
      expect(result.rows[2][0]).toBe("SHP-MULTI-LINE");
    });
  });

  describe("API Route Integration: GET /api/shipments/[id]/export", () => {
    it("blocks export with 400 when shipment is not approved", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({
            id: "test-shipment",
            reference: "SHP-001",
            status: "NEEDS_REVIEW", // Not approved!
            currentRevision: 1,
            documents: [],
          }),
        },
        approval: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        crossCheckResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/export");
      const response = await GET(request, { params: Promise.resolve({ id: "test-shipment" }) });

      expect([400, 422]).toContain(response.status);
      const json = await response.json();
      expect(json.error).toMatch(/export blocked.*shipment_not_approved/i);
    });

    it("successfully exports CSV, records checksum in ExportEvent and AuditEvent, and sets status to EXPORTED (Rules 16 & 17)", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-2026-FINAL",
        status: "APPROVED",
        currentRevision: 1,
        supplier: { name: "Apex Global Supplies Ltd" },
        importerName: "CargoVerity Imports Inc",
        documents: [
          {
            docType: "INVOICE",
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "exporter", currentValue: "Apex Global Supplies Ltd" },
                  { fieldKey: "documentNumber", currentValue: "INV-9999" },
                  { fieldKey: "issueDate", currentValue: "2026-11-01" },
                  { fieldKey: "currency", currentValue: "USD" },
                  { fieldKey: "grossWeight", currentValue: "3120" },
                  { fieldKey: "packageCount", currentValue: "120" },
                ],
                lineItems: [
                  {
                    lineNumber: 1,
                    description: "Standard Widget",
                    hsnCode: "8471.30",
                    quantity: "10",
                    quantityUnit: "PCS",
                    unitPrice: "50.00",
                    lineTotal: "500.00",
                  },
                ],
              },
            ],
          },
          {
            docType: "PACKING_LIST",
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "grossWeight", currentValue: "3120" },
                  { fieldKey: "packageCount", currentValue: "120" },
                ],
                lineItems: [],
              },
            ],
          },
          {
            docType: "BILL_OF_LADING",
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "documentNumber", currentValue: "BL-8888" },
                  { fieldKey: "issueDate", currentValue: "2026-11-02" },
                ],
                lineItems: [],
              },
            ],
          },
        ],
      };

      const mockApproval = {
        id: "appr-1",
        revision: 1,
        approvedById: managerUser.id,
        approvedAt: new Date("2026-11-03T10:00:00Z"),
        approvedBy: { email: managerUser.email, fullName: "Test Manager" },
      };

      const mockTx = {
        exportEvent: {
          create: vi.fn().mockResolvedValue({ id: "exp-1" }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "aud-1" }),
        },
        shipment: {
          update: vi.fn().mockResolvedValue({ ...mockShipment, status: "EXPORTED" }),
        },
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue(mockShipment),
        },
        approval: {
          findUnique: vi.fn().mockResolvedValue(mockApproval),
        },
        crossCheckResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: "c-1", ruleKey: "weight", status: "PASS", resolutions: [] },
          ]),
        },
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/export");
      const response = await GET(request, { params: Promise.resolve({ id: "test-shipment" }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/csv");
      expect(response.headers.get("Content-Disposition")).toContain('attachment; filename="SHP-2026-FINAL-demo-v1-rev1.csv"');
      expect(response.headers.get("X-Checksum-Sha256")).toBeDefined();

      const csvBody = await response.text();
      expect(csvBody).toContain('"SHP-2026-FINAL"');
      expect(csvBody).toContain('"Apex Global Supplies Ltd"');
      expect(csvBody).toContain('"Standard Widget"');

      // Verify transaction recordings
      expect(mockTx.exportEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId: "test-shipment",
          exportedById: executiveUser.id,
          profileId: "demo-v1",
          revision: 1,
        }),
      });

      expect(mockTx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SHIPMENT_EXPORTED",
          entityType: "Shipment",
          entityId: "test-shipment",
          metadata: expect.objectContaining({
            profileId: "demo-v1",
            checksumSha256: expect.any(String),
            rowCount: 1,
          }),
        }),
      });

      expect(mockTx.shipment.update).toHaveBeenCalledWith({
        where: { id: "test-shipment" },
        data: { status: "EXPORTED" },
      });
    });

    it("returns JSON preview when preview=1 without mutating database or updating status", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockShipment = {
        id: "test-shipment",
        reference: "SHP-PREVIEW-001",
        status: "APPROVED",
        currentRevision: 1,
        supplier: { name: "Preview Supplier" },
        documents: [
          {
            docType: "INVOICE",
            extractionRuns: [
              {
                fields: [
                  { fieldKey: "documentNumber", currentValue: "INV-PREVIEW" },
                  { fieldKey: "issueDate", currentValue: "2026-11-01" },
                  { fieldKey: "currency", currentValue: "USD" },
                  { fieldKey: "grossWeight", currentValue: "1000" },
                  { fieldKey: "packageCount", currentValue: "10" },
                ],
                lineItems: [],
              },
            ],
          },
          { docType: "PACKING_LIST", extractionRuns: [{ fields: [{ fieldKey: "grossWeight", currentValue: "1000" }], lineItems: [] }] },
          { docType: "BILL_OF_LADING", extractionRuns: [{ fields: [{ fieldKey: "documentNumber", currentValue: "BL-P" }], lineItems: [] }] },
        ],
      };

      const mockApproval = {
        id: "appr-1",
        revision: 1,
        approvedById: managerUser.id,
        approvedAt: new Date("2026-11-03T10:00:00Z"),
        approvedBy: { email: managerUser.email },
      };

      const mockPrisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(mockShipment) },
        approval: { findUnique: vi.fn().mockResolvedValue(mockApproval) },
        crossCheckResult: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request("http://localhost:3000/api/shipments/test-shipment/export?preview=1");
      const response = await GET(request, { params: Promise.resolve({ id: "test-shipment" }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.headers).toHaveLength(24);
      expect(json.profileId).toBe("demo-v1");
      expect(json.assumptionLabel).toMatch(/\[ASSUMPTION\]/);
      expect(json.checksumSha256).toBeDefined();

      // Ensure transaction is NOT called for preview
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
