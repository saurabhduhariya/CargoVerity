import { describe, expect, it } from "vitest";

import { apiError } from "@/lib/api-response";

describe("API error responses", () => {
  it("turns duplicate shipment references into a safe conflict message", async () => {
    const response = apiError({
      code: "P2002",
      meta: { target: ["reference"] },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That shipment reference already exists. Choose a unique reference.",
      code: "CONFLICT",
    });
  });
});
