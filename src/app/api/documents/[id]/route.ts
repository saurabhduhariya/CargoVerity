import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getAuthorizedDocumentDownloadUrl } from "@/lib/documents/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();

    // Check authorization and issue a short-lived signed download URL (300s)
    const result = await getAuthorizedDocumentDownloadUrl(prisma, {
      documentId: id,
      appUser,
      expiresInSeconds: 300,
    });

    if (!result) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json(
      { document: result.document, signedUrl: result.signedUrl },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
