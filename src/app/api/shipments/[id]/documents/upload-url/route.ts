import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { issueUploadCapability } from "@/lib/documents/upload-service";

/**
 * Week 2 Step 3: issue a signed, single-object upload capability for private Storage.
 * The server picks the document ID and object key; see `issueUploadCapability`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;

    const capability = await issueUploadCapability(getPrisma(), {
      shipmentId,
      appUser,
      body: await request.json(),
    });

    return NextResponse.json(capability, {
      status: 201,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return apiError(error);
  }
}
