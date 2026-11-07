import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET } from "@/app/api/shipments/[id]/export/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import { formatExportBlocker } from "@/lib/export/preview";
import { getExportProfile } from "@/lib/export/csv";
import { exportDocuments, fakeExportDb } from "./helpers/fake-export-db";

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
      expect(profile.version).toBe("1.1.0");
      expect(profile.assumptionLabel).toContain("[ASSUMPTION]");
      expect(profile.assumptionLabel).toContain("demo-v1");
      expect(profile.assumptionLabel).toContain("awaiting client specification");
    });
  });

  describe("Server Preview Endpoint: GET /api/shipments/[id]/export?preview=1", () => {
    const preview = () =>
      GET(new Request("http://localhost:3000/api/shipments/shp-1/export?preview=1"), { params: Promise.resolve({ id: "shp-1" }) });

    function actAs(user: typeof managerUser | typeof executiveUser) {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({ appUser: user as never, authUser: { id: user.id, email: user.email } as never });
    }

    it("returns 422 with structured blockers when the shipment is not approved (Rule 3)", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({ status: "READY_FOR_APPROVAL", approvalRevision: null });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await preview();
      const json = await response.json();

      expect(response.status).toBe(422);
      expect(json).toMatchObject({ ready: false, allowed: false, profileId: "demo-v1", profileVersion: "1.1.0", approvedRevision: null });
      expect(json.assumptionLabel).toContain("[ASSUMPTION]");
      expect(json.blockers).toEqual(["shipment_not_approved", "manager_approval_required"]);
      expect(json.rows).toBeUndefined();
    });

    it("reports a stale approval when the approval is for an earlier revision (Rules 2 & 3)", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({ status: "IN_REVIEW", currentRevision: 2, approvalRevision: 1 });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const json = await (await preview()).json();

      expect(json.ready).toBe(false);
      expect(json.currentRevision).toBe(2);
      // No Approval row exists for revision 2.
      expect(json.blockers).toContain("manager_approval_required");
      expect(json.approvedRevision).toBeNull();
    });

    it("names the checks behind unapproved exceptions and unresolved failures (Rule 3)", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({
        checkResults: [
          {
            id: "c-1",
            ruleKey: "gross_weight_comparison",
            status: "MISMATCH",
            severity: "BLOCKING",
            resolutions: [
              { id: "r-1", type: "ACCEPTED_EXCEPTION", reason: "Supplier confirmed variance", evidence: "TKT-1", managerApprovedAt: null, createdAt: new Date() },
            ],
          },
          { id: "c-2", ruleKey: "invoice_line_total", status: "MISMATCH", severity: "BLOCKING", resolutions: [] },
        ],
      });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const json = await (await preview()).json();

      expect(json.blockers).toEqual(["cross_checks_unresolved", "unapproved_exceptions_present"]);
      expect(json.blockerDetails).toEqual([
        { code: "cross_checks_unresolved", detail: "invoice_line_total" },
        { code: "unapproved_exceptions_present", detail: "gross_weight_comparison" },
      ]);
    });

    it("blocks when no check run exists for the current revision", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({ checkRunRevision: 0 });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      expect((await (await preview()).json()).blockers).toEqual(["cross_checks_not_run"]);
    });

    it("lists every blocker at once, including invalid and missing export fields", async () => {
      actAs(managerUser);
      const documents = exportDocuments({ extraFields: { INVOICE: [{ fieldKey: "issueDate", currentValue: "03/04/2026" }] } });
      documents[0].extractionRuns[0].fields = documents[0].extractionRuns[0].fields.filter(
        (f) => f.fieldKey !== "currency" && !(f.fieldKey === "issueDate" && f.currentValue === "2026-11-02"),
      );
      const { prisma } = fakeExportDb({ status: "READY_FOR_APPROVAL", approvalRevision: null, documents });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const json = await (await preview()).json();

      expect(json.blockers).toEqual([
        "shipment_not_approved",
        "manager_approval_required",
        "missing_field_Currency",
        "invalid_field_Invoice_Date",
      ]);
      expect(json.blockerDetails.find((b: { code: string }) => b.code === "invalid_field_Invoice_Date").detail).toMatch(/ambiguous/);
    });

    it("confirms readiness and shows the first rows of the same CSV mapping (Rules 1, 2, 4, 5)", async () => {
      actAs(executiveUser);
      const lines = Array.from({ length: 12 }, (_, index) => ({
        lineNumber: index + 1,
        description: `Item ${index + 1}`,
        quantity: "1",
        quantityUnit: "PCS",
        unitPrice: "10.00",
        lineTotal: "10.00",
        currency: "USD",
      }));
      const { prisma, tx } = fakeExportDb({ documents: exportDocuments({ lines }) });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await preview();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toMatchObject({
        ready: true,
        allowed: true,
        blockers: [],
        approvedRevision: 1,
        approvedAt: "2026-11-05T12:00:00.000Z",
        approvedBy: "Mona Manager",
        rowCount: 12,
        previewRowLimit: 10,
        fileName: "SHP-2026-001-demo-v1-rev1.csv",
      });
      expect(json.headers).toHaveLength(21);
      expect(json.rows).toHaveLength(10);
      expect(json.rows[0][13]).toBe("3165");
      expect(json.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
      // Preview never writes.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.exportEvent.create).not.toHaveBeenCalled();
    });

    it("surfaces the stored export record (checksum, file, version, rows, actor) and allows a reproducible re-download (Rule 7)", async () => {
      actAs(managerUser);
      const { prisma } = fakeExportDb({
        status: "EXPORTED",
        exportEvents: [
          {
            id: "export-9",
            profileId: "demo-v1",
            profileVersion: "1.1.0",
            revision: 1,
            checksumSha256: "a".repeat(64),
            fileName: "SHP-2026-001-demo-v1-rev1.csv",
            rowCount: 2,
            createdAt: new Date("2026-11-06T09:00:00Z"),
            exportedBy: { email: "manager@cargoverity.test", fullName: "Mona Manager" },
          },
        ],
      });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const json = await (await preview()).json();

      expect(json.ready).toBe(true);
      expect(json.recentExport).toEqual({
        id: "export-9",
        profileId: "demo-v1",
        profileVersion: "1.1.0",
        revision: 1,
        createdAt: "2026-11-06T09:00:00.000Z",
        exportedBy: "Mona Manager",
        checksumSha256: "a".repeat(64),
        fileName: "SHP-2026-001-demo-v1-rev1.csv",
        rowCount: 2,
      });
    });

    it("returns 404 for a shipment outside the user's scope", async () => {
      actAs(executiveUser);
      const { prisma } = fakeExportDb({ visible: false });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await preview();
      expect(response.status).toBe(404);
      expect(prisma.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "shp-1", createdById: executiveUser.id } }),
      );
    });
  });

  describe("Guarded Endpoint Security: Button Manipulation Resistance (Rule 6)", () => {
    it("blocks a direct CSV download with 422 when guards fail, and records nothing", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({ appUser: managerUser as never, authUser: { id: managerUser.id } as never });
      const { prisma, tx } = fakeExportDb({ status: "READY_FOR_APPROVAL", approvalRevision: null });
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const response = await GET(new Request("http://localhost:3000/api/shipments/shp-1/export"), { params: Promise.resolve({ id: "shp-1" }) });
      const json = await response.json();

      expect(response.status).toBe(422);
      expect(json.code).toBe("EXPORT_BLOCKED");
      expect(json.error).toContain("shipment_not_approved");
      expect(tx.exportEvent.create).not.toHaveBeenCalled();
    });
  });
});
