import { createHash } from "node:crypto";
import { z } from "zod";

import { documentTypes } from "@/lib/ai/types";
import { getEnv } from "@/lib/env";

export const documentUploadMetadataSchema = z.object({
  shipmentId: z.string().uuid(),
  documentType: z.enum(documentTypes),
});

export const uploadUrlRequestSchema = z.object({
  documentType: z.enum(documentTypes),
  fileName: z.string().trim().min(1).max(255).optional(),
  extension: z.string().trim().min(1).max(10).optional(),
  declaredMimeType: z.string().trim().min(1),
  fileSizeBytes: z.number().int().positive().optional(),
  expectedRevision: z.number().int().positive().optional(),
  idempotencyToken: z.string().trim().min(1).max(100).optional(),
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

export const completeUploadRequestSchema = z.object({
  documentId: z.string().uuid(),
  storageKey: z.string().trim().min(1),
  documentType: z.enum(documentTypes),
  originalFileName: z.string().trim().min(1).max(255),
  declaredMimeType: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional(),
  allowReplacement: z.boolean().default(false),
  idempotencyToken: z.string().trim().min(1).max(100).optional(),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

export const supportedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

/**
 * Detects the real MIME type from binary magic bytes.
 * Does not trust the browser-provided Content-Type header.
 */
export function detectContentMimeType(
  bytes: Uint8Array,
): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (bytes.length < 3) return null;

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }

  // PNG: 137 80 78 71 13 10 26 10
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  return null;
}

/**
 * Parses a PDF buffer server-side with pdfjs-dist.
 * Rejects corrupt, password-protected, empty, or oversized-page PDFs.
 */
export async function parsePdfAndCountPages(bytes: Uint8Array): Promise<number> {
  const env = getEnv();
  if (bytes.length === 0) {
    throw new Error("The PDF document is empty (0 bytes).");
  }

  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: bytes.slice(), // Clone to ensure the original buffer is never detached
      useSystemFonts: true,
    });
    const doc = await task.promise;
    const pageCount = doc.numPages;

    if (pageCount === 0) {
      throw new Error("The PDF document contains 0 pages.");
    }
    if (pageCount > env.MAX_PDF_PAGES) {
      throw new Error(
        `PDF exceeds maximum allowed pages (${env.MAX_PDF_PAGES}). Observed ${pageCount} pages.`,
      );
    }

    return pageCount;
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === "PasswordException" || /password/i.test(error.message)) {
        throw new Error("Password-protected PDFs are not supported.");
      }
      if (error.name === "InvalidPDFException" || /empty/i.test(error.message)) {
        if (/empty/i.test(error.message)) {
          throw new Error("The PDF document is empty (0 bytes).");
        }
        throw new Error("Corrupted or invalid PDF file.");
      }
      if (/PDF exceeds maximum allowed pages/.test(error.message)) {
        throw error;
      }
    }
    throw new Error("Corrupted or invalid PDF file.");
  }
}

/**
 * Validates a stored document buffer observed from storage or incoming upload.
 * Reads magic bytes, calculates SHA-256, validates size limits and PDF structure/pages.
 */
export async function validateStoredDocumentBuffer(
  buffer: Uint8Array | ArrayBuffer | Buffer,
  declaredMimeType?: string,
): Promise<{
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  sizeBytes: number;
  sha256: string;
  pageCount: number;
}> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const sizeBytes = bytes.byteLength;
  const env = getEnv();

  if (sizeBytes === 0) {
    throw new Error("The uploaded file is empty (0 bytes).");
  }

  const detectedMime = detectContentMimeType(bytes);
  if (!detectedMime) {
    throw new Error(
      "Unsupported file format or invalid magic bytes. Only PDF, PNG, and JPEG documents are supported.",
    );
  }

  if (declaredMimeType && declaredMimeType !== detectedMime) {
    throw new Error(
      `The file content does not match its declared document type (declared: ${declaredMimeType}, detected: ${detectedMime}).`,
    );
  }

  const maxBytes =
    detectedMime === "application/pdf" ? env.MAX_PDF_BYTES : env.MAX_IMAGE_BYTES;
  if (sizeBytes > maxBytes) {
    throw new Error(
      `The file exceeds the maximum allowed size of ${maxBytes} bytes (received ${sizeBytes} bytes).`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let pageCount = 1;
  if (detectedMime === "application/pdf") {
    pageCount = await parsePdfAndCountPages(bytes);
  }

  return {
    mimeType: detectedMime,
    sizeBytes,
    sha256,
    pageCount,
  };
}

/**
 * Backward-compatible helper for File objects.
 */
export async function validateUploadedFile(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await validateStoredDocumentBuffer(arrayBuffer, file.type);

  return {
    mimeType: result.mimeType,
    fileName:
      file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "document",
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
    pageCount: result.pageCount,
  };
}
