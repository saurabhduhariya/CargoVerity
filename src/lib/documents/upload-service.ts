import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import type { DocumentType } from "@/lib/ai/types";
import {
  createDocumentVersionInTransaction,
  getCurrentDocument,
  type NewDocumentVersion,
} from "@/lib/documents/service";
import {
  authorizeShipmentAccess,
  buildStorageKey,
  type StorageAppUser,
} from "@/lib/documents/storage";
import {
  completeUploadRequestSchema,
  EXTENSION_BY_MIME,
  isSupportedMimeType,
  maxBytesForMime,
  uploadUrlRequestSchema,
  validateStoredDocumentBuffer,
} from "@/lib/documents/validation";
import { getEnv } from "@/lib/env";
import { DocumentUploadError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Week 2 Step 3: upload initiation and completion.
 *
 * Flow: `issueUploadCapability` (server picks the document ID and object key) → the browser
 * PUTs the bytes straight to private Storage with the signed token → `completeDocumentUpload`
 * re-reads the stored bytes, validates them and records the new version. Nothing the browser
 * says about the file (name, MIME, size, hash) is trusted.
 */

/** Supabase signed upload URLs have a fixed lifetime set by Storage, not by the caller. */
export const SIGNED_UPLOAD_URL_LIFETIME_SECONDS = 2 * 60 * 60;

/** Exported shipments are a filed record; their documents cannot change. */
const LOCKED_STATUSES: readonly ShipmentStatus[] = ["EXPORTED"];
const APPROVAL_STAGE_STATUSES: readonly ShipmentStatus[] = ["READY_FOR_APPROVAL", "APPROVED"];

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

type StorageDependencies = {
  supabaseAdmin?: SupabaseClient;
  bucket?: string;
};

function storageDeps(deps: StorageDependencies) {
  return {
    supabaseAdmin: deps.supabaseAdmin ?? createSupabaseAdminClient(),
    bucket: deps.bucket ?? getEnv().SUPABASE_STORAGE_BUCKET,
  };
}

function assertShipmentEditable(status: ShipmentStatus) {
  if (LOCKED_STATUSES.includes(status)) {
    throw new DocumentUploadError(
      "This shipment has been exported. Its documents can no longer be changed.",
      "SHIPMENT_LOCKED",
      409,
    );
  }
}

function staleRevisionError(expected: number, current: number) {
  return new DocumentUploadError(
    `Shipment revision conflict: expected revision ${expected}, but current revision is ${current}.`,
    "STALE_REVISION",
    409,
  );
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STORAGE_KEY_PATTERN = new RegExp(
  `^shipments/(${UUID})/documents/(${UUID})/${UUID}\\.(pdf|png|jpg)$`,
  "i",
);

/**
 * The completion request names a storage key; it must be exactly the shape this server issues
 * for *this* shipment and *this* document ID. This stops a client from attaching an object that
 * belongs to another shipment (whose key carries that shipment's ID).
 */
export function assertIssuedStorageKey(storageKey: string, shipmentId: string, documentId: string) {
  const match = STORAGE_KEY_PATTERN.exec(storageKey);
  if (
    !match ||
    match[1].toLowerCase() !== shipmentId.toLowerCase() ||
    match[2].toLowerCase() !== documentId.toLowerCase()
  ) {
    throw new DocumentUploadError(
      "The upload reference is not valid for this shipment. Start the upload again.",
      "INVALID_STORAGE_KEY",
      400,
    );
  }
  return match[3].toLowerCase() as "pdf" | "png" | "jpg";
}

/** Keeps a readable display name only: no path components or control characters. */
export function sanitizeDisplayFileName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  return cleaned || "document";
}

/** Best-effort removal of an object that no Document row references. Never throws. */
async function removeUnreferencedObject(
  prisma: PrismaClient,
  storageKey: string,
  deps: { supabaseAdmin: SupabaseClient; bucket: string },
) {
  try {
    const referenced = await prisma.document.findFirst({ where: { storageKey }, select: { id: true } });
    if (referenced) return;
    await deps.supabaseAdmin.storage.from(deps.bucket).remove([storageKey]);
  } catch {
    // Cleanup failure leaves an orphaned private object; it is never linked to a shipment.
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Upload initiation                                                                           */
/* ------------------------------------------------------------------------------------------ */

export async function issueUploadCapability(
  prisma: PrismaClient,
  params: { shipmentId: string; appUser: StorageAppUser; body: unknown } & StorageDependencies,
) {
  const input = uploadUrlRequestSchema.parse(params.body);
  const shipment = await authorizeShipmentAccess(prisma, params.shipmentId, params.appUser);

  assertShipmentEditable(shipment.status);
  if (shipment.currentRevision !== input.expectedRevision) {
    throw staleRevisionError(input.expectedRevision, shipment.currentRevision);
  }

  if (!isSupportedMimeType(input.declaredMimeType)) {
    throw new DocumentUploadError(
      "Only PDF, PNG, and JPEG documents are supported.",
      "INVALID_MIME",
      400,
    );
  }

  const maxBytes = maxBytesForMime(input.declaredMimeType);
  if (input.fileSizeBytes !== undefined) {
    if (input.fileSizeBytes === 0) {
      throw new DocumentUploadError("The file must be greater than 0 bytes.", "EMPTY_FILE", 400);
    }
    if (input.fileSizeBytes > maxBytes) {
      throw new DocumentUploadError(
        `The file exceeds the maximum allowed size of ${maxBytes} bytes.`,
        "FILE_OVERSIZED",
        413,
      );
    }
  }

  // The document ID doubles as the completion idempotency key: completing it twice is a replay.
  const documentId = randomUUID();
  const storageKey = buildStorageKey({
    shipmentId: shipment.id,
    documentId,
    originalFileName: input.fileName,
    extension: EXTENSION_BY_MIME[input.declaredMimeType],
  });

  const { supabaseAdmin, bucket } = storageDeps(params);
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUploadUrl(storageKey, { upsert: false });

  if (error || !data?.signedUrl || !data.token) {
    throw new DocumentUploadError(
      "Secure upload is temporarily unavailable. Try again shortly.",
      "STORAGE_UNAVAILABLE",
      503,
    );
  }

  return {
    documentId,
    storageKey,
    bucket,
    signedUploadUrl: data.signedUrl,
    token: data.token,
    idempotencyToken: documentId,
    expectedRevision: shipment.currentRevision,
    maxBytes,
    expiresInSeconds: SIGNED_UPLOAD_URL_LIFETIME_SECONDS,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Recording versions                                                                          */
/* ------------------------------------------------------------------------------------------ */

export type VersionToRecord = {
  version: NewDocumentVersion;
  replacedDocumentId: string | null;
};

/**
 * Creates one or more document versions and bumps the shipment revision exactly once, in a
 * single transaction. The revision bump is conditional on `expectedRevision` (optimistic lock):
 * the shipment row lock serializes concurrent writers, and the loser sees a stale revision.
 * A new revision means no approval matches it any more, so any prior approval is invalidated.
 */
export async function recordDocumentVersions(
  prisma: PrismaClient,
  params: {
    shipmentId: string;
    expectedRevision: number;
    actorId: string;
    versions: VersionToRecord[];
    extraAudit?: { action: string; metadata: Record<string, unknown> };
  },
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.shipment.findUnique({
      where: { id: params.shipmentId },
      select: { status: true, currentRevision: true },
    });
    if (!before) throw new Error("Shipment not found or inaccessible.");
    assertShipmentEditable(before.status);

    const bumped = await tx.shipment.updateMany({
      where: {
        id: params.shipmentId,
        currentRevision: params.expectedRevision,
        status: { notIn: [...LOCKED_STATUSES] },
      },
      data: { currentRevision: { increment: 1 }, status: "IN_REVIEW" },
    });
    if (bumped.count !== 1) {
      throw staleRevisionError(params.expectedRevision, before.currentRevision);
    }

    const newRevision = params.expectedRevision + 1;
    const approvalInvalidated = APPROVAL_STAGE_STATUSES.includes(before.status);
    const documents = [];

    for (const item of params.versions) {
      const document = await createDocumentVersionInTransaction(tx, item.version);
      documents.push(document);

      await tx.auditEvent.create({
        data: {
          shipmentId: params.shipmentId,
          actorId: params.actorId,
          action: item.replacedDocumentId ? "DOCUMENT_REPLACED" : "DOCUMENT_UPLOADED",
          entityType: "Document",
          entityId: document.id,
          metadata: {
            documentType: item.version.selectedDocType,
            documentVersion: document.documentVersion,
            originalFileName: item.version.originalFileName,
            sha256: item.version.sha256,
            sizeBytes: item.version.sizeBytes,
            pageCount: item.version.pageCount ?? null,
            previousRevision: params.expectedRevision,
            revision: newRevision,
            previousStatus: before.status,
            approvalInvalidated,
            replacedDocumentId: item.replacedDocumentId,
          },
        },
      });
    }

    if (params.extraAudit) {
      await tx.auditEvent.create({
        data: {
          shipmentId: params.shipmentId,
          actorId: params.actorId,
          action: params.extraAudit.action,
          entityType: "Shipment",
          entityId: params.shipmentId,
          metadata: { ...params.extraAudit.metadata, revision: newRevision },
        },
      });
    }

    return { documents, shipmentRevision: newRevision, previousStatus: before.status };
  }, TRANSACTION_OPTIONS);
}

/* ------------------------------------------------------------------------------------------ */
/* Upload completion                                                                           */
/* ------------------------------------------------------------------------------------------ */

export async function completeDocumentUpload(
  prisma: PrismaClient,
  params: { shipmentId: string; appUser: StorageAppUser; body: unknown } & StorageDependencies,
) {
  const input = completeUploadRequestSchema.parse(params.body);
  const shipment = await authorizeShipmentAccess(prisma, params.shipmentId, params.appUser);
  const keyExtension = assertIssuedStorageKey(input.storageKey, shipment.id, input.documentId);

  // 1. Replay: completing the same upload again returns the recorded version (idempotent).
  const existing = await prisma.document.findUnique({ where: { id: input.documentId } });
  if (existing) {
    if (existing.shipmentId === shipment.id && existing.storageKey === input.storageKey) {
      return {
        status: 200 as const,
        document: existing,
        shipmentRevision: shipment.currentRevision,
        replayed: true,
      };
    }
    throw new DocumentUploadError(
      "This document upload has already been completed.",
      "DUPLICATE_COMPLETION",
      409,
    );
  }

  assertShipmentEditable(shipment.status);
  if (shipment.currentRevision !== input.expectedRevision) {
    throw staleRevisionError(input.expectedRevision, shipment.currentRevision);
  }

  // 2. Read the server-observed bytes from private storage.
  const deps = storageDeps(params);
  const { data: blob, error: downloadError } = await deps.supabaseAdmin.storage
    .from(deps.bucket)
    .download(input.storageKey);

  if (downloadError || !blob) {
    throw new DocumentUploadError(
      "Uploaded file not found in storage. Ensure upload succeeded before completion.",
      "OBJECT_NOT_FOUND",
      404,
    );
  }

  try {
    // 3. Magic bytes, size, SHA-256, PDF parse and page count — all from stored bytes.
    const inspection = await validateStoredDocumentBuffer(
      new Uint8Array(await blob.arrayBuffer()),
      input.declaredMimeType,
    );
    if (EXTENSION_BY_MIME[inspection.mimeType] !== keyExtension) {
      throw new DocumentUploadError(
        "The file content does not match the type requested for this upload.",
        "INVALID_MAGIC_BYTES",
        415,
      );
    }

    // 4. Duplicate content and explicit replacement.
    const current = await getCurrentDocument(prisma, shipment.id, input.documentType);
    if (current) {
      if (current.sha256 === inspection.sha256) {
        throw new DocumentUploadError(
          "Identical document content is already uploaded for this slot.",
          "DUPLICATE_CONTENT",
          409,
        );
      }
      if (!input.allowReplacement) {
        throw new DocumentUploadError(
          `A ${input.documentType.replaceAll("_", " ").toLowerCase()} document already exists. Explicit replacement must be confirmed.`,
          "REPLACEMENT_REQUIRED",
          409,
        );
      }
    }

    // 5. Version, revision bump and audit in one transaction.
    const result = await recordDocumentVersions(prisma, {
      shipmentId: shipment.id,
      expectedRevision: input.expectedRevision,
      actorId: params.appUser.id,
      versions: [
        {
          version: {
            id: input.documentId,
            shipmentId: shipment.id,
            selectedDocType: input.documentType,
            storageKey: input.storageKey,
            originalFileName: sanitizeDisplayFileName(input.originalFileName),
            mimeType: inspection.mimeType,
            sizeBytes: inspection.sizeBytes,
            sha256: inspection.sha256,
            pageCount: inspection.pageCount,
            uploadedById: params.appUser.id,
          },
          replacedDocumentId: current?.id ?? null,
        },
      ],
    });

    return {
      status: 201 as const,
      document: result.documents[0],
      shipmentRevision: result.shipmentRevision,
      replayed: false,
    };
  } catch (error) {
    await removeUnreferencedObject(prisma, input.storageKey, deps);
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Server-side upload (synthetic sample loader)                                                */
/* ------------------------------------------------------------------------------------------ */

export type ServerSideFile = {
  documentType: DocumentType;
  displayFileName: string;
  bytes: Uint8Array;
};

/**
 * Validates, stores and records several files as one shipment revision. Used by the synthetic
 * sample loader so fixtures go through the same storage, validation, versioning and audit path
 * as browser uploads. Slots whose current content is byte-identical are skipped.
 */
export async function storeServerSideDocuments(
  prisma: PrismaClient,
  params: {
    shipmentId: string;
    appUser: StorageAppUser;
    expectedRevision?: number;
    files: ServerSideFile[];
    extraAudit?: { action: string; metadata: Record<string, unknown> };
  } & StorageDependencies,
) {
  const shipment = await authorizeShipmentAccess(prisma, params.shipmentId, params.appUser);
  assertShipmentEditable(shipment.status);
  const expectedRevision = params.expectedRevision ?? shipment.currentRevision;
  if (shipment.currentRevision !== expectedRevision) {
    throw staleRevisionError(expectedRevision, shipment.currentRevision);
  }

  const deps = storageDeps(params);
  const planned: Array<VersionToRecord & { storageKey: string }> = [];
  const skipped: DocumentType[] = [];

  for (const file of params.files) {
    const inspection = await validateStoredDocumentBuffer(file.bytes);
    const current = await getCurrentDocument(prisma, shipment.id, file.documentType);
    if (current?.sha256 === inspection.sha256) {
      skipped.push(file.documentType);
      continue;
    }

    const documentId = randomUUID();
    const storageKey = buildStorageKey({
      shipmentId: shipment.id,
      documentId,
      extension: EXTENSION_BY_MIME[inspection.mimeType],
    });
    planned.push({
      storageKey,
      replacedDocumentId: current?.id ?? null,
      version: {
        id: documentId,
        shipmentId: shipment.id,
        selectedDocType: file.documentType,
        storageKey,
        originalFileName: sanitizeDisplayFileName(file.displayFileName),
        mimeType: inspection.mimeType,
        sizeBytes: inspection.sizeBytes,
        sha256: inspection.sha256,
        pageCount: inspection.pageCount,
        uploadedById: params.appUser.id,
      },
    });
  }

  if (planned.length === 0) {
    throw new DocumentUploadError(
      "These documents are already loaded for this shipment.",
      "DUPLICATE_CONTENT",
      409,
    );
  }

  const uploaded: string[] = [];
  try {
    for (const item of planned) {
      const { error } = await deps.supabaseAdmin.storage
        .from(deps.bucket)
        .upload(item.storageKey, params.files.find((f) => f.documentType === item.version.selectedDocType)!.bytes, {
          contentType: item.version.mimeType,
          upsert: false,
        });
      if (error) {
        throw new DocumentUploadError(
          "Private storage rejected the upload. Try again shortly.",
          "STORAGE_UNAVAILABLE",
          503,
        );
      }
      uploaded.push(item.storageKey);
    }

    const result = await recordDocumentVersions(prisma, {
      shipmentId: shipment.id,
      expectedRevision,
      actorId: params.appUser.id,
      versions: planned,
      extraAudit: params.extraAudit
        ? {
            action: params.extraAudit.action,
            metadata: { ...params.extraAudit.metadata, skippedIdenticalSlots: skipped },
          }
        : undefined,
    });

    return { ...result, skipped };
  } catch (error) {
    for (const key of uploaded) await removeUnreferencedObject(prisma, key, deps);
    throw error;
  }
}
