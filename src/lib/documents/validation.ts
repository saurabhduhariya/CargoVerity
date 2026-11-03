import { z } from "zod";

import { getEnv } from "@/lib/env";
import { documentTypes } from "@/lib/ai/types";

export const documentUploadMetadataSchema = z.object({
  shipmentId: z.string().uuid(),
  documentType: z.enum(documentTypes),
});

const supportedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function validateUploadedFile(file: File) {
  const env = getEnv();

  if (!supportedMimeTypes.has(file.type)) {
    throw new Error("Only PDF, PNG, and JPEG documents are supported.");
  }

  const maxBytes = file.type === "application/pdf" ? env.MAX_PDF_BYTES : env.MAX_IMAGE_BYTES;
  if (file.size === 0 || file.size > maxBytes) {
    throw new Error(`The file must be between 1 byte and ${maxBytes} bytes.`);
  }

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPdf = file.type === "application/pdf" && new TextDecoder().decode(header.slice(0, 5)) === "%PDF-";
  const isPng = file.type === "image/png" && header.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  const isJpeg = file.type === "image/jpeg" && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;

  if (!isPdf && !isPng && !isJpeg) {
    throw new Error("The file content does not match its declared document type.");
  }

  return {
    mimeType: file.type,
    fileName: file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "document",
    fileSize: file.size,
  };
}
