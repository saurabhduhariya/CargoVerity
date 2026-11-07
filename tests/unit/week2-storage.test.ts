import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ALLOWED_MIME_TYPES, bucketMatches, buildBucketOptions } from "../../scripts/setup-storage.mjs";
import {
  assertIssuedStorageKey,
  sanitizeDisplayFileName,
  SIGNED_UPLOAD_URL_LIFETIME_SECONDS,
} from "@/lib/documents/upload-service";
import { buildStorageKey } from "@/lib/documents/storage";

/** Week 2 Steps 1–2: bucket configuration, issued-key binding and schema/migration contracts. */

const shipmentId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

describe("private bucket configuration (npm run storage:setup)", () => {
  it("is private, size-limited to the largest app limit and restricted to PDF/PNG/JPEG", () => {
    expect(buildBucketOptions({ MAX_PDF_BYTES: "10485760", MAX_IMAGE_BYTES: "7000000" })).toEqual({
      public: false,
      fileSizeLimit: 10_485_760,
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
    });
    expect(buildBucketOptions({}).fileSizeLimit).toBe(10_485_760);
    expect(() => buildBucketOptions({ MAX_PDF_BYTES: "-1" })).toThrow(/positive integers/);
  });

  it("detects a bucket that is public, unlimited or allows other MIME types", () => {
    const options = buildBucketOptions({});
    const good = { public: false, file_size_limit: 10_485_760, allowed_mime_types: [...ALLOWED_MIME_TYPES].reverse() };
    expect(bucketMatches(good, options)).toBe(true);
    expect(bucketMatches({ ...good, public: true }, options)).toBe(false);
    expect(bucketMatches({ ...good, file_size_limit: null }, options)).toBe(false);
    expect(bucketMatches({ ...good, allowed_mime_types: null }, options)).toBe(false);
    expect(bucketMatches({ ...good, allowed_mime_types: [...ALLOWED_MIME_TYPES, "text/html"] }, options)).toBe(false);
  });
});

describe("issued storage key binding", () => {
  it("accepts exactly the keys buildStorageKey issues for this shipment and document", () => {
    for (const extension of ["pdf", "png", "jpg"]) {
      const key = buildStorageKey({ shipmentId, documentId, extension });
      expect(assertIssuedStorageKey(key, shipmentId, documentId)).toBe(extension);
    }
  });

  it("rejects keys for another shipment, another document, other extensions or path tricks", () => {
    const other = "99999999-9999-4999-8999-999999999999";
    const random = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const bad = [
      `shipments/${other}/documents/${documentId}/${random}.pdf`,
      `shipments/${shipmentId}/documents/${other}/${random}.pdf`,
      `shipments/${shipmentId}/documents/${documentId}/${random}.exe`,
      `shipments/${shipmentId}/documents/${documentId}/${random}.pdf/../../x.pdf`,
      `/shipments/${shipmentId}/documents/${documentId}/${random}.pdf`,
      `shipments/${shipmentId}/documents/${documentId}/invoice.pdf`,
      "",
    ];
    for (const key of bad) {
      expect(() => assertIssuedStorageKey(key, shipmentId, documentId), key).toThrow(
        expect.objectContaining({ code: "INVALID_STORAGE_KEY" }),
      );
    }
  });

  it("documents the fixed Supabase signed-upload lifetime instead of a fake TTL", () => {
    expect(SIGNED_UPLOAD_URL_LIFETIME_SECONDS).toBe(7200);
  });
});

describe("display filename sanitization", () => {
  it("keeps only the base name and strips control characters", () => {
    expect(sanitizeDisplayFileName("C:\\Users\\me\\Invoice 1.pdf")).toBe("Invoice 1.pdf");
    expect(sanitizeDisplayFileName("../../etc/pass\u0000wd.pdf")).toBe("passwd.pdf");
    expect(sanitizeDisplayFileName("   ")).toBe("document");
    expect(sanitizeDisplayFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(180);
  });
});

describe("document data model contracts", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("enforces one current version per shipment slot with a partial unique index", () => {
    expect(read("prisma/migrations/20261105000000_document_versioning/migration.sql")).toMatch(
      /CREATE UNIQUE INDEX "Document_one_current_per_type_key"\s+ON "Document" \("shipmentId", "selectedDocType"\)\s+WHERE "isCurrent" = true/,
    );
  });

  it("keeps the Prisma schema aligned with the migrated Document indexes", () => {
    const schema = read("prisma/schema.prisma");
    const documentModel = schema.slice(schema.indexOf("model Document {"), schema.indexOf("model DocumentPage {"));
    expect(documentModel).toContain("@@index([shipmentId])");
    expect(documentModel).not.toContain("@@index([shipmentId, selectedDocType, isCurrent])");
    for (const field of ["selectedDocType", "detectedDocType", "typeMismatch", "documentVersion", "isCurrent", "storageKey", "originalFileName", "mimeType", "sizeBytes", "sha256", "pageCount", "extractionStatus", "uploadedById"]) {
      expect(documentModel, field).toMatch(new RegExp(`\\n\\s+${field}\\s`));
    }
  });
});
