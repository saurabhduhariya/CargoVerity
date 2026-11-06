import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import {
  createCrossCheckRun,
  getCrossCheckHistory,
  getLatestCrossCheckRun,
} from "@/lib/crosschecks/service";

/**
 * POST /api/shipments/[id]/crosschecks
 * Runs deterministic cross-checks using server-side current values,
 * creating an immutable CrossCheckRun snapshot and versioned CrossCheckResult rows.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();

    const shipment = await prisma.shipment.findFirst({
      where: {
        id,
        ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
      },
      select: { id: true },
    });

    if (!shipment) {
      throw new Error("Shipment not found or inaccessible.");
    }

    const { run, revision, results } = await createCrossCheckRun({
      shipmentId: shipment.id,
      requestedById: appUser.id,
      triggeredBy: "USER_REQUEST",
      prismaClient: prisma,
    });

    return NextResponse.json({
      runId: run.id,
      revision,
      results,
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * GET /api/shipments/[id]/crosschecks
 * Returns the latest check run, effective statuses, resolutions, and optional historical runs.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();

    const shipment = await prisma.shipment.findFirst({
      where: {
        id,
        ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
      },
      select: { id: true, currentRevision: true },
    });

    if (!shipment) {
      throw new Error("Shipment not found or inaccessible.");
    }

    const url = new URL(request.url);
    const includeHistory = url.searchParams.get("includeHistory") === "true";

    const latestRun = await getLatestCrossCheckRun({
      shipmentId: shipment.id,
      revision: shipment.currentRevision,
      prismaClient: prisma,
    });

    const history = includeHistory
      ? await getCrossCheckHistory({
          shipmentId: shipment.id,
          prismaClient: prisma,
        })
      : undefined;

    return NextResponse.json({
      shipmentId: shipment.id,
      currentRevision: shipment.currentRevision,
      latestRun,
      history,
    });
  } catch (error) {
    return apiError(error);
  }
}
