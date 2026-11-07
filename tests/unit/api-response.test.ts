import { describe, expect, it } from "vitest";

import { apiError } from "@/lib/api-response";

const DUPLICATE_REFERENCE = {
  error: "That shipment reference already exists. Choose a unique reference.",
  code: "CONFLICT",
};

describe("API error responses", () => {
  it("turns duplicate shipment references into a safe conflict message (classic meta.target)", async () => {
    const response = apiError({
      code: "P2002",
      meta: { target: ["reference"] },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(DUPLICATE_REFERENCE);
  });

  it("recognises the Prisma 7 pg driver-adapter P2002 shape observed against PostgreSQL", async () => {
    // Shape captured from a real duplicate insert through @prisma/adapter-pg.
    const response = apiError({
      code: "P2002",
      meta: {
        modelName: "Shipment",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            kind: "UniqueConstraintViolation",
            constraint: { index: "Shipment_reference_key" },
            table: "Shipment",
          },
        },
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(DUPLICATE_REFERENCE);
  });

  it("uses a generic conflict message for other unique constraints", async () => {
    const response = apiError({
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { index: "ExtractionRun_idempotencyKey_key" } } } },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A record with those details already exists.",
      code: "CONFLICT",
    });
  });
});
