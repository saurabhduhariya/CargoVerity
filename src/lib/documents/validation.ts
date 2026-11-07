import { createHash } from "node:crypto";
import { z } from "zod";

import { documentTypes } from "@/lib/ai/types";
import { getEnv } from "@/lib/env";
import { DocumentUploadError } from "@/lib/errors";

export const SUPPORTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export const supportedMimeTypes = new Set<string>(SUPPORTED_MIME_TYPES);

/** The storage-key extension is derived from the MIME type on the server, never from the client. */
export const EXTENSION_BY_MIME: Record<SupportedMimeType, "pdf" | "png" | "jpg"> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function isSupportedMimeType(value: string): value is SupportedMimeType {
  return supportedMimeTypes.has(value);
}

export const uploadUrlRequestSchema = z.object({
  documentType: z.enum(documentTypes),
  fileName: z.string().trim().min(1).max(255).optional(),
  // Accepted for backward compatibility but ignored: the extension comes from declaredMimeType.
  extension: z.string().trim().min(1).max(10).optional(),
  declaredMimeType: z.string().trim().min(1),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().positive(),
  idempotencyToken: z.string().trim().min(1).max(100).optional(),
});

export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

export const completeUploadRequestSchema = z.object({
  documentId: z.string().uuid(),
  storageKey: z.string().trim().min(1).max(300),
  documentType: z.enum(documentTypes),
  originalFileName: z.string().trim().min(1).max(255),
  declaredMimeType: z.string().trim().min(1),
  expectedRevision: z.number().int().positive(),
  allowReplacement: z.boolean().default(false),
  idempotencyToken: z.string().trim().min(1).max(100).optional(),
});

export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

/**
 * Detects the real MIME type from binary magic bytes.
 * Does not trust the browser-provided Content-Type header.
 */
export function detectContentMimeType(bytes: Uint8Array): SupportedMimeType | null {
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
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  return null;
}

/**
 * In Node, pdf.js runs a "fake worker" on the main thread. By default it loads the worker with a
 * dynamic import of a path relative to its own file, which does not exist once Next.js bundles the
 * server code (every PDF then failed as "corrupted" inside the app while passing in plain Node).
 * Importing the worker module here lets the bundler include it, and pdf.js picks it up from
 * `globalThis.pdfjsWorker` instead of resolving a file at runtime.
 */
let pdfWorkerReady: Promise<void> | null = null;
function ensurePdfWorkerLoaded() {
  pdfWorkerReady ??= import("pdfjs-dist/legacy/build/pdf.worker.mjs").then((worker) => {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  });
  return pdfWorkerReady;
}

/**
 * Parses a PDF buffer server-side with pdfjs-dist.
 * Rejects corrupt, password-protected, empty, or over-page-limit PDFs.
 */
export async function parsePdfAndCountPages(bytes: Uint8Array): Promise<number> {
  const env = getEnv();
  if (bytes.length === 0) {
    throw new DocumentUploadError("The PDF document is empty (0 bytes).", "EMPTY_FILE", 422);
  }

  let pageCount: number;
  try {
    await ensurePdfWorkerLoaded();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: bytes.slice(), // Clone so the caller's buffer is never detached
      useSystemFonts: true,
    });
    const doc = await task.promise;
    pageCount = doc.numPages;
    await task.destroy();
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === "PasswordException" || /password/i.test(error.message))) {
      throw new DocumentUploadError(
        "Password-protected PDFs are not supported.",
        "PASSWORD_PROTECTED_PDF",
        422,
      );
    }
    throw new DocumentUploadError("Corrupted or invalid PDF file.", "CORRUPTED_PDF", 422);
  }

  if (pageCount === 0) {
    throw new DocumentUploadError("The PDF document contains 0 pages.", "EMPTY_FILE", 422);
  }
  if (pageCount > env.MAX_PDF_PAGES) {
    throw new DocumentUploadError(
      `PDF exceeds maximum allowed pages (${env.MAX_PDF_PAGES}). Observed ${pageCount} pages.`,
      "PAGE_LIMIT_EXCEEDED",
      422,
    );
  }
  return pageCount;
}

export function maxBytesForMime(mimeType: SupportedMimeType) {
  const env = getEnv();
  return mimeType === "application/pdf" ? env.MAX_PDF_BYTES : env.MAX_IMAGE_BYTES;
}

/**
 * Validates a stored document buffer observed from storage.
 * Reads magic bytes, calculates SHA-256, validates size limits and PDF structure/pages.
 */
export async function validateStoredDocumentBuffer(
  buffer: Uint8Array | ArrayBuffer | Buffer,
  declaredMimeType?: string,
): Promise<{
  mimeType: SupportedMimeType;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
}> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const sizeBytes = bytes.byteLength;

  if (sizeBytes === 0) {
    throw new DocumentUploadError("The uploaded file is empty (0 bytes).", "EMPTY_FILE", 422);
  }

  const detectedMime = detectContentMimeType(bytes);
  if (!detectedMime) {
    throw new DocumentUploadError(
      "Unsupported file format or invalid magic bytes. Only PDF, PNG, and JPEG documents are supported.",
      "INVALID_MAGIC_BYTES",
      415,
    );
  }

  if (declaredMimeType && declaredMimeType !== detectedMime) {
    throw new DocumentUploadError(
      `The file content does not match its declared document type (declared: ${declaredMimeType}, detected: ${detectedMime}).`,
      "INVALID_MAGIC_BYTES",
      415,
    );
  }

  const maxBytes = maxBytesForMime(detectedMime);
  if (sizeBytes > maxBytes) {
    throw new DocumentUploadError(
      `The file exceeds the maximum allowed size of ${maxBytes} bytes (received ${sizeBytes} bytes).`,
      "FILE_OVERSIZED",
      413,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let pageCount = 1;
  if (detectedMime === "application/pdf") {
    pageCount = await parsePdfAndCountPages(bytes);
  }

  return { mimeType: detectedMime, sizeBytes, sha256, pageCount };
}
