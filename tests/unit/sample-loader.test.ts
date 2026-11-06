import { describe, expect, it, vi, beforeEach } from "vitest";

import { POST as postLoadSampleRoute } from "@/app/api/shipments/[id]/load-sample/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as storage from "@/lib/documents/storage";
import * as documentService from "@/lib/documents/service";
import * as validation from "@/lib/documents/validation";
import { loadSampleDocumentsIntoShipment } from "@/lib/documents/sample-loader";
import { formatPlainLanguageError } from "@/features/documents/shipment-document-slots";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const executiveUser = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "exec@example.test",
  role: "EXECUTIVE" as const,
};
const otherExecutive = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "other@example.test",
  role: "EXECUTIVE" as const,
};

describe("Synthetic Sample Loader & Upload UI (Week 2 Step 5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadSampleDocumentsIntoShipment Service", () => {
    it("exercises private storage upload and server validation for all 3 documents", async () => {
      const mockShipment = {
        id: shipmentId,
        reference: "SHP-24811",
        status: "DRAFT",
        currentRevision: 1,
        createdById: executiveUser.id,
      };

      const updatedShipment = {
        ...mockShipment,
        status: "IN_REVIEW",
        currentRevision: 2,
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue(mockShipment),
          update: vi.fn().mockResolvedValue(updatedShipment),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };

      const validateSpy = vi
        .spyOn(validation, "validateStoredDocumentBuffer")
        .mockResolvedValue({
          mimeType: "application/pdf",
          sizeBytes: 12345,
          sha256: "dummy-sha256-hash",
          pageCount: 2,
        });

      const uploadBufferSpy = vi
        .spyOn(storage, "uploadDocumentBuffer")
        .mockResolvedValue(undefined);

      const createDocSpy = vi
        .spyOn(documentService, "createDocumentVersion")
        .mockImplementation(async (_prisma, input) => {
          return {
            id: input.id ?? "doc-id",
            shipmentId: input.shipmentId,
            docType: input.selectedDocType,
            selectedDocType: input.selectedDocType,
            detectedDocType: null,
            typeMismatch: false,
            documentVersion: 1,
            isCurrent: true,
            storageKey: input.storageKey,
            originalFileName: input.originalFileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            pageCount: input.pageCount ?? null,
            uploadedById: input.uploadedById,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never;
        });

      const result = await loadSampleDocumentsIntoShipment(mockPrisma as never, {
        shipmentId,
        appUser: executiveUser,
        scenario: "SHP-24811",
      });

      // 1. Should have processed 3 fixtures (INVOICE, PACKING_LIST, BILL_OF_LADING)
      expect(result.documents).toHaveLength(3);
      expect(validateSpy).toHaveBeenCalledTimes(3);
      expect(uploadBufferSpy).toHaveBeenCalledTimes(3);
      expect(createDocSpy).toHaveBeenCalledTimes(3);

      // 2. Storage keys must be safe (not original client names directly)
      for (const call of uploadBufferSpy.mock.calls) {
        expect(call[0].storageKey).toMatch(new RegExp(`^shipments/${shipmentId}/documents/`));
        expect(call[0].mimeType).toBe("application/pdf");
      }

      // 3. Document types must match the 3 required types
      const docTypes = result.documents.map((d) => d.docType);
      expect(docTypes).toContain("INVOICE");
      expect(docTypes).toContain("PACKING_LIST");
      expect(docTypes).toContain("BILL_OF_LADING");

      // 4. Shipment revision incremented and status set to IN_REVIEW
      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: "IN_REVIEW",
          currentRevision: { increment: 1 },
        },
      });
      expect(result.shipment.currentRevision).toBe(2);

      // 5. Audit event recorded
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId,
          actorId: executiveUser.id,
          action: "SAMPLE_DOCUMENTS_LOADED",
          entityType: "Shipment",
          entityId: shipmentId,
        }),
      });
    });

    it("rejects unknown scenario with a clear error", async () => {
      const mockShipment = {
        id: shipmentId,
        reference: "SHP-99999",
        status: "DRAFT",
        currentRevision: 1,
        createdById: executiveUser.id,
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue(mockShipment),
        },
      };

      await expect(
        loadSampleDocumentsIntoShipment(mockPrisma as never, {
          shipmentId,
          appUser: executiveUser,
          scenario: "UNKNOWN_SCENARIO" as never,
        }),
      ).rejects.toThrow(/Unknown sample scenario/);
    });

    it("rejects unauthorized user attempting to load samples into another user's shipment", async () => {
      const mockShipment = {
        id: shipmentId,
        reference: "SHP-24811",
        status: "DRAFT",
        currentRevision: 1,
        createdById: otherExecutive.id, // belongs to other user
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue(null), // simulate not found for executiveUser
        },
      };

      await expect(
        loadSampleDocumentsIntoShipment(mockPrisma as never, {
          shipmentId,
          appUser: executiveUser,
          scenario: "SHP-24811",
        }),
      ).rejects.toThrow(/Shipment not found or inaccessible/);
    });
  });

  describe("POST /api/shipments/[id]/load-sample Route Handler", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/load-sample`, {
        method: "POST",
        body: JSON.stringify({ scenario: "SHP-24811" }),
      });

      const response = await postLoadSampleRoute(request, {
        params: Promise.resolve({ id: shipmentId }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Authentication required.");
    });

    it("returns 400 when scenario is invalid", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/load-sample`, {
        method: "POST",
        body: JSON.stringify({ scenario: "INVALID-SCENARIO" }),
      });

      const response = await postLoadSampleRoute(request, {
        params: Promise.resolve({ id: shipmentId }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("INVALID_SCENARIO");
      expect(json.error).toMatch(/Expected one of SHP-24811/);
    });

    it("returns 400 when user is not authorized for the shipment", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue(null), // Unauthorized
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/load-sample`, {
        method: "POST",
        body: JSON.stringify({ scenario: "SHP-24811" }),
      });

      const response = await postLoadSampleRoute(request, {
        params: Promise.resolve({ id: shipmentId }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Shipment not found or inaccessible/);
    });

    it("returns 200 with loaded documents and shipment on success", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id, email: executiveUser.email } as never,
      });

      const mockShipment = {
        id: shipmentId,
        reference: "SHP-24811",
        status: "DRAFT",
        currentRevision: 1,
        createdById: executiveUser.id,
      };

      const updatedShipment = {
        ...mockShipment,
        status: "IN_REVIEW",
        currentRevision: 2,
      };

      const mockPrisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue(mockShipment),
          update: vi.fn().mockResolvedValue(updatedShipment),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

      vi.spyOn(validation, "validateStoredDocumentBuffer").mockResolvedValue({
        mimeType: "application/pdf",
        sizeBytes: 12345,
        sha256: "dummy-sha256",
        pageCount: 2,
      });

      vi.spyOn(storage, "uploadDocumentBuffer").mockResolvedValue(undefined);

      vi.spyOn(documentService, "createDocumentVersion").mockImplementation(
        async (_prisma, input) => {
          return {
            id: input.id ?? "doc-id",
            shipmentId: input.shipmentId,
            docType: input.selectedDocType,
            selectedDocType: input.selectedDocType,
            detectedDocType: null,
            typeMismatch: false,
            documentVersion: 1,
            isCurrent: true,
            storageKey: input.storageKey,
            originalFileName: input.originalFileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            pageCount: input.pageCount ?? null,
            uploadedById: input.uploadedById,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never;
        },
      );

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/load-sample`, {
        method: "POST",
        body: JSON.stringify({ scenario: "SHP-24811" }),
      });

      const response = await postLoadSampleRoute(request, {
        params: Promise.resolve({ id: shipmentId }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.documents).toHaveLength(3);
      expect(json.shipment.currentRevision).toBe(2);
      expect(json.message).toContain("SHP-24811");
    });
  });

  describe("formatPlainLanguageError Formatter", () => {
    it("translates all recognized server error codes into friendly user messages", () => {
      expect(formatPlainLanguageError("STALE_REVISION")).toMatch(/revision is out of date/);
      expect(formatPlainLanguageError("DUPLICATE_CONTENT")).toMatch(/exact document file/);
      expect(formatPlainLanguageError("DUPLICATE_COMPLETION")).toMatch(/already been processed/);
      expect(formatPlainLanguageError("REPLACEMENT_REQUIRED")).toMatch(/Replace existing document/);
      expect(formatPlainLanguageError("FILE_OVERSIZED")).toMatch(/maximum allowed size/);
      expect(formatPlainLanguageError("EMPTY_FILE")).toMatch(/0 bytes/);
      expect(formatPlainLanguageError("CORRUPTED_PDF")).toMatch(/corrupted or could not be parsed/);
      expect(formatPlainLanguageError("PAGE_LIMIT_EXCEEDED")).toMatch(/50 pages/);
      expect(formatPlainLanguageError("PASSWORD_PROTECTED_PDF")).toMatch(/Password-protected/);
      expect(formatPlainLanguageError("INVALID_MAGIC_BYTES")).toMatch(/genuine PDF or image/);
      expect(formatPlainLanguageError("INVALID_MIME")).toMatch(/Only PDF/);
      expect(formatPlainLanguageError("OBJECT_NOT_FOUND")).toMatch(/private storage/);
      expect(formatPlainLanguageError("UNAUTHORIZED")).toMatch(/do not have permission/);
    });

    it("falls back to raw message or default when error code is unrecognized", () => {
      expect(formatPlainLanguageError("CUSTOM_ERR", "Something custom broke")).toBe(
        "Something custom broke",
      );
      expect(formatPlainLanguageError(undefined, undefined)).toBe(
        "An unexpected error occurred during document upload.",
      );
    });
  });
});
