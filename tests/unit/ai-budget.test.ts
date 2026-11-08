import { describe, expect, it } from "vitest";

import { evaluateBudget } from "@/lib/ai/budget";
import { getEnv } from "@/lib/env";

describe("monthly AI budget (Week 6 Step 5)", () => {
  const env = {
    ...getEnv(),
    AI_MONTHLY_BUDGET_USD: 10,
    AI_BUDGET_ALERT_PERCENT: 80,
    AI_INPUT_PRICE_PER_MTOK_USD: 1,
    AI_OUTPUT_PRICE_PER_MTOK_USD: 4,
  };

  it("stays quiet below the alert threshold", () => {
    expect(evaluateBudget(1_000_000, 500_000, env)).toMatchObject({ spentUsd: 3, alert: false, exhausted: false });
  });

  it("alerts at the threshold and blocks at 100%", () => {
    expect(evaluateBudget(2_000_000, 1_500_000, env)).toMatchObject({ alert: true, exhausted: false });
    expect(evaluateBudget(2_000_000, 2_000_000, env)).toMatchObject({ alert: true, exhausted: true });
  });
});
