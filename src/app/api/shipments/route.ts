import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import {
  createShipment,
  listShipments,
  shipmentListQuerySchema,
} from "@/lib/shipment-service";

export async function GET(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const filters = shipmentListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );

    return NextResponse.json(await listShipments(getPrisma(), appUser, filters));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { appUser } = await requireAppUser();
    const shipment = await createShipment(getPrisma(), appUser, await request.json());

    return NextResponse.json({ shipment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
