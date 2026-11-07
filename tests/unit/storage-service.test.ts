import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  authorizeDocumentAccess,
  authorizeShipmentAccess,
  buildStorageKey,
  createSignedDownloadUrl,
  DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS,
  ensurePrivateStorageBucket,
  getAuthorizedDocumentDownloadUrl,
  sanitizeFileExtension,
} from "@/lib/documents/storage";
import { issueUploadCapability } from "@/lib/documents/upload-service";

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const executiveUser = { id: "33333333-3333-4333-8333-333333333333", role: "EXECUTIVE" as const };
const otherExecutive = { id: "44444444-4444-4444-8444-444444444444", role: "EXECUTIVE" as const };
const managerUser = { id: "55555555-5555-4555-8555-555555555555", role: "MANAGER" as const };

describe("Private Storage Service — Object Keys (Week 2 Step 2)", () => {
  it("generates an object key following the shipments/<shipment-id>/documents/<document-id>/<random-file-name>.<ext> pattern", () => {
    const key = buildStorageKey({
      shipmentId,
      documentId,
      originalFileName: "commercial_invoice_24811.pdf",
    });

    const regex = /^shipments\/11111111-1111-4111-8111-111111111111\/documents\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]+\.pdf$/;
    expect(key).toMatch(regex);
  });

  it("never includes the original customer filename in the storage key", () => {
    const sensitiveFileNames = [
      "Acme_Confidential_Invoice_9999.pdf",
      "secret-pricing-packing-list.xlsx",
      "BillOfLading_InternalCopy_Only.PDF",
      "customs_declaration_draft.jpg",
    ];

    for (const originalFileName of sensitiveFileNames) {
      const key = buildStorageKey({
        shipmentId,
        documentId,
        originalFileName,
      });

      expect(key.toLowerCase()).not.toContain("acme");
      expect(key.toLowerCase()).not.toContain("confidential");
      expect(key.toLowerCase()).not.toContain("secret");
      expect(key.toLowerCase()).not.toContain("pricing");
      expect(key.toLowerCase()).not.toContain("billoflading");
      expect(key.toLowerCase()).not.toContain("customs_declaration");
    }
  });

  it("sanitizes file extensions and prevents directory traversal", () => {
    expect(sanitizeFileExtension("invoice.PDF")).toBe("pdf");
    expect(sanitizeFileExtension("../../etc/passwd.png")).toBe("png");
    expect(sanitizeFileExtension("no-extension")).toBe("noextension");
    expect(sanitizeFileExtension("malicious/path/scan.jpeg")).toBe("jpeg");
    expect(sanitizeFileExtension("")).toBe("bin");

    expect(() =>
      buildStorageKey({
        shipmentId: "../../../etc",
        documentId,
      }),
    ).toThrow("Invalid shipment ID");

    expect(() =>
      buildStorageKey({
        shipmentId,
        documentId: "../../root",
      }),
    ).toThrow("Invalid document ID");
  });
});

describe("Private Storage Service — Bucket Privacy (Week 2 Step 2)", () => {
  it("verifies that existing bucket is private", async () => {
    const mockSupabase = {
      storage: {
        getBucket: vi.fn().mockResolvedValue({
          data: { id: "shipment-documents", public: false },
          error: null,
        }),
        createBucket: vi.fn(),
      },
    };

    const result = await ensurePrivateStorageBucket(mockSupabase as never, "shipment-documents");
    expect(result).toEqual({ bucketName: "shipment-documents", created: false, isPublic: false });
    expect(mockSupabase.storage.createBucket).not.toHaveBeenCalled();
  });

  it("throws an error if the bucket is configured as public", async () => {
    const mockSupabase = {
      storage: {
        getBucket: vi.fn().mockResolvedValue({
          data: { id: "shipment-documents", public: true },
          error: null,
        }),
        createBucket: vi.fn(),
      },
    };

    await expect(
      ensurePrivateStorageBucket(mockSupabase as never, "shipment-documents"),
    ).rejects.toThrow(/configured as public/);
  });

  it("creates a private bucket (public: false) if it does not exist", async () => {
    const mockSupabase = {
      storage: {
        getBucket: vi.fn().mockResolvedValue({ data: null, error: new Error("Not found") }),
        createBucket: vi.fn().mockResolvedValue({ data: { name: "shipment-documents" }, error: null }),
      },
    };

    const result = await ensurePrivateStorageBucket(mockSupabase as never, "shipment-documents");
    expect(result).toEqual({ bucketName: "shipment-documents", created: true, isPublic: false });
    expect(mockSupabase.storage.createBucket).toHaveBeenCalledWith("shipment-documents", { public: false });
  });
});

describe("Private Storage Service — Authorization & Signed URLs (Week 2 Step 2)", () => {
  it("allows shipment owner to access shipment", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id });
    const prisma = { shipment: { findFirst } } as unknown as PrismaClient;

    const shipment = await authorizeShipmentAccess(prisma, shipmentId, executiveUser);
    expect(shipment).toBeDefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: shipmentId, createdById: executiveUser.id },
    });
  });

  it("blocks an executive from accessing another user's shipment", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { shipment: { findFirst } } as unknown as PrismaClient;

    await expect(authorizeShipmentAccess(prisma, shipmentId, otherExecutive)).rejects.toThrow(
      "Shipment not found or inaccessible.",
    );
  });

  it("allows a manager to access any shipment", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: shipmentId, createdById: executiveUser.id });
    const prisma = { shipment: { findFirst } } as unknown as PrismaClient;

    const shipment = await authorizeShipmentAccess(prisma, shipmentId, managerUser);
    expect(shipment).toBeDefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: shipmentId },
    });
  });

  it("authorizes document access scoped by role and owner", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: documentId,
      shipment: { id: shipmentId, createdById: executiveUser.id },
    });
    const prisma = { document: { findFirst } } as unknown as PrismaClient;

    // Executive accesses their document
    await authorizeDocumentAccess(prisma, documentId, executiveUser);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: documentId, shipment: { createdById: executiveUser.id } },
      }),
    );

    // Manager accesses document
    await authorizeDocumentAccess(prisma, documentId, managerUser);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: documentId, shipment: undefined },
      }),
    );
  });

  it("creates short-lived signed download URLs with default 300s TTL and does not log URLs", async () => {
    const logSpy = vi.spyOn(console, "log");
    const infoSpy = vi.spyOn(console, "info");

    const mockSupabase = {
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/shipment-documents/key?token=secret123" },
            error: null,
          }),
        }),
      },
    };

    const signedUrl = await createSignedDownloadUrl({
      storageKey: `shipments/${shipmentId}/documents/${documentId}/abc.pdf`,
      bucket: "shipment-documents",
      supabaseAdmin: mockSupabase as never,
    });

    expect(signedUrl).toBe("https://example.supabase.co/storage/v1/object/sign/shipment-documents/key?token=secret123");
    expect(mockSupabase.storage.from("shipment-documents").createSignedUrl).toHaveBeenCalledWith(
      `shipments/${shipmentId}/documents/${documentId}/abc.pdf`,
      DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS,
    );

    // Ensure signed URLs and document content are not written to logs (Requirement 6)
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("getAuthorizedDocumentDownloadUrl returns signed URL for authorized user and null for unauthorized", async () => {
    const mockSupabase = {
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://example.supabase.co/storage/signed-preview" },
            error: null,
          }),
        }),
      },
    };

    // 1. Authorized case
    const authorizedPrisma = {
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: documentId,
          storageKey: `shipments/${shipmentId}/documents/${documentId}/abc.pdf`,
          shipment: { id: shipmentId, createdById: executiveUser.id },
        }),
      },
    } as unknown as PrismaClient;

    const result = await getAuthorizedDocumentDownloadUrl(authorizedPrisma, {
      documentId,
      appUser: executiveUser,
      supabaseAdmin: mockSupabase as never,
      bucket: "shipment-documents",
    });

    expect(result).not.toBeNull();
    expect(result?.signedUrl).toBe("https://example.supabase.co/storage/signed-preview");

    // 2. Unauthorized case (other user's shipment)
    const unauthorizedPrisma = {
      document: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const unauthorizedResult = await getAuthorizedDocumentDownloadUrl(unauthorizedPrisma, {
      documentId,
      appUser: otherExecutive,
      supabaseAdmin: mockSupabase as never,
      bucket: "shipment-documents",
    });

    expect(unauthorizedResult).toBeNull();
  });

  it("creates authorized upload capability with safe storage key and server authorization", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValue({ id: shipmentId, createdById: executiveUser.id, status: "DRAFT", currentRevision: 1 });
    const prisma = { shipment: { findFirst } } as unknown as PrismaClient;

    const mockSupabase = {
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUploadUrl: vi.fn().mockResolvedValue({
            data: {
              signedUrl: "https://example.supabase.co/storage/v1/upload/sign",
              token: "upload-token-abc",
              path: `shipments/${shipmentId}/documents/${documentId}/random.pdf`,
            },
            error: null,
          }),
        }),
      },
    };

    const capability = await issueUploadCapability(prisma, {
      shipmentId,
      appUser: executiveUser,
      body: {
        documentType: "INVOICE",
        declaredMimeType: "application/pdf",
        fileName: "Commercial_Invoice_2026.pdf",
        expectedRevision: 1,
      },
      supabaseAdmin: mockSupabase as never,
      bucket: "shipment-documents",
    });

    expect(capability.signedUploadUrl).toBe("https://example.supabase.co/storage/v1/upload/sign");
    expect(capability.token).toBe("upload-token-abc");
    expect(capability.storageKey).toMatch(/^shipments\/11111111-1111-4111-8111-111111111111\/documents\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/);
    expect(capability.storageKey.toLowerCase()).not.toContain("commercial_invoice");
  });

  it("blocks upload capability generation for unauthorized users", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { shipment: { findFirst } } as unknown as PrismaClient;

    await expect(
      issueUploadCapability(prisma, {
        shipmentId,
        appUser: otherExecutive,
        body: { documentType: "INVOICE", declaredMimeType: "application/pdf", expectedRevision: 1 },
        supabaseAdmin: {} as never,
        bucket: "shipment-documents",
      }),
    ).rejects.toThrow("Shipment not found or inaccessible.");
  });
});
