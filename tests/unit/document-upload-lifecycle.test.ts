import { describe, expect, it, vi, beforeEach } from "vitest";

import { POST as postUploadUrlRoute } from "@/app/api/shipments/[id]/documents/upload-url/route";
import { POST as postCompleteRoute } from "@/app/api/shipments/[id]/documents/complete/route";
import * as auth from "@/lib/auth";
import * as db from "@/lib/db";
import * as envModule from "@/lib/env";
import * as supabaseServer from "@/lib/supabase/server";
import {
  detectContentMimeType,
  parsePdfAndCountPages,
  validateStoredDocumentBuffer,
} from "@/lib/documents/validation";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const executiveUser = { id: "33333333-3333-4333-8333-333333333333", email: "exec@example.test", role: "EXECUTIVE" as const };
const otherExecutive = { id: "44444444-4444-4444-8444-444444444444", email: "other@example.test", role: "EXECUTIVE" as const };

function createValidPdfBytes() {
  return new Uint8Array([
    ...new TextEncoder().encode(`%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer <</Size 4 /Root 1 0 R>>
startxref
190
%%EOF`),
  ]);
}

// 1x1 PNG bytes
const validPngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("Document Upload Lifecycle & Validation (Week 2 Step 3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("File Validation Engine (Unit)", () => {
    it("detects valid magic bytes for PDF, PNG, and JPEG", () => {
      expect(detectContentMimeType(createValidPdfBytes())).toBe("application/pdf");
      expect(detectContentMimeType(validPngBytes)).toBe("image/png");
      expect(detectContentMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
      expect(detectContentMimeType(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
    });

    it("rejects invalid MIME / unsupported file types", async () => {
      const textFile = new TextEncoder().encode("Hello, plain text document.");
      await expect(validateStoredDocumentBuffer(textFile)).rejects.toThrow(
        /Unsupported file format or invalid magic bytes/,
      );
    });

    it("rejects wrong magic bytes when declared MIME does not match content", async () => {
      // Declared as PDF, but content is PNG
      await expect(
        validateStoredDocumentBuffer(validPngBytes, "application/pdf"),
      ).rejects.toThrow(/does not match its declared document type/);
    });

    it("rejects empty PDF (0 bytes)", async () => {
      await expect(validateStoredDocumentBuffer(new Uint8Array([]))).rejects.toThrow(
        /The uploaded file is empty/,
      );
      await expect(parsePdfAndCountPages(new Uint8Array([]))).rejects.toThrow(
        /The PDF document is empty/,
      );
    });

    it("rejects oversized file buffer exceeding max bytes limit", async () => {
      vi.spyOn(envModule, "getEnv").mockReturnValue({
        ...envModule.getEnv(),
        MAX_PDF_BYTES: 100, // Artificially small for test
      });

      await expect(validateStoredDocumentBuffer(createValidPdfBytes())).rejects.toThrow(
        /The file exceeds the maximum allowed size/,
      );
    });

    it("rejects corrupted PDF files", async () => {
      const corruptPdf = new TextEncoder().encode("%PDF-1.4\ncorrupted trailer without xref");
      await expect(parsePdfAndCountPages(corruptPdf)).rejects.toThrow(
        /Corrupted or invalid PDF file/,
      );
    });

    it("parses valid PDF and counts pages correctly", async () => {
      const pages = await parsePdfAndCountPages(createValidPdfBytes());
      expect(pages).toBe(1);
    });
  });

  describe("POST /api/shipments/[id]/documents/upload-url", () => {
    it("rejects unauthenticated requests with 401", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "INVOICE",
          declaredMimeType: "application/pdf",
        }),
      });

      const response = await postUploadUrlRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(401);
    });

    it("rejects unauthorized shipment access with 400", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: otherExecutive as never,
        authUser: { id: otherExecutive.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "INVOICE",
          declaredMimeType: "application/pdf",
        }),
      });

      const response = await postUploadUrlRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Shipment not found or inaccessible.");
    });

    it("rejects stale revision with 409 STALE_REVISION", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 5 }) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "INVOICE",
          declaredMimeType: "application/pdf",
          expectedRevision: 4, // Stale!
        }),
      });

      const response = await postUploadUrlRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("STALE_REVISION");
    });

    it("rejects invalid MIME type with 400 INVALID_MIME", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "INVOICE",
          declaredMimeType: "application/zip",
        }),
      });

      const response = await postUploadUrlRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("INVALID_MIME");
    });

    it("rejects declared oversized file with 413 FILE_OVERSIZED", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "INVOICE",
          declaredMimeType: "application/pdf",
          fileSizeBytes: 20_000_000, // 20 MB exceeds 10 MB limit
        }),
      });

      const response = await postUploadUrlRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(413);
      const json = await response.json();
      expect(json.code).toBe("FILE_OVERSIZED");
    });
  });

  describe("POST /api/shipments/[id]/documents/complete", () => {
    it("rejects unauthorized shipment access with 400", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: otherExecutive as never,
        authUser: { id: otherExecutive.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Shipment not found or inaccessible.");
    });

    it("rejects stale revision with 409 STALE_REVISION", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 3 }) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
          expectedRevision: 2, // Stale!
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("STALE_REVISION");
    });

    it("rejects duplicate completion with 409 DUPLICATE_COMPLETION", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }) },
        document: {
          findUnique: vi.fn().mockResolvedValue({ id: documentId, documentVersion: 1 }),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("DUPLICATE_COMPLETION");
    });

    it("returns 404 OBJECT_NOT_FOUND when file does not exist in storage", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });
      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }) },
        document: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({ data: null, error: new Error("Not found") }),
          }),
        },
      };
      vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(mockSupabase as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.code).toBe("OBJECT_NOT_FOUND");
    });

    it("rejects duplicate content with 409 DUPLICATE_CONTENT when SHA-256 matches current version", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });

      // Calculate sha of minimalValidPdf
      const { createHash } = await import("node:crypto");
      const pdfBytes = createValidPdfBytes();
      const sha256 = createHash("sha256").update(pdfBytes).digest("hex");

      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }) },
        document: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue({
            id: "old-doc-id",
            selectedDocType: "INVOICE",
            isCurrent: true,
            sha256, // Same SHA!
          }),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: new Blob([pdfBytes]),
              error: null,
            }),
          }),
        },
      };
      vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(mockSupabase as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
          allowReplacement: true,
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("DUPLICATE_CONTENT");
    });

    it("rejects with 409 REPLACEMENT_REQUIRED when current document exists and allowReplacement is false", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });

      const prisma = {
        shipment: { findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }) },
        document: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue({
            id: "old-doc-id",
            selectedDocType: "INVOICE",
            isCurrent: true,
            sha256: "different-sha256",
          }),
        },
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: new Blob([createValidPdfBytes()]),
              error: null,
            }),
          }),
        },
      };
      vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(mockSupabase as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
          allowReplacement: false, // Replacement not confirmed!
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("REPLACEMENT_REQUIRED");
    });

    it("successfully creates initial document version, increments revision, and records audit event", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });

      const prisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 1 }),
          update: vi.fn().mockResolvedValue({ id: shipmentId, currentRevision: 2, status: "IN_REVIEW" }),
        },
        document: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null), // No existing document
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({
            id: documentId,
            shipmentId,
            docType: "INVOICE",
            selectedDocType: "INVOICE",
            documentVersion: 1,
            isCurrent: true,
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: new Blob([createValidPdfBytes()]),
              error: null,
            }),
          }),
        },
      };
      vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(mockSupabase as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice.pdf",
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.document.id).toBe(documentId);
      expect(json.document.documentVersion).toBe(1);
      expect(json.shipmentRevision).toBe(2);

      expect(prisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: { status: "IN_REVIEW", currentRevision: 2 },
      });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId,
          action: "DOCUMENT_UPLOADED",
          entityId: documentId,
        }),
      });
    });

    it("successfully replaces existing document version (version 2), increments revision, and records replacement audit event", async () => {
      vi.spyOn(auth, "requireAppUser").mockResolvedValue({
        appUser: executiveUser as never,
        authUser: { id: executiveUser.id } as never,
      });

      const existingDoc = {
        id: "v1-doc-id",
        selectedDocType: "INVOICE",
        documentVersion: 1,
        isCurrent: true,
        sha256: "old-sha256-hash",
      };

      const prisma = {
        shipment: {
          findFirst: vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, currentRevision: 2 }),
          update: vi.fn().mockResolvedValue({ id: shipmentId, currentRevision: 3, status: "IN_REVIEW" }),
        },
        document: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(existingDoc),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({
            id: documentId,
            shipmentId,
            docType: "INVOICE",
            selectedDocType: "INVOICE",
            documentVersion: 2,
            isCurrent: true,
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-2" }),
        },
        $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      };
      vi.spyOn(db, "getPrisma").mockReturnValue(prisma as never);

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: new Blob([createValidPdfBytes()]),
              error: null,
            }),
          }),
        },
      };
      vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(mockSupabase as never);

      const request = new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/file.pdf`,
          documentType: "INVOICE",
          originalFileName: "invoice-revised.pdf",
          allowReplacement: true,
        }),
      });

      const response = await postCompleteRoute(request, { params: Promise.resolve({ id: shipmentId }) });
      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.document.id).toBe(documentId);
      expect(json.document.documentVersion).toBe(2);
      expect(json.shipmentRevision).toBe(3);

      expect(prisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: { status: "IN_REVIEW", currentRevision: 3 },
      });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shipmentId,
          action: "DOCUMENT_REPLACED",
          entityId: documentId,
        }),
      });
    });
  });
});
