import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import {
  loadSampleDocumentsIntoShipment,
  type SampleScenario,
} from "@/lib/documents/sample-loader";

const loadSampleSchema = z
  .object({
    scenario: z
      .enum(["SHP-24811", "SHP-24812", "SHP-24813", "SHP-24814", "SHP-24815"])
      .optional()
      .default("SHP-24811"),
    expectedRevision: z.number().int().positive().optional(),
  })
  .optional()
  .default({ scenario: "SHP-24811" });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id: shipmentId } = await context.params;

    let bodyData: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        bodyData = JSON.parse(text);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request payload.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const parsed = loadSampleSchema.safeParse(bodyData);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid sample scenario. Expected one of SHP-24811, SHP-24812, SHP-24813, SHP-24814, SHP-24815.",
          code: "INVALID_SCENARIO",
        },
        { status: 400 },
      );
    }

    const prisma = getPrisma();
    const result = await loadSampleDocumentsIntoShipment(prisma, {
      shipmentId,
      appUser,
      scenario: parsed.data.scenario as SampleScenario,
      expectedRevision: parsed.data.expectedRevision,
    });

    return NextResponse.json({
      success: true,
      shipment: result.shipment,
      documents: result.documents,
      skipped: result.skipped,
      message: `Loaded sample documents for ${parsed.data.scenario} into private storage.`,
    });
  } catch (error) {
    return apiError(error);
  }
}

