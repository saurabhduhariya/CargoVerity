import Decimal from "decimal.js";

/**
 * Week 4 Step 1: Configuration for rule-specific tolerances.
 * Centralizes comparison thresholds across monetary arithmetic,
 * weights, quantities, and string similarity scoring.
 */
export type ToleranceConfig = {
  monetary: Decimal;
  weightKg: Decimal;
  quantity: Decimal;
  partyNameSimilarityThreshold: number;
  itemDescriptionSimilarityThreshold: number;
};

export const DEFAULT_TOLERANCES: ToleranceConfig = {
  monetary: new Decimal("0.05"), // Up to 0.05 currency units for rounding variances
  weightKg: new Decimal("0.00"), // 0.00 kg strict weight comparison by default
  quantity: new Decimal("0.00"), // Exact item quantity comparison
  partyNameSimilarityThreshold: 0.85, // 85% token similarity for company/party names
  itemDescriptionSimilarityThreshold: 0.80, // 80% token similarity for item descriptions
};
