import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { authorizeShipmentAccess, buildStorageKey } from "@/lib/documents/storage";
import { uploadUrlRequestSchema } from "@/lib/documents/validation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;
    const body = await request.json();
    const input = uploadUrlRequestSchema.parse(body);

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

    // 2. Validate declared MIME type
    const declaredMime = input.declaredMimeType;
    if (!["application/pdf", "image/png", "image/jpeg"].includes(declaredMime)) {
      return NextResponse.json(
        {
          error: "Only PDF, PNG, and JPEG documents are supported.",
          code: "INVALID_MIME",
        },
        { status: 400 },
      );
    }

    // 3. Validate declared file size against configured limits
    const env = getEnv();
    const maxBytes =
      declaredMime === "application/pdf" ? env.MAX_PDF_BYTES : env.MAX_IMAGE_BYTES;
    if (input.fileSizeBytes !== undefined) {
      if (input.fileSizeBytes <= 0) {
        return NextResponse.json(
          { error: "The file must be greater than 0 bytes.", code: "EMPTY_FILE" },
          { status: 400 },
        );
      }
      if (input.fileSizeBytes > maxBytes) {
        return NextResponse.json(
          {
            error: `The file exceeds the maximum allowed size of ${maxBytes} bytes.`,
            code: "FILE_OVERSIZED",
          },
          { status: 413 },
        );
      }
    }

    // 4. Generate random document UUID, object key, and idempotency token
    const documentId = randomUUID();
    const idempotencyToken = input.idempotencyToken ?? randomUUID();
    const storageKey = buildStorageKey({
      shipmentId: shipment.id,
      documentId,
      originalFileName: input.fileName,
      extension: input.extension,
    });

    // 5. Generate short-lived signed upload URL capability via Supabase Storage
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .createSignedUploadUrl(storageKey, { upsert: false });

    if (error || !data?.signedUrl) {
      throw new Error("Failed to create signed upload capability.");
    }

    return NextResponse.json(
      {
        documentId,
        storageKey,
        signedUploadUrl: data.signedUrl,
        token: data.token,
        idempotencyToken,
        expectedRevision: shipment.currentRevision,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

