import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser, requireRole } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

const resolutionSchema = z.object({
  type: z.enum(["SOURCE_CORRECTED", "DOCUMENT_REPLACEMENT", "ACCEPTED_EXCEPTION"]),
  reason: z.string().trim().min(3).max(500),
  evidence: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const input = resolutionSchema.parse(await request.json());
    const current = input.type === "ACCEPTED_EXCEPTION" ? await requireRole("MANAGER") : await requireAppUser();
    const { appUser } = current;
    const { id } = await context.params;
    const prisma = getPrisma();
    const check = await prisma.crossCheckResult.findFirst({
      where: {
        id,
        shipment: appUser.role === "MANAGER" ? undefined : { createdById: appUser.id },
      },
    });
    if (!check) throw new Error("Cross-check not found or inaccessible.");

    const resolution = await prisma.crossCheckResolution.create({
      data: {
        crossCheckId: check.id,
        type: input.type,
        reason: input.reason,
        evidence: input.evidence ?? null,
        resolvedById: appUser.id,
        managerApprovedAt: input.type === "ACCEPTED_EXCEPTION" ? new Date() : null,
      },
    });

    return NextResponse.json({ resolution }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
