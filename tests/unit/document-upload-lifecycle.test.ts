import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createFakeDb, createFakeStorage } from "./helpers/fake-upload-env";

/**
 * Week 2 Step 3 tests required by the plan: invalid MIME, wrong magic bytes, empty PDF,
 * oversized file, duplicate completion, stale revision, unauthorized shipment and successful
 * replacement. Route handlers run against the real upload service with in-memory fakes.
 */

const shipmentId = "11111111-1111-4111-8111-111111111111";
const otherShipmentId = "99999999-9999-4999-8999-999999999999";
const documentId = "22222222-2222-4222-8222-222222222222";
const executiveUser = { id: "33333333-3333-4333-8333-333333333333", email: "exec@example.test", role: "EXECUTIVE" as const };
const otherExecutive = { id: "44444444-4444-4444-8444-444444444444", email: "other@example.test", role: "EXECUTIVE" as const };

const samplePdf = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), "public", "sample-docs", name)));
const invoicePdf = samplePdf("shp-24811-invoice.pdf");
const revisedInvoicePdf = samplePdf("shp-24812-invoice.pdf");

function createValidPdfBytes() {
  return new TextEncoder().encode(`%PDF-1.4
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
%%EOF`);
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

const keyFor = (docId = documentId, ext = "pdf", sid = shipmentId) =>
  `shipments/${sid}/documents/${docId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${ext}`;

function setup(options: {
  user?: typeof executiveUser;
  status?: string;
  revision?: number;
  documents?: Record<string, unknown>[];
  objects?: Record<string, Uint8Array>;
} = {}) {
  vi.spyOn(auth, "requireAppUser").mockResolvedValue({
    appUser: (options.user ?? executiveUser) as never,
    authUser: { id: (options.user ?? executiveUser).id } as never,
  });
  const fakeDb = createFakeDb({
    shipments: [
      {
        id: shipmentId,
        reference: "SHP-UNIT",
        createdById: executiveUser.id,
        status: options.status ?? "DRAFT",
        currentRevision: options.revision ?? 1,
      },
      { id: otherShipmentId, reference: "SHP-OTHER", createdById: otherExecutive.id, status: "DRAFT", currentRevision: 1 },
    ],
    documents: options.documents,
  });
  const storage = createFakeStorage(options.objects);
  vi.spyOn(db, "getPrisma").mockReturnValue(fakeDb.prisma as never);
  vi.spyOn(supabaseServer, "createSupabaseAdminClient").mockReturnValue(storage.supabaseAdmin as never);
  return { ...fakeDb, storage };
}

const params = { params: Promise.resolve({ id: shipmentId }) };

function post(path: string, body: unknown) {
  return new Request(`http://localhost:3000/api/shipments/${shipmentId}/documents/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function completeBody(overrides: Record<string, unknown> = {}) {
  return {
    documentId,
    storageKey: keyFor(),
    documentType: "INVOICE",
    originalFileName: "invoice.pdf",
    declaredMimeType: "application/pdf",
    expectedRevision: 1,
    ...overrides,
  };
}

const existingInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  shipmentId,
  docType: "INVOICE",
  selectedDocType: "INVOICE",
  documentVersion: 1,
  isCurrent: true,
  storageKey: keyFor("55555555-5555-4555-8555-555555555555"),
  sha256: "old-sha",
  ...overrides,
});

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

    it("rejects unsupported content with INVALID_MAGIC_BYTES", async () => {
      const textFile = new TextEncoder().encode("Hello, plain text document.");
      await expect(validateStoredDocumentBuffer(textFile)).rejects.toMatchObject({
        code: "INVALID_MAGIC_BYTES",
        status: 415,
      });
    });

    it("rejects wrong magic bytes when declared MIME does not match content", async () => {
      await expect(validateStoredDocumentBuffer(validPngBytes, "application/pdf")).rejects.toThrow(
        /does not match its declared document type/,
      );
    });

    it("rejects empty files and empty PDFs with EMPTY_FILE", async () => {
      await expect(validateStoredDocumentBuffer(new Uint8Array([]))).rejects.toMatchObject({ code: "EMPTY_FILE" });
      await expect(parsePdfAndCountPages(new Uint8Array([]))).rejects.toThrow(/The PDF document is empty/);
    });

    it("rejects oversized files with FILE_OVERSIZED", async () => {
      vi.spyOn(envModule, "getEnv").mockReturnValue({ ...envModule.getEnv(), MAX_PDF_BYTES: 100 });
      await expect(validateStoredDocumentBuffer(createValidPdfBytes())).rejects.toMatchObject({
        code: "FILE_OVERSIZED",
        status: 413,
      });
    });

    it("rejects PDFs above the page limit with PAGE_LIMIT_EXCEEDED", async () => {
      vi.spyOn(envModule, "getEnv").mockReturnValue({ ...envModule.getEnv(), MAX_PDF_PAGES: 1 });
      const twoPages = new TextEncoder().encode(`%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj
4 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj
trailer <</Size 5 /Root 1 0 R>>
%%EOF`);
      await expect(parsePdfAndCountPages(twoPages)).rejects.toMatchObject({ code: "PAGE_LIMIT_EXCEEDED" });
    });

    it("rejects corrupted PDF files with CORRUPTED_PDF", async () => {
      const corruptPdf = new TextEncoder().encode("%PDF-1.4\ncorrupted trailer without xref");
      await expect(parsePdfAndCountPages(corruptPdf)).rejects.toMatchObject({
        code: "CORRUPTED_PDF",
        message: "Corrupted or invalid PDF file.",
      });
    });

    it("parses valid PDF and counts pages correctly", async () => {
      expect(await parsePdfAndCountPages(createValidPdfBytes())).toBe(1);
      expect(await parsePdfAndCountPages(invoicePdf)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("POST /api/shipments/[id]/documents/upload-url", () => {
    const uploadBody = (overrides: Record<string, unknown> = {}) => ({
      documentType: "INVOICE",
      declaredMimeType: "application/pdf",
      fileName: "Acme Confidential Invoice.pdf",
      fileSizeBytes: 1000,
      expectedRevision: 1,
      ...overrides,
    });

    it("rejects unauthenticated requests with 401", async () => {
      vi.spyOn(auth, "requireAppUser").mockRejectedValue(new Error("AUTHENTICATION_REQUIRED"));
      const response = await postUploadUrlRoute(post("upload-url", uploadBody()), params);
      expect(response.status).toBe(401);
    });

    it("rejects an Executive requesting an upload for another user's shipment", async () => {
      setup({ user: otherExecutive });
      const response = await postUploadUrlRoute(post("upload-url", uploadBody()), params);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "Shipment not found or inaccessible." });
    });

    it("rejects a stale revision with 409 STALE_REVISION", async () => {
      setup({ revision: 5 });
      const response = await postUploadUrlRoute(post("upload-url", uploadBody({ expectedRevision: 4 })), params);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "STALE_REVISION" });
    });

    it("requires the expected revision", async () => {
      setup();
      const response = await postUploadUrlRoute(post("upload-url", uploadBody({ expectedRevision: undefined })), params);
      expect(response.status).toBe(400);
    });

    it("rejects an invalid MIME type with 400 INVALID_MIME", async () => {
      setup();
      const response = await postUploadUrlRoute(post("upload-url", uploadBody({ declaredMimeType: "application/zip" })), params);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_MIME" });
    });

    it("rejects a declared oversized or empty file", async () => {
      setup();
      const big = await postUploadUrlRoute(post("upload-url", uploadBody({ fileSizeBytes: 20_000_000 })), params);
      expect(big.status).toBe(413);
      await expect(big.json()).resolves.toMatchObject({ code: "FILE_OVERSIZED" });

      const empty = await postUploadUrlRoute(post("upload-url", uploadBody({ fileSizeBytes: 0 })), params);
      expect(empty.status).toBe(400);
      await expect(empty.json()).resolves.toMatchObject({ code: "EMPTY_FILE" });
    });

    it("rejects uploads to an exported shipment", async () => {
      setup({ status: "EXPORTED" });
      const response = await postUploadUrlRoute(post("upload-url", uploadBody()), params);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "SHIPMENT_LOCKED" });
    });

    it("issues a random key without the original filename, with the extension chosen by the server", async () => {
      setup();
      const response = await postUploadUrlRoute(
        post("upload-url", uploadBody({ declaredMimeType: "image/jpeg", extension: "exe" })),
        params,
      );
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const json = await response.json();
      expect(json.storageKey).toMatch(
        new RegExp(`^shipments/${shipmentId}/documents/${json.documentId}/[0-9a-f-]{36}\\.jpg$`),
      );
      expect(json.storageKey.toLowerCase()).not.toContain("acme");
      expect(json).toMatchObject({ token: "t", expectedRevision: 1, idempotencyToken: json.documentId });
      expect(json.bucket).toBeTruthy();
    });
  });

  describe("POST /api/shipments/[id]/documents/complete", () => {
    it("rejects unauthorized shipment access", async () => {
      setup({ user: otherExecutive, objects: { [keyFor()]: invoicePdf } });
      const response = await postCompleteRoute(post("complete", completeBody()), params);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "Shipment not found or inaccessible." });
    });

    it("rejects a storage key that belongs to another shipment or document", async () => {
      const { state } = setup({ objects: { [keyFor(documentId, "pdf", otherShipmentId)]: invoicePdf } });

      const foreign = await postCompleteRoute(
        post("complete", completeBody({ storageKey: keyFor(documentId, "pdf", otherShipmentId) })),
        params,
      );
      expect(foreign.status).toBe(400);
      await expect(foreign.json()).resolves.toMatchObject({ code: "INVALID_STORAGE_KEY" });

      const mismatchedDoc = await postCompleteRoute(
        post("complete", completeBody({ storageKey: keyFor("66666666-6666-4666-8666-666666666666") })),
        params,
      );
      expect(mismatchedDoc.status).toBe(400);

      const traversal = await postCompleteRoute(
        post("complete", completeBody({ storageKey: `shipments/${shipmentId}/documents/${documentId}/../x.pdf` })),
        params,
      );
      expect(traversal.status).toBe(400);
      expect(state.documents).toHaveLength(0);
    });

    it("rejects a stale revision with 409 STALE_REVISION", async () => {
      setup({ revision: 3, objects: { [keyFor()]: invoicePdf } });
      const response = await postCompleteRoute(post("complete", completeBody({ expectedRevision: 2 })), params);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "STALE_REVISION" });
    });

    it("returns 404 OBJECT_NOT_FOUND when the file does not exist in storage", async () => {
      setup();
      const response = await postCompleteRoute(post("complete", completeBody()), params);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "OBJECT_NOT_FOUND" });
    });

    it("rejects wrong magic bytes, deletes the stored object and records nothing", async () => {
      const fakeText = new TextEncoder().encode("this is not a pdf");
      const { state, storage } = setup({ objects: { [keyFor()]: fakeText } });

      const response = await postCompleteRoute(post("complete", completeBody()), params);

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_MAGIC_BYTES" });
      expect(storage.objects.has(keyFor())).toBe(false);
      expect(state.documents).toHaveLength(0);
      expect(state.shipments[0].currentRevision).toBe(1);
    });

    it("rejects content whose real type differs from the key extension issued for it", async () => {
      const { storage } = setup({ objects: { [keyFor(documentId, "png")]: invoicePdf } });
      const response = await postCompleteRoute(
        post("complete", completeBody({ storageKey: keyFor(documentId, "png") })),
        params,
      );
      expect(response.status).toBe(415);
      expect(storage.objects.size).toBe(0);
    });

    it("rejects an empty stored file", async () => {
      setup({ objects: { [keyFor()]: new Uint8Array([]) } });
      const response = await postCompleteRoute(post("complete", completeBody()), params);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: "EMPTY_FILE" });
    });

    it("rejects an oversized stored file even when the browser declared a small size", async () => {
      vi.spyOn(envModule, "getEnv").mockReturnValue({ ...envModule.getEnv(), MAX_PDF_BYTES: 1000 });
      setup({ objects: { [keyFor()]: invoicePdf } });
      const response = await postCompleteRoute(post("complete", completeBody()), params);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ code: "FILE_OVERSIZED" });
    });

    it("creates version 1, bumps the revision, sets IN_REVIEW and audits the upload", async () => {
      const { state } = setup({ objects: { [keyFor()]: invoicePdf } });

      const response = await postCompleteRoute(
        post("complete", completeBody({ originalFileName: "../../etc/Invoice\u0007.pdf" })),
        params,
      );

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json).toMatchObject({ shipmentRevision: 2, replayed: false });
      expect(json.document).toMatchObject({
        id: documentId,
        documentVersion: 1,
        isCurrent: true,
        mimeType: "application/pdf",
        sizeBytes: invoicePdf.byteLength,
        originalFileName: "Invoice.pdf",
      });
      expect(json.document.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(state.shipments[0]).toMatchObject({ currentRevision: 2, status: "IN_REVIEW" });
      expect(state.audits).toEqual([
        expect.objectContaining({
          action: "DOCUMENT_UPLOADED",
          entityId: documentId,
          metadata: expect.objectContaining({ previousRevision: 1, revision: 2, replacedDocumentId: null }),
        }),
      ]);
    });

    it("treats a repeated completion of the same upload as an idempotent replay (200)", async () => {
      const { state } = setup({ objects: { [keyFor()]: invoicePdf } });

      const first = await postCompleteRoute(post("complete", completeBody()), params);
      expect(first.status).toBe(201);
      const replay = await postCompleteRoute(post("complete", completeBody()), params);

      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({ replayed: true, shipmentRevision: 2, document: { id: documentId } });
      expect(state.documents).toHaveLength(1);
      expect(state.shipments[0].currentRevision).toBe(2);
      expect(state.audits).toHaveLength(1);
    });

    it("rejects a duplicate completion that reuses a document ID with a different key", async () => {
      setup({
        objects: { [keyFor()]: invoicePdf },
        documents: [existingInvoice({ id: documentId, storageKey: keyFor(documentId, "png") })],
      });
      const response = await postCompleteRoute(post("complete", completeBody()), params);
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe("DUPLICATE_COMPLETION");
      expect(json).not.toHaveProperty("document");
    });

    it("rejects identical content for the same slot and removes the redundant object", async () => {
      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(invoicePdf).digest("hex");
      const { storage, state } = setup({
        objects: { [keyFor()]: invoicePdf },
        documents: [existingInvoice({ sha256 })],
      });

      const response = await postCompleteRoute(post("complete", completeBody({ allowReplacement: true })), params);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "DUPLICATE_CONTENT" });
      expect(storage.objects.has(keyFor())).toBe(false);
      expect(state.documents).toHaveLength(1);
    });

    it("requires explicit confirmation before replacing a current document", async () => {
      setup({ objects: { [keyFor()]: revisedInvoicePdf }, documents: [existingInvoice()] });
      const response = await postCompleteRoute(post("complete", completeBody({ allowReplacement: false })), params);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "REPLACEMENT_REQUIRED" });
    });

    it("replaces the current document: version 2, old version kept as history, approval invalidated", async () => {
      const { state, storage } = setup({
        status: "APPROVED",
        revision: 4,
        objects: { [keyFor()]: revisedInvoicePdf },
        documents: [existingInvoice()],
      });

      const response = await postCompleteRoute(
        post("complete", completeBody({ allowReplacement: true, expectedRevision: 4 })),
        params,
      );

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.document).toMatchObject({ id: documentId, documentVersion: 2, isCurrent: true });
      expect(json.shipmentRevision).toBe(5);

      const versions = state.documents.filter((d) => d.selectedDocType === "INVOICE");
      expect(versions.map((d) => [d.documentVersion, d.isCurrent])).toEqual([
        [1, false],
        [2, true],
      ]);
      expect(state.shipments[0]).toMatchObject({ status: "IN_REVIEW", currentRevision: 5 });
      expect(state.audits[0]).toMatchObject({
        action: "DOCUMENT_REPLACED",
        metadata: expect.objectContaining({
          previousStatus: "APPROVED",
          approvalInvalidated: true,
          replacedDocumentId: "55555555-5555-4555-8555-555555555555",
        }),
      });
      // History is preserved: the old object is not deleted from storage.
      expect(storage.removed).toEqual([]);
    });

    it("loses cleanly when another change bumps the revision during completion", async () => {
      const { state, prisma, storage } = setup({ objects: { [keyFor()]: invoicePdf } });
      // Simulate a concurrent writer: the revision moves on right before the conditional update.
      const original = prisma.shipment.updateMany;
      prisma.shipment.updateMany = async (args) => {
        state.shipments[0].currentRevision = 2;
        return original(args);
      };

      const response = await postCompleteRoute(post("complete", completeBody()), params);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "STALE_REVISION" });
      expect(state.documents).toHaveLength(0);
      expect(state.audits).toHaveLength(0);
      expect(storage.objects.has(keyFor())).toBe(false);
    });

    it("rejects completion on an exported shipment and keeps the record unchanged", async () => {
      const { state } = setup({ status: "EXPORTED", objects: { [keyFor()]: invoicePdf } });
      const response = await postCompleteRoute(post("complete", completeBody()), params);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "SHIPMENT_LOCKED" });
      expect(state.documents).toHaveLength(0);
    });
  });
});
