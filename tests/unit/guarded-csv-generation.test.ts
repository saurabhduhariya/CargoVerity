import { createHash } from "node:crypto";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET } from "@/app/api/shipments/[id]/export/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { canExport } from "@/lib/export/guard";
import { buildDemoV1Export, sanitizeCsvCell, escapeCsvCell } from "@/lib/export/csv";
import { fakeExportDb } from "./helpers/fake-export-db";

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
    const download = () =>
      GET(new Request("http://localhost:3000/api/shipments/shp-1/export"), { params: Promise.resolve({ id: "shp-1" }) });

    function actAs(user: typeof managerUser | typeof executiveUser) {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({ appUser: user as never, authUser: { id: user.id, email: user.email } as never });
    }

    it("blocks export with 422 when the shipment is not approved", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({ status: "NEEDS_REVIEW", approvalRevision: null });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await download();
      const json = await response.json();

      expect(response.status).toBe(422);
      expect(json.error).toMatch(/export blocked.*shipment_not_approved/i);
    });

    it("exports the CSV, records profile version + checksum + file + rows on the ExportEvent, and moves to EXPORTED atomically (Rules 16 & 17)", async () => {
      actAs(executiveUser);
      const { prisma, tx } = fakeExportDb();
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await download();
      const csv = await response.text();
      const checksum = createHash("sha256").update(csv, "utf-8").digest("hex");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="SHP-2026-001-demo-v1-rev1.csv"');
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Checksum-Sha256")).toBe(checksum);
      expect(csv.split("\r\n")[0]).toContain('"Shipment_Ref","Supplier_Name"');

      expect(tx.shipment.updateMany).toHaveBeenCalledWith({
        where: { id: "shp-1", currentRevision: 1, status: { in: ["APPROVED", "EXPORTED"] } },
        data: { status: "EXPORTED" },
      });
      expect(tx.exportEvent.create).toHaveBeenCalledWith({
        data: {
          shipmentId: "shp-1",
          exportedById: executiveUser.id,
          profileId: "demo-v1",
          profileVersion: "1.1.0",
          checksumSha256: checksum,
          fileName: "SHP-2026-001-demo-v1-rev1.csv",
          rowCount: 2,
          revision: 1,
        },
      });
      expect(tx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SHIPMENT_EXPORTED",
          actorId: executiveUser.id,
          metadata: expect.objectContaining({ checksumSha256: checksum, profileVersion: "1.1.0", revision: 1, previousStatus: "APPROVED", reExport: false }),
        }),
      });
    });

    it("returns 409 and no file when the shipment changed between the guard and the record", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({ lockCount: 0 });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await download();

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("STALE_REVISION");
    });

    it("re-downloading an EXPORTED shipment at the same revision gives byte-identical CSV", async () => {
      actAs(managerUser);
      const first = fakeExportDb();
      vi.spyOn(db, "getPrisma").mockReturnValue(first.prisma as never);
      const csvA = await (await download()).text();

      const second = fakeExportDb({ status: "EXPORTED" });
      vi.spyOn(db, "getPrisma").mockReturnValue(second.prisma as never);
      const response = await download();
      const csvB = await response.text();

      expect(response.status).toBe(200);
      expect(csvB).toBe(csvA);
      expect(second.tx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: expect.objectContaining({ reExport: true, previousStatus: "EXPORTED" }) }),
      });
    });

    it("ignores newer non-completed extraction runs by querying only COMPLETED runs", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb();
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      await download();

      const query = prisma.shipment.findFirst.mock.calls[0][0] as {
        include: { documents: { where: unknown; include: { extractionRuns: { where: unknown } } } };
      };
      expect(query.include.documents.where).toEqual({ isCurrent: true });
      expect(query.include.documents.include.extractionRuns.where).toEqual({ status: "COMPLETED" });
    });

    it("returns JSON preview when preview=1 without mutating the database", async () => {
      actAs(managerUser);
      const { prisma, tx } = fakeExportDb();
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await GET(new Request("http://localhost:3000/api/shipments/shp-1/export?preview=1"), {
        params: Promise.resolve({ id: "shp-1" }),
      });

      expect(response.status).toBe(200);
      expect((await response.json()).ready).toBe(true);
      expect(tx.shipment.updateMany).not.toHaveBeenCalled();
      expect(tx.exportEvent.create).not.toHaveBeenCalled();
    });
  });
});
