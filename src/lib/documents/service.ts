import type { PrismaClient } from "@/generated/prisma/client";
import type { DocumentType } from "@/lib/ai/types";

type DocumentDatabase = Pick<PrismaClient, "document">;

export type NewDocumentVersion = {
  shipmentId: string;
  selectedDocType: DocumentType;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedById: string;
  pageCount?: number | null;
  detectedDocType?: DocumentType | null;
  typeMismatch?: boolean;
};

/** Return the one active source document for a shipment slot, if present. */
export function getCurrentDocument(
  db: DocumentDatabase,
  shipmentId: string,
  selectedDocType: DocumentType,
) {
  return db.document.findFirst({
    where: { shipmentId, selectedDocType, isCurrent: true },
    orderBy: { documentVersion: "desc" },
  });
}

/** Return all source versions, newest first, without deleting historical evidence. */
export function listDocumentVersions(
  db: DocumentDatabase,
  shipmentId: string,
  selectedDocType: DocumentType,
) {
  return db.document.findMany({
    where: { shipmentId, selectedDocType },
    orderBy: [{ documentVersion: "desc" }, { createdAt: "desc" }],
  });
}

/** Replace a slot atomically: retire the current version, then create the next one. */
export async function createDocumentVersion(
  prisma: PrismaClient,
  input: NewDocumentVersion,
) {
  return prisma.$transaction(async (transaction) => {
    const latest = await transaction.document.findFirst({
      where: { shipmentId: input.shipmentId, selectedDocType: input.selectedDocType },
      orderBy: { documentVersion: "desc" },
      select: { documentVersion: true },
    });

    await transaction.document.updateMany({
      where: {
        shipmentId: input.shipmentId,
        selectedDocType: input.selectedDocType,
        isCurrent: true,
      },
      data: { isCurrent: false },
    });

    return transaction.document.create({
      data: {
        shipmentId: input.shipmentId,
        docType: input.selectedDocType,
        selectedDocType: input.selectedDocType,
        detectedDocType: input.detectedDocType ?? null,
        typeMismatch: input.typeMismatch ?? false,
        documentVersion: (latest?.documentVersion ?? 0) + 1,
        isCurrent: true,
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        pageCount: input.pageCount ?? null,
        uploadedById: input.uploadedById,
      },
    });
  });
}
