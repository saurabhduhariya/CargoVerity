import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS = 300; // 5 minutes
export const DEFAULT_SIGNED_UPLOAD_URL_TTL_SECONDS = 300; // 5 minutes

export type StorageAppUser = {
  id: string;
  role: "EXECUTIVE" | "MANAGER";
};

/**
 * Extracts a sanitized file extension from a filename or extension string.
 * Strips path separators and directory traversal sequences.
 */
export function sanitizeFileExtension(fileNameOrExtension?: string): string {
  if (!fileNameOrExtension) return "bin";

  // Strip path components
  const base = fileNameOrExtension.split(/[/\\]/).pop() ?? "";
  const dotIndex = base.lastIndexOf(".");
  const rawExt = dotIndex >= 0 ? base.slice(dotIndex + 1) : base;

  // Keep only alphanumeric characters in lowercase
  const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleanExt.length > 0 ? cleanExt : "bin";
}

/**
 * Generates an object storage key adhering to the private storage specification:
 * `shipments/<shipment-uuid>/documents/<document-uuid>/<random-file-name>.<ext>`
 *
 * CRITICAL PRIVACY RULE: Original customer/user filenames MUST NEVER be embedded
 * in the storage key. Only a safe file extension is preserved.
 */
export function buildStorageKey(input: {
  shipmentId: string;
  documentId: string;
  originalFileName?: string;
  extension?: string;
  randomName?: string;
}): string {
  if (!input.shipmentId || !input.documentId) {
    throw new Error("Shipment ID and Document ID are required to build a storage key.");
  }

  // Prevent directory traversal in IDs
  if (input.shipmentId.includes("..") || input.shipmentId.includes("/") || input.shipmentId.includes("\\")) {
    throw new Error("Invalid shipment ID in storage key.");
  }
  if (input.documentId.includes("..") || input.documentId.includes("/") || input.documentId.includes("\\")) {
    throw new Error("Invalid document ID in storage key.");
  }

  const extension = input.extension
    ? sanitizeFileExtension(input.extension)
    : sanitizeFileExtension(input.originalFileName);

  const randomName = input.randomName ?? randomUUID();
  const key = `shipments/${input.shipmentId}/documents/${input.documentId}/${randomName}.${extension}`;

  // Verify that the original base filename is NEVER leaked into the storage key
  if (input.originalFileName) {
    const originalBaseName = input.originalFileName
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^/.]+$/, "")
      .trim();

    if (originalBaseName && originalBaseName.length > 2 && key.toLowerCase().includes(originalBaseName.toLowerCase())) {
      throw new Error("Storage key must not contain original filename.");
    }
  }

  return key;
}

/**
 * Ensures the configured Supabase storage bucket exists and is private (public = false).
 */
export async function ensurePrivateStorageBucket(
  supabaseAdmin: SupabaseClient = createSupabaseAdminClient(),
  bucketName: string = getEnv().SUPABASE_STORAGE_BUCKET,
): Promise<{ bucketName: string; created: boolean; isPublic: boolean }> {
  const { data: existing } = await supabaseAdmin.storage.getBucket(bucketName);

  if (existing) {
    if (existing.public) {
      throw new Error(`Storage bucket "${bucketName}" is configured as public. CargoVerity requires a private bucket.`);
    }
    return { bucketName, created: false, isPublic: false };
  }

  // If getBucket fails, try to create the private bucket
  const { error: createError } = await supabaseAdmin.storage.createBucket(bucketName, {
    public: false,
  });

  if (createError && !createError.message?.toLowerCase().includes("already exists")) {
    throw new Error(`Failed to create private storage bucket "${bucketName}": ${createError.message}`);
  }

  return { bucketName, created: true, isPublic: false };
}

/**
 * Authorizes that the user has permission to view or mutate the given shipment.
 * Managers have access to all shipments.
 * Executives have access only to shipments they created.
 */
export async function authorizeShipmentAccess(
  prisma: PrismaClient,
  shipmentId: string,
  appUser: StorageAppUser,
) {
  const shipment = await prisma.shipment.findFirst({
    where: {
      id: shipmentId,
      ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
    },
  });

  if (!shipment) {
    throw new Error("Shipment not found or inaccessible.");
  }

  return shipment;
}

/**
 * Authorizes that the user has permission to view the given document.
 * Returns the document with extraction runs if authorized, or null if unauthorized/not found.
 */
export async function authorizeDocumentAccess(
  prisma: PrismaClient,
  documentId: string,
  appUser: StorageAppUser,
) {
  return prisma.document.findFirst({
    where: {
      id: documentId,
      shipment: appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
    },
    include: {
      shipment: true,
      pages: { orderBy: { pageNumber: "asc" } },
      extractionRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { fields: true, lineItems: true },
      },
    },
  });
}

/**
 * Creates a short-lived signed download URL for an authorized storage key.
 * Never logs the signed URL or document contents.
 */
export async function createSignedDownloadUrl(params: {
  storageKey: string;
  expiresInSeconds?: number;
  bucket?: string;
  supabaseAdmin?: SupabaseClient;
}): Promise<string> {
  const {
    storageKey,
    expiresInSeconds = DEFAULT_SIGNED_DOWNLOAD_URL_TTL_SECONDS,
    bucket = getEnv().SUPABASE_STORAGE_BUCKET,
    supabaseAdmin = createSupabaseAdminClient(),
  } = params;

  if (!storageKey) {
    throw new Error("A storage key is required to create a signed download URL.");
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error("Could not create a document preview URL.");
  }

  // Security guard: never log signed download URLs as they are bearer capabilities
  return data.signedUrl;
}

/**
 * Checks server authorization, then issues a short-lived signed download URL.
 * Returns null if the document does not exist or the user lacks permission.
 */
export async function getAuthorizedDocumentDownloadUrl(
  prisma: PrismaClient,
  params: {
    documentId: string;
    appUser: StorageAppUser;
    expiresInSeconds?: number;
    bucket?: string;
    supabaseAdmin?: SupabaseClient;
  },
) {
  const document = await authorizeDocumentAccess(prisma, params.documentId, params.appUser);
  if (!document) return null;

  const signedUrl = await createSignedDownloadUrl({
    storageKey: document.storageKey,
    expiresInSeconds: params.expiresInSeconds,
    bucket: params.bucket,
    supabaseAdmin: params.supabaseAdmin,
  });

  return { document, signedUrl };
}

/**
 * Uploads a document buffer directly to the private Supabase Storage bucket.
 */
export async function uploadDocumentBuffer(params: {
  storageKey: string;
  fileBuffer: ArrayBuffer | Buffer | Uint8Array;
  mimeType: string;
  bucket?: string;
  supabaseAdmin?: SupabaseClient;
}): Promise<void> {
  const {
    storageKey,
    fileBuffer,
    mimeType,
    bucket = getEnv().SUPABASE_STORAGE_BUCKET,
    supabaseAdmin = createSupabaseAdminClient(),
  } = params;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storageKey, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Document storage upload failed: ${error.message}`);
  }
}

/**
 * Authorizes a shipment, generates a safe storage key and document ID,
 * and issues a short-lived signed upload URL capability for direct-to-storage uploads.
 */
export async function createAuthorizedUploadCapability(
  prisma: PrismaClient,
  params: {
    shipmentId: string;
    appUser: StorageAppUser;
    originalFileName?: string;
    extension?: string;
    expiresInSeconds?: number;
    bucket?: string;
    supabaseAdmin?: SupabaseClient;
  },
): Promise<{
  documentId: string;
  storageKey: string;
  signedUploadUrl: string;
  token: string;
}> {
  // 1. Authorize user has access to shipment
  const shipment = await authorizeShipmentAccess(prisma, params.shipmentId, params.appUser);

  // 2. Generate a fresh document UUID
  const documentId = randomUUID();

  // 3. Generate storage key without original filename
  const storageKey = buildStorageKey({
    shipmentId: shipment.id,
    documentId,
    originalFileName: params.originalFileName,
    extension: params.extension,
  });

  const {
    bucket = getEnv().SUPABASE_STORAGE_BUCKET,
    supabaseAdmin = createSupabaseAdminClient(),
  } = params;

  // 4. Issue pre-signed upload URL capability from Supabase Storage
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUploadUrl(storageKey, { upsert: false });

  if (error || !data?.signedUrl) {
    throw new Error("Failed to create signed upload capability.");
  }

  return {
    documentId,
    storageKey,
    signedUploadUrl: data.signedUrl,
    token: data.token,
  };
}
