import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getPrisma } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { documentUploadMetadataSchema, validateUploadedFile } from "@/lib/documents/validation";

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
    const shipment = await prisma.shipment.findFirst({
      where: {
        id: metadata.shipmentId,
        ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
      },
    });

    if (!shipment) throw new Error("Shipment not found or inaccessible.");

    const path = `${shipment.id}/${crypto.randomUUID()}-${fileInfo.fileName}`;
    const storage = createSupabaseAdminClient();
    const { error: storageError } = await storage.storage
      .from(getEnv().SUPABASE_STORAGE_BUCKET)
      .upload(path, await file.arrayBuffer(), {
        contentType: fileInfo.mimeType,
        upsert: false,
      });

    if (storageError) throw new Error("Document storage upload failed.");

    const document = await prisma.document.create({
      data: {
        shipmentId: shipment.id,
        type: metadata.documentType,
        fileName: fileInfo.fileName,
        storagePath: path,
        mimeType: fileInfo.mimeType,
        fileSize: fileInfo.fileSize,
        uploadedById: appUser.id,
      },
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
