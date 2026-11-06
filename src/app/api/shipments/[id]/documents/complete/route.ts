import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { createDocumentVersion, getCurrentDocument } from "@/lib/documents/service";
import { authorizeShipmentAccess } from "@/lib/documents/storage";
import {
  completeUploadRequestSchema,
  validateStoredDocumentBuffer,
} from "@/lib/documents/validation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;
    const body = await request.json();
    const input = completeUploadRequestSchema.parse(body);

    const prisma = getPrisma();
    const shipment = await authorizeShipmentAccess(prisma, shipmentId, appUser);

    // 1. Revision concurrency check (reject stale revisions)
    if (
      input.expectedRevision !== undefined &&
      shipment.currentRevision !== input.expectedRevision
    ) {
      return NextResponse.json(
        {
          error: `Shipment revision conflict: expected revision ${input.expectedRevision}, but current revision is ${shipment.currentRevision}.`,
          code: "STALE_REVISION",
        },
        { status: 409 },
      );
    }

    // 2. Reject duplicate completion for the same document ID
    const existingDoc = await prisma.document.findUnique({
      where: { id: input.documentId },
    });
    if (existingDoc) {
      return NextResponse.json(
        {
          error: "This document upload has already been completed.",
          code: "DUPLICATE_COMPLETION",
          document: existingDoc,
        },
        { status: 409 },
      );
    }

    // 3. Verify object existence in private storage and read server-observed bytes
    const env = getEnv();
    const supabase = createSupabaseAdminClient();
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .download(input.storageKey);

    if (downloadError || !fileBlob) {
      return NextResponse.json(
        {
          error:
            "Uploaded file not found in storage. Ensure upload succeeded before completion.",
          code: "OBJECT_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    // 4. Validate server-observed file: magic bytes, SHA-256, PDF parse & page count
    const arrayBuffer = await fileBlob.arrayBuffer();
    const inspection = await validateStoredDocumentBuffer(
      arrayBuffer,
      input.declaredMimeType,
    );

    // 5. Check duplicate content and replacement requirement
    const currentDoc = await getCurrentDocument(
      prisma,
      shipment.id,
      input.documentType,
    );
    if (currentDoc) {
      if (currentDoc.sha256 === inspection.sha256) {
        return NextResponse.json(
          {
            error: "Identical document content is already uploaded for this slot.",
            code: "DUPLICATE_CONTENT",
          },
          { status: 409 },
        );
      }
      if (!input.allowReplacement) {
        return NextResponse.json(
          {
            error: `A ${input.documentType.replace("_", " ")} document already exists. Explicit replacement must be confirmed.`,
            code: "REPLACEMENT_REQUIRED",
          },
          { status: 409 },
        );
      }
    }

    // 6. Create document version only after validation succeeds
    const document = await createDocumentVersion(prisma, {
      id: input.documentId,
      shipmentId: shipment.id,
      selectedDocType: input.documentType,
      storageKey: input.storageKey,
      originalFileName: input.originalFileName,
      mimeType: inspection.mimeType,
      sizeBytes: inspection.sizeBytes,
      sha256: inspection.sha256,
      pageCount: inspection.pageCount,
      uploadedById: appUser.id,
    });

    // 7. Increment shipment revision, set status to IN_REVIEW, and invalidate approval
    const newRevision = shipment.currentRevision + 1;
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: "IN_REVIEW",
        currentRevision: newRevision,
      },
    });

    // 8. Record audit event
    await prisma.auditEvent.create({
      data: {
        shipmentId: shipment.id,
        actorId: appUser.id,
        action: currentDoc ? "DOCUMENT_REPLACED" : "DOCUMENT_UPLOADED",
        entityType: "Document",
        entityId: document.id,
        metadata: {
          documentType: input.documentType,
          documentVersion: document.documentVersion,
          originalFileName: input.originalFileName,
          sha256: inspection.sha256,
          sizeBytes: inspection.sizeBytes,
          pageCount: inspection.pageCount,
          revision: newRevision,
          replacedDocumentId: currentDoc?.id ?? null,
        },
      },
    });

    return NextResponse.json(
      {
        document,
        shipmentRevision: newRevision,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

