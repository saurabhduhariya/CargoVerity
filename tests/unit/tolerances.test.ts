import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOLERANCES,
  resolveTolerances,
  serializeTolerances,
  weightToleranceKg,
  withinTolerance,
} from "@/lib/normalizers/tolerances";

describe("Week 4 tolerances", () => {
  it("defaults to ±0.01 money and ±0.5% weight with a 0 kg floor", () => {
    expect(serializeTolerances(DEFAULT_TOLERANCES)).toEqual({
      monetary: "0.01",
      weightKg: "0",
      weightPercent: "0.5",
      quantity: "0",
    });
  });

  it("computes the SHP-24811 tolerance as 0.5% of the larger weight (15.825 kg)", () => {
    const tolerance = weightToleranceKg(new Decimal(3165));
    expect(tolerance.equals("15.825")).toBe(true);
    expect(withinTolerance(new Decimal(45), tolerance)).toBe(false);
  });

  it("applies the absolute floor when it is larger than the percentage", () => {
    const tolerance = weightToleranceKg(new Decimal(100), { weightKg: new Decimal(2), weightPercent: new Decimal("0.5") });
    expect(tolerance.equals(2)).toBe(true);
  });

  it("is inclusive at the boundary", () => {
    expect(withinTolerance(new Decimal("0.01"), new Decimal("0.01"))).toBe(true);
    expect(withinTolerance(new Decimal("-0.01"), new Decimal("0.01"))).toBe(true);
    expect(withinTolerance(new Decimal("0.0100001"), new Decimal("0.01"))).toBe(false);
  });

  it("reads CHECK_* env values and falls back on invalid ones", () => {
    const resolved = resolveTolerances({
      CHECK_MONETARY_TOLERANCE: "0.05",
      CHECK_WEIGHT_TOLERANCE_KG: "1.5",
      CHECK_WEIGHT_TOLERANCE_PERCENT: "1",
    });
    expect(serializeTolerances(resolved)).toMatchObject({ monetary: "0.05", weightKg: "1.5", weightPercent: "1" });

    const fallback = resolveTolerances({
      CHECK_MONETARY_TOLERANCE: "-1",
      CHECK_WEIGHT_TOLERANCE_KG: "abc",
      CHECK_WEIGHT_TOLERANCE_PERCENT: "101",
    });
    expect(serializeTolerances(fallback)).toMatchObject({ monetary: "0.01", weightKg: "0", weightPercent: "0.5" });
  });
});
