import { getEnv } from "@/lib/env";
import type { NormalizedField } from "@/lib/ai/types";

export function fieldNeedsReview(field: Pick<NormalizedField, "value" | "modelConfidence" | "sourceQuote">) {
  const threshold = getEnv().LOW_CONFIDENCE_THRESHOLD;

  return (
    field.value === null ||
    !field.sourceQuote ||
    field.modelConfidence === null ||
    field.modelConfidence < threshold
  );
}

export function confidenceReason(field: Pick<NormalizedField, "value" | "modelConfidence" | "sourceQuote">) {
  if (field.value === null) return "missing_value";
  if (!field.sourceQuote) return "missing_source_evidence";
  if (field.modelConfidence === null) return "missing_model_confidence";
  if (field.modelConfidence < getEnv().LOW_CONFIDENCE_THRESHOLD) return "low_model_confidence";
  return null;
}
