import "server-only";

import { getEnv } from "@/lib/env";
import type { NormalizedField } from "@/lib/ai/types";

export { ExtractionReviewPolicyService, DOCUMENT_FIELD_POLICIES } from "@/lib/ai/review-policy.service";

export function fieldNeedsReview(
  field: Pick<NormalizedField, "value" | "modelConfidence" | "sourceQuote">,
): boolean {
  const threshold = getEnv().LOW_CONFIDENCE_THRESHOLD;

  return (
    field.value === null ||
    !field.sourceQuote ||
    field.modelConfidence === null ||
    field.modelConfidence < threshold
  );
}

export function confidenceReason(
  field: Pick<NormalizedField, "value" | "modelConfidence" | "sourceQuote">,
): string | null {
  if (field.value === null) return "missing_value";
  if (!field.sourceQuote) return "missing_source_evidence";
  if (field.modelConfidence === null) return "missing_model_confidence";
  if (field.modelConfidence < getEnv().LOW_CONFIDENCE_THRESHOLD) return "low_model_confidence";
  return null;
}
