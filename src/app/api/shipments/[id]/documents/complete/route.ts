import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { completeDocumentUpload } from "@/lib/documents/upload-service";

/**
 * Week 2 Step 3: validate the stored object and record the new document version.
 * Returns 201 for a new version and 200 when the same upload is completed again (replay).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;

    const result = await completeDocumentUpload(getPrisma(), {
      shipmentId,
      appUser,
      body: await request.json(),
    });

    return NextResponse.json(
      {
        document: result.document,
        shipmentRevision: result.shipmentRevision,
        replayed: result.replayed,
      },
      { status: result.status },
    );
  } catch (error) {
    return apiError(error);
  }
}
