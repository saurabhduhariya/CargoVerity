import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();
    const document = await prisma.document.findFirst({
      where: {
        id,
        shipment: appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
      include: {
        extractionRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { fields: true, lineItems: true },
        },
      },
    });

    if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

    const { data, error } = await createSupabaseAdminClient()
      .storage
      .from(getEnv().SUPABASE_STORAGE_BUCKET)
      .createSignedUrl(document.storagePath, 300);
    if (error) throw new Error("Could not create a document preview URL.");

    return NextResponse.json(
      { document, signedUrl: data.signedUrl },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
