import "server-only";

import { getEnv } from "@/lib/env";
import { CANONICAL_DECIMAL_REGEX } from "@/lib/ai/schemas/common";
import type {
  DocumentType,
  ExtractionAdapterOutput,
  NormalizedField,
  NormalizedLineItem,
  PageReadability,
  ReviewStatus,
} from "@/lib/ai/types";

export type FieldRequirement = "REQUIRED" | "OPTIONAL";

export type ReviewReasonCode =
  | "REQUIRED_FIELD_MISSING"
  | "LOW_MODEL_CONFIDENCE"
  | "MISSING_SOURCE_EVIDENCE"
  | "INVALID_FORMAT"
  | "OPTIONAL_FIELD_NOT_PRESENT"
  | "DOCUMENT_TYPE_MISMATCH"
  | "UNREADABLE_PAGE"
  | "MANUAL_ENTRY_REQUIRED";

export type FieldPolicyDefinition = {
  requirement: FieldRequirement;
  isNumeric?: boolean;
  isDate?: boolean;
};

/**
 * Trade document field requirement definitions:
 * Distinguishes mandatory customs/shipping fields from optional fields per document slot.
 */
export const DOCUMENT_FIELD_POLICIES: Record<DocumentType, Record<string, FieldPolicyDefinition>> = {
  INVOICE: {
    exporter: { requirement: "REQUIRED" },
    importer: { requirement: "REQUIRED" },
    documentNumber: { requirement: "REQUIRED" },
    issueDate: { requirement: "REQUIRED", isDate: true },
    currency: { requirement: "REQUIRED" },
    invoiceTotal: { requirement: "REQUIRED", isNumeric: true },
    incoterm: { requirement: "OPTIONAL" },
    packageCount: { requirement: "OPTIONAL", isNumeric: true },
    netWeight: { requirement: "OPTIONAL", isNumeric: true },
    grossWeight: { requirement: "OPTIONAL", isNumeric: true },
  },
  PACKING_LIST: {
    exporter: { requirement: "REQUIRED" },
    importer: { requirement: "REQUIRED" },
    documentNumber: { requirement: "REQUIRED" },
    issueDate: { requirement: "REQUIRED", isDate: true },
    packageCount: { requirement: "REQUIRED", isNumeric: true },
    grossWeight: { requirement: "REQUIRED", isNumeric: true },
    netWeight: { requirement: "OPTIONAL", isNumeric: true },
  },
  BILL_OF_LADING: {
    exporter: { requirement: "REQUIRED" },
    importer: { requirement: "REQUIRED" },
    documentNumber: { requirement: "REQUIRED" },
    issueDate: { requirement: "REQUIRED", isDate: true },
    packageCount: { requirement: "REQUIRED", isNumeric: true },
    grossWeight: { requirement: "REQUIRED", isNumeric: true },
    portOfLoading: { requirement: "REQUIRED" },
    portOfDischarge: { requirement: "REQUIRED" },
    vessel: { requirement: "OPTIONAL" },
    containerNumber: { requirement: "OPTIONAL" },
    netWeight: { requirement: "OPTIONAL", isNumeric: true },
  },
};

export type FieldReviewEvaluation = {
  fieldKey: string;
  value: string | null;
  unit: string | null;
  modelConfidence: number | null;
  confidenceLabel: "model estimate";
  sourceQuote: string | null;
  pageNumber: number | null;
  requirement: FieldRequirement;
  reviewStatus: ReviewStatus;
  reviewReason: ReviewReasonCode | null;
  /** The model's own evidence note (e.g. CALCULATED, BLURRED_MARGIN), kept for the reviewer. */
  modelReviewReason: string | null;
  isBlocker: boolean;
};

export type LineItemReviewEvaluation = {
  lineNumber: number;
  description: string | null;
  hsnCode: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  unitPrice: string | null;
  currency: string | null;
  lineTotal: string | null;
  modelConfidence: number | null;
  confidenceLabel: "model estimate";
  sourceQuote: string | null;
  pageNumber: number | null;
  reviewReason: ReviewReasonCode | null;
  requiresReview: boolean;
};

export type DocumentReviewPolicyEvaluation = {
  documentType: DocumentType;
  detectedType: DocumentType | null;
  typeMismatch: boolean;
  isBlocked: boolean;
  blockingReasons: string[];
  unreadablePages: number[];
  fields: FieldReviewEvaluation[];
  lineItems: LineItemReviewEvaluation[];
  requiresReviewCount: number;
  hasUnreadablePages: boolean;
  readyForApproval: boolean;
};

export function isValidDateFormat(value: string): boolean {
  const trimmed = value.trim();
  // Validates common dates (e.g., YYYY-MM-DD or DD/MM/YYYY or standard ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return !Number.isNaN(d.getTime());
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) {
    return true;
  }
  const timestamp = Date.parse(trimmed);
  return !Number.isNaN(timestamp);
}

/**
 * Week 3 Step 4: Deterministic Extraction Review Policy Service
 * Pure and isolated per document — strictly prevents inferring missing values from other documents.
 */
export class ExtractionReviewPolicyService {
  private readonly threshold: number;

  constructor(customThreshold?: number) {
    this.threshold =
      customThreshold ?? getEnv().LOW_CONFIDENCE_THRESHOLD;
  }

  get lowConfidenceThreshold(): number {
    return this.threshold;
  }

  /**
   * Evaluates an individual field against requirement, confidence, evidence, and format rules.
   */
  evaluateField(
    documentType: DocumentType,
    fieldKey: string,
    fieldData?: Partial<NormalizedField> | null,
  ): FieldReviewEvaluation {
    const modelReviewReason = fieldData?.reviewReason?.trim() || null;
    return { ...this.evaluateFieldRules(documentType, fieldKey, fieldData), modelReviewReason };
  }

  private evaluateFieldRules(
    documentType: DocumentType,
    fieldKey: string,
    fieldData?: Partial<NormalizedField> | null,
  ): Omit<FieldReviewEvaluation, "modelReviewReason"> {
    const policy =
      DOCUMENT_FIELD_POLICIES[documentType]?.[fieldKey] ?? {
        requirement: "OPTIONAL" as const,
      };

    const value = fieldData?.value ?? null;
    const unit = fieldData?.unit ?? null;
    const modelConfidence =
      typeof fieldData?.modelConfidence === "number" ? fieldData.modelConfidence : null;
    const sourceQuote = fieldData?.sourceQuote?.trim() || null;
    const pageNumber =
      typeof fieldData?.pageNumber === "number" ? fieldData.pageNumber : null;

    // 1. Missing Value Evaluation
    if (value === null || value === undefined || value.trim().length === 0) {
      if (policy.requirement === "REQUIRED") {
        return {
          fieldKey,
          value: null,
          unit,
          modelConfidence,
          confidenceLabel: "model estimate",
          sourceQuote: null,
          pageNumber: null,
          requirement: "REQUIRED",
          reviewStatus: "REQUIRES_REVIEW",
          reviewReason: "REQUIRED_FIELD_MISSING",
          isBlocker: true,
        };
      }
      return {
        fieldKey,
        value: null,
        unit,
        modelConfidence,
        confidenceLabel: "model estimate",
        sourceQuote: null,
        pageNumber: null,
        requirement: "OPTIONAL",
        reviewStatus: "NOT_PRESENT",
        reviewReason: "OPTIONAL_FIELD_NOT_PRESENT",
        isBlocker: false,
      };
    }

    // 2. Format Validation
    if (policy.isNumeric && value) {
      if (!CANONICAL_DECIMAL_REGEX.test(value)) {
        return {
          fieldKey,
          value,
          unit,
          modelConfidence,
          confidenceLabel: "model estimate",
          sourceQuote,
          pageNumber,
          requirement: policy.requirement,
          reviewStatus: "REQUIRES_REVIEW",
          reviewReason: "INVALID_FORMAT",
          isBlocker: true,
        };
      }
    }

    if (policy.isDate && value) {
      if (!isValidDateFormat(value)) {
        return {
          fieldKey,
          value,
          unit,
          modelConfidence,
          confidenceLabel: "model estimate",
          sourceQuote,
          pageNumber,
          requirement: policy.requirement,
          reviewStatus: "REQUIRES_REVIEW",
          reviewReason: "INVALID_FORMAT",
          isBlocker: true,
        };
      }
    }

    // 3. Evidence Validation (Source Quote & Page Number)
    if (!sourceQuote || pageNumber === null || pageNumber < 1) {
      return {
        fieldKey,
        value,
        unit,
        modelConfidence,
        confidenceLabel: "model estimate",
        sourceQuote,
        pageNumber,
        requirement: policy.requirement,
        reviewStatus: "REQUIRES_REVIEW",
        reviewReason: "MISSING_SOURCE_EVIDENCE",
        isBlocker: true,
      };
    }

    // 4. Model Confidence Evaluation
    if (modelConfidence === null || modelConfidence < this.threshold) {
      return {
        fieldKey,
        value,
        unit,
        modelConfidence,
        confidenceLabel: "model estimate",
        sourceQuote,
        pageNumber,
        requirement: policy.requirement,
        reviewStatus: "REQUIRES_REVIEW",
        reviewReason: "LOW_MODEL_CONFIDENCE",
        isBlocker: true,
      };
    }

    // 5. Passed all automated checks -> Ready for initial human confirmation
    return {
      fieldKey,
      value,
      unit,
      modelConfidence,
      confidenceLabel: "model estimate",
      sourceQuote,
      pageNumber,
      requirement: policy.requirement,
      reviewStatus: "PENDING",
      reviewReason: null,
      isBlocker: false,
    };
  }

  /**
   * Evaluates line items against format, evidence, and confidence rules.
   */
  evaluateLineItem(item: NormalizedLineItem): LineItemReviewEvaluation {
    let reviewReason: ReviewReasonCode | null = null;
    let requiresReview = false;

    // Format validation on canonical numeric quantities & prices
    if (item.quantity && !CANONICAL_DECIMAL_REGEX.test(item.quantity)) {
      reviewReason = "INVALID_FORMAT";
      requiresReview = true;
    } else if (item.unitPrice && !CANONICAL_DECIMAL_REGEX.test(item.unitPrice)) {
      reviewReason = "INVALID_FORMAT";
      requiresReview = true;
    } else if (item.lineTotal && !CANONICAL_DECIMAL_REGEX.test(item.lineTotal)) {
      reviewReason = "INVALID_FORMAT";
      requiresReview = true;
    } else if (!item.sourceQuote || item.pageNumber === null || item.pageNumber < 1) {
      reviewReason = "MISSING_SOURCE_EVIDENCE";
      requiresReview = true;
    } else if (item.modelConfidence !== null && item.modelConfidence < this.threshold) {
      reviewReason = "LOW_MODEL_CONFIDENCE";
      requiresReview = true;
    }

    return {
      lineNumber: item.lineNumber,
      description: item.description,
      hsnCode: item.hsnCode,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit,
      unitPrice: item.unitPrice,
      currency: item.currency,
      lineTotal: item.lineTotal,
      modelConfidence: item.modelConfidence,
      confidenceLabel: "model estimate",
      sourceQuote: item.sourceQuote,
      pageNumber: item.pageNumber,
      reviewReason,
      requiresReview,
    };
  }

  /**
   * Evaluates entire document extraction output against all Step 4 review policy rules:
   * - Evaluates every defined field in the policy matrix
   * - Evaluates line items
   * - Evaluates page readability evidence (without using arbitrary average confidence)
   * - Flags wrong document type as document-level blocker
   */
  evaluateDocumentExtraction(params: {
    expectedDocumentType: DocumentType;
    extractionResult: ExtractionAdapterOutput;
  }): DocumentReviewPolicyEvaluation {
    const { expectedDocumentType, extractionResult } = params;
    const blockingReasons: string[] = [];

    // 1. Document Type Mismatch Blocker
    const detectedType = extractionResult.detectedType ?? null;
    const typeMismatch =
      extractionResult.typeMismatch ||
      (detectedType !== null && detectedType !== expectedDocumentType);

    if (typeMismatch) {
      blockingReasons.push(
        `Wrong document type detected: Document appears to be a ${detectedType ?? "UNKNOWN"}, but was submitted as ${expectedDocumentType}.`,
      );
    }

    // 2. Unreadable Pages Evaluation (based strictly on readability evidence, not average confidence)
    const pageReadability: PageReadability[] =
      extractionResult.pageReadability ?? [];
    const unreadablePages: number[] = [];

    for (const page of pageReadability) {
      if (!page.isReadable) {
        unreadablePages.push(page.pageNumber);
        blockingReasons.push(
          `Page ${page.pageNumber} is unreadable and requires manual fallback: ${page.reviewNote ?? "Unreadable content"}.`,
        );
      }
    }

    // 3. Field Review Evaluations across all expected fields in policy
    const fieldsMap = new Map<string, NormalizedField>();
    for (const field of extractionResult.fields) {
      fieldsMap.set(field.fieldKey, field);
    }

    const fieldPolicies = DOCUMENT_FIELD_POLICIES[expectedDocumentType] || {};
    const fieldEvaluations: FieldReviewEvaluation[] = [];

    for (const [fieldKey] of Object.entries(fieldPolicies)) {
      const fieldData = fieldsMap.get(fieldKey);
      const evalResult = this.evaluateField(
        expectedDocumentType,
        fieldKey,
        fieldData,
      );
      fieldEvaluations.push(evalResult);

      if (evalResult.isBlocker && evalResult.reviewReason === "REQUIRED_FIELD_MISSING") {
        blockingReasons.push(`Required field "${fieldKey}" is missing from ${expectedDocumentType}.`);
      }
    }

    // 4. Line Items Evaluation
    const lineItemEvaluations: LineItemReviewEvaluation[] =
      extractionResult.lineItems.map((item) => this.evaluateLineItem(item));

    const requiresReviewCount =
      fieldEvaluations.filter((f) => f.reviewStatus === "REQUIRES_REVIEW").length +
      lineItemEvaluations.filter((l) => l.requiresReview).length;

    const hasUnreadablePages = unreadablePages.length > 0;
    const isBlocked = blockingReasons.length > 0;
    const readyForApproval = !isBlocked && requiresReviewCount === 0;

    return {
      documentType: expectedDocumentType,
      detectedType,
      typeMismatch,
      isBlocked,
      blockingReasons,
      unreadablePages,
      fields: fieldEvaluations,
      lineItems: lineItemEvaluations,
      requiresReviewCount,
      hasUnreadablePages,
      readyForApproval,
    };
  }
}

