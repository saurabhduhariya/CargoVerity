import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { ExtractionError } from "@/lib/errors";

export type BudgetStatus = {
  spentUsd: number;
  budgetUsd: number;
  percentUsed: number;
  alert: boolean;
  exhausted: boolean;
};

export function evaluateBudget(promptTokens: number, completionTokens: number, env = getEnv()): BudgetStatus {
  const spentUsd =
    (promptTokens * env.AI_INPUT_PRICE_PER_MTOK_USD + completionTokens * env.AI_OUTPUT_PRICE_PER_MTOK_USD) / 1_000_000;
  const percentUsed = (spentUsd / env.AI_MONTHLY_BUDGET_USD) * 100;
  return {
    spentUsd,
    budgetUsd: env.AI_MONTHLY_BUDGET_USD,
    percentUsed,
    alert: percentUsed >= env.AI_BUDGET_ALERT_PERCENT,
    exhausted: percentUsed >= 100,
  };
}

/** Estimated spend for the current UTC calendar month from stored token counters. */
export async function getMonthlyBudgetStatus(prisma: PrismaClient, now = new Date()): Promise<BudgetStatus> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const totals = await prisma.extractionRun.aggregate({
    where: { createdAt: { gte: monthStart } },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return evaluateBudget(totals._sum.promptTokens ?? 0, totals._sum.completionTokens ?? 0);
}

/**
 * Called before a NEW metered run starts. Writes a PII-free alert log at the alert threshold and
 * refuses new runs once the monthly budget is used; manual entry stays available.
 */
export async function assertAiBudgetAvailable(prisma: PrismaClient) {
  const status = await getMonthlyBudgetStatus(prisma);
  if (status.alert) {
    console.warn(
      JSON.stringify({
        event: "budget_alert",
        percentUsed: Math.round(status.percentUsed),
        spentUsd: Number(status.spentUsd.toFixed(2)),
        budgetUsd: status.budgetUsd,
      }),
    );
  }
  if (status.exhausted) {
    throw new ExtractionError(
      "The monthly AI extraction budget has been reached. Enter the values manually or ask an administrator to raise the budget.",
      "AI_BUDGET_REACHED",
      503,
    );
  }
}
