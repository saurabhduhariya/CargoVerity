import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { documentUploadMetadataSchema, validateUploadedFile } from "@/lib/documents/validation";
import { createDocumentVersion } from "@/lib/documents/service";
import {
  authorizeShipmentAccess,
  buildStorageKey,
  uploadDocumentBuffer,
} from "@/lib/documents/storage";

export async function POST(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const formData = await request.formData();
    const file = formData.get("file");
    const metadata = documentUploadMetadataSchema.parse({
      shipmentId: formData.get("shipmentId"),
      documentType: formData.get("documentType"),
    });

    if (!(file instanceof File)) throw new Error("A document file is required.");
    const fileInfo = await validateUploadedFile(file);
    const prisma = getPrisma();

    // 1. Authorize shipment access before issuing or performing upload
    const shipment = await authorizeShipmentAccess(prisma, metadata.shipmentId, appUser);

    // 2. Generate document ID and safe storage key without original filename
    const documentId = crypto.randomUUID();
    const storageKey = buildStorageKey({
      shipmentId: shipment.id,
      documentId,
      originalFileName: fileInfo.fileName,
    });

    // 3. Upload to private Supabase storage
    await uploadDocumentBuffer({
      storageKey,
      fileBuffer: await file.arrayBuffer(),
      mimeType: fileInfo.mimeType,
    });

    // 4. Create document version record linked to the exact storage key and document ID
    const document = await createDocumentVersion(prisma, {
      id: documentId,
      shipmentId: shipment.id,
      selectedDocType: metadata.documentType,
      storageKey,
      originalFileName: fileInfo.fileName,
      mimeType: fileInfo.mimeType,
      sizeBytes: fileInfo.sizeBytes,
      sha256: fileInfo.sha256,
      pageCount: fileInfo.pageCount,
      uploadedById: appUser.id,
    });

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: "IN_REVIEW", currentRevision: { increment: 1 } },
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
