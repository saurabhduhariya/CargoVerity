import { describe, expect, it, vi, beforeEach } from "vitest";

import { POST as postLoadSampleRoute } from "@/app/api/shipments/[id]/load-sample/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as supabaseServer from "@/lib/supabase/server";
import { loadSampleDocumentsIntoShipment } from "@/lib/documents/sample-loader";
import {
  declaredMimeForFile,
  describeUploadLimits,
  formatPlainLanguageError,
} from "@/features/documents/shipment-document-slots";

import { createFakeDb, createFakeStorage } from "./helpers/fake-upload-env";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const executiveUser = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "exec@example.test",
  role: "EXECUTIVE" as const,
};

function setup(revision = 1, status = "DRAFT") {
  const fakeDb = createFakeDb({
    shipments: [{ id: shipmentId, reference: "SHP-SAMPLE", createdById: executiveUser.id, status, currentRevision: revision }],
  });
  const storage = createFakeStorage();
  vi.spyOn(db, "getPrisma").mockReturnValue(fakeDb.prisma as never);
  vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(storage.supabaseAdmin as never);
  return { ...fakeDb, storage };
}

describe("Synthetic Sample Loader & Upload UI (Week 2 Step 5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadSampleDocumentsIntoShipment Service", () => {
    it("stores and validates all 3 fixtures privately as one shipment revision", async () => {
      const { prisma, state, storage } = setup();

      const result = await loadSampleDocumentsIntoShipment(prisma as never, {
        shipmentId,
        appUser: executiveUser,
        scenario: "SHP-24811",
      });

      expect(result.documents.map((d) => d.docType).sort()).toEqual(["BILL_OF_LADING", "INVOICE", "PACKING_LIST"]);
      expect(storage.objects.size).toBe(3);
      for (const key of storage.objects.keys()) {
        expect(key).toMatch(new RegExp(`^shipments/${shipmentId}/documents/[0-9a-f-]{36}/[0-9a-f-]{36}\\.pdf$`));
        expect(key).not.toContain("shp-24811");
      }
      for (const document of result.documents) {
        expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(document.pageCount).toBeGreaterThanOrEqual(1);
        expect(document.mimeType).toBe("application/pdf");
      }

      // One revision for the whole load, with per-document and load-level audit events.
      expect(state.shipments[0]).toMatchObject({ currentRevision: 2, status: "IN_REVIEW" });
      expect(result.shipment.currentRevision).toBe(2);
      expect(state.audits.map((a) => a.action).sort()).toEqual([
        "DOCUMENT_UPLOADED",
        "DOCUMENT_UPLOADED",
        "DOCUMENT_UPLOADED",
        "SAMPLE_DOCUMENTS_LOADED",
      ]);
    });

    it("rejects loading the same scenario twice and replaces versions for a different scenario", async () => {
      const { prisma, state } = setup();
      await loadSampleDocumentsIntoShipment(prisma as never, { shipmentId, appUser: executiveUser, scenario: "SHP-24811" });

      await expect(
        loadSampleDocumentsIntoShipment(prisma as never, { shipmentId, appUser: executiveUser, scenario: "SHP-24811" }),
      ).rejects.toMatchObject({ code: "DUPLICATE_CONTENT" });

      await loadSampleDocumentsIntoShipment(prisma as never, { shipmentId, appUser: executiveUser, scenario: "SHP-24813" });
      const current = state.documents.filter((d) => d.isCurrent);
      expect(current).toHaveLength(3);
      expect(current.every((d) => d.documentVersion === 2)).toBe(true);
      expect(state.documents).toHaveLength(6);
      expect(state.shipments[0].currentRevision).toBe(3);
    });

    it("rejects a stale expected revision and leaves no stored objects behind", async () => {
      const { prisma, state, storage } = setup(4);
      await expect(
        loadSampleDocumentsIntoShipment(prisma as never, {
          shipmentId,
          appUser: executiveUser,
          scenario: "SHP-24811",
          expectedRevision: 3,
        }),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
      expect(state.documents).toHaveLength(0);
      expect(storage.objects.size).toBe(0);
    });

    it("rejects unknown scenario with a clear error", async () => {
      const { prisma } = setup();
      await expect(
        loadSampleDocumentsIntoShipment(prisma as never, {
          shipmentId,
          appUser: executiveUser,
          scenario: "UNKNOWN_SCENARIO" as never,
        }),
      ).rejects.toThrow(/Unknown sample scenario/);
    });

    it("rejects loading samples into another user's shipment", async () => {
      const { prisma, storage } = setup();
      await expect(
        loadSampleDocumentsIntoShipment(prisma as never, {
          shipmentId,
          appUser: { id: "44444444-4444-4444-8444-444444444444", role: "EXECUTIVE" },
          scenario: "SHP-24811",
        }),
      ).rejects.toThrow(/Shipment not found or inaccessible/);
      expect(storage.objects.size).toBe(0);
    });
  });

  describe("POST /api/shipments/[id]/load-sample Route Handler", () => {
    const request = (body: unknown) =>
      new Request(`http://localhost:3000/api/shipments/${shipmentId}/load-sample`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const params = { params: Promise.resolve({ id: shipmentId }) };
    const signIn = () =>
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

    it("returns 401 when unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
      const response = await postLoadSampleRoute(request({ scenario: "SHP-24811" }), params);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: "Authentication required." });
    });

    it("returns 400 when scenario is invalid", async () => {
      signIn();
      const response = await postLoadSampleRoute(request({ scenario: "INVALID-SCENARIO" }), params);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("INVALID_SCENARIO");
      expect(json.error).toMatch(/Expected one of SHP-24811/);
    });

    it("returns 400 when user is not authorized for the shipment", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: { id: "44444444-4444-4444-8444-444444444444", role: "EXECUTIVE" } as never,
        authUser: {} as never,
      });
      setup();
      const response = await postLoadSampleRoute(request({ scenario: "SHP-24811" }), params);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/not found or inaccessible/) });
    });

    it("returns 409 STALE_REVISION when the page's revision is out of date", async () => {
      signIn();
      setup(2);
      const response = await postLoadSampleRoute(request({ scenario: "SHP-24811", expectedRevision: 1 }), params);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "STALE_REVISION" });
    });

    it("returns 200 with loaded documents and the new shipment revision", async () => {
      signIn();
      setup();
      const response = await postLoadSampleRoute(request({ scenario: "SHP-24811", expectedRevision: 1 }), params);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.documents).toHaveLength(3);
      expect(json.shipment.currentRevision).toBe(2);
      expect(json.message).toContain("SHP-24811");
    });
  });

  describe("Upload UI helpers", () => {
    it("translates recognized server error codes into friendly user messages", () => {
      expect(formatPlainLanguageError("STALE_REVISION")).toMatch(/revision is out of date/);
      expect(formatPlainLanguageError("DUPLICATE_CONTENT")).toMatch(/exact document file/);
      expect(formatPlainLanguageError("DUPLICATE_COMPLETION")).toMatch(/already been processed/);
      expect(formatPlainLanguageError("REPLACEMENT_REQUIRED")).toMatch(/Replace existing document/);
      expect(formatPlainLanguageError("FILE_OVERSIZED")).toMatch(/maximum allowed size/);
      expect(formatPlainLanguageError("EMPTY_FILE")).toMatch(/0 bytes/);
      expect(formatPlainLanguageError("CORRUPTED_PDF")).toMatch(/corrupted or could not be parsed/);
      expect(formatPlainLanguageError("PAGE_LIMIT_EXCEEDED")).toMatch(/more pages than the limit/);
      expect(formatPlainLanguageError("PASSWORD_PROTECTED_PDF")).toMatch(/Password-protected/);
      expect(formatPlainLanguageError("INVALID_MAGIC_BYTES")).toMatch(/genuine PDF or image/);
      expect(formatPlainLanguageError("INVALID_MIME")).toMatch(/Only PDF/);
      expect(formatPlainLanguageError("OBJECT_NOT_FOUND")).toMatch(/private storage/);
      expect(formatPlainLanguageError("INVALID_STORAGE_KEY")).toMatch(/upload the file again/);
      expect(formatPlainLanguageError("SHIPMENT_LOCKED")).toMatch(/exported/);
      expect(formatPlainLanguageError("STORAGE_UNAVAILABLE")).toMatch(/temporarily unavailable/);
      expect(formatPlainLanguageError("UNAUTHORIZED")).toMatch(/do not have permission/);
    });

    it("falls back to the raw message but never shows machine output", () => {
      expect(formatPlainLanguageError("CUSTOM_ERR", "Something custom broke")).toBe("Something custom broke");
      expect(formatPlainLanguageError(undefined, '[{"code":"invalid_type","path":["documentType"]}]')).toBe(
        "An unexpected error occurred during document upload.",
      );
      expect(formatPlainLanguageError(undefined, undefined)).toBe(
        "An unexpected error occurred during document upload.",
      );
    });

    it("maps picked files to the MIME type the server verifies", () => {
      expect(declaredMimeForFile({ name: "a.PDF", type: "" })).toBe("application/pdf");
      expect(declaredMimeForFile({ name: "scan", type: "image/png" })).toBe("image/png");
      expect(declaredMimeForFile({ name: "photo.jpeg", type: "" })).toBe("image/jpeg");
      expect(declaredMimeForFile({ name: "archive.zip", type: "application/zip" })).toBeNull();
    });

    it("describes the configured limits instead of hard-coded numbers", () => {
      expect(describeUploadLimits({ maxPdfBytes: 5 * 1024 * 1024, maxImageBytes: 2 * 1024 * 1024, maxPdfPages: 20 })).toBe(
        "PDF up to 5.0 MB and 20 pages · PNG/JPEG up to 2.0 MB",
      );
    });
  });
});
