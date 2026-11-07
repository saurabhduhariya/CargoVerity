import { DocumentType } from "@/lib/ai/types";
import { DOCUMENT_FIELD_POLICIES } from "@/lib/ai/review-policy.service";
import { getEnv } from "@/lib/env";
import { getPrisma } from "@/lib/db";
import type {
  ShipmentStatus,
  DocumentStatus,
  ReviewStatus,
  CrossCheckStatus,
  CrossCheckSeverity,
  ResolutionType,
  UserRole,
} from "@/generated/prisma/enums";

export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = [
  "INVOICE",
  "PACKING_LIST",
  "BILL_OF_LADING",
];

export const CONFIRMED_REVIEW_STATUSES: ReviewStatus[] = [
  "CONFIRMED",
  "CORRECTED",
  "MANUAL_ENTRY",
];

export type SubmissionBlockerCode =
  | "UNAUTHORIZED_ROLE"
  | "INVALID_SHIPMENT_STATUS"
  | "MISSING_REQUIRED_DOCUMENT"
  | "DOCUMENT_TYPE_MISMATCH"
  | "DOCUMENT_EXTRACTION_FAILED"
  | "REQUIRED_FIELD_MISSING"
  | "REQUIRED_FIELD_UNCONFIRMED"
  | "LOW_CONFIDENCE_FIELD_UNCONFIRMED"
  | "UNREADABLE_PAGE_FIELD_UNCONFIRMED"
  | "MISSING_CHECK_RUN"
  | "STALE_CHECK_RUN"
  | "UNRESOLVED_CROSS_CHECK"
  | "ACCEPTED_EXCEPTION_MISSING_EVIDENCE"
  | "ACCEPTED_EXCEPTION_MISSING_REASON";

export type SubmissionBlocker = {
  code: SubmissionBlockerCode;
  message: string;
  documentType?: DocumentType;
  fieldKey?: string;
  pageNumber?: number;
  checkRuleKey?: string;
};

export type SubmissionGuardResult = {
  allowed: boolean;
  reasons: SubmissionBlockerCode[];
  blockingReasons: string[];
  blockers: SubmissionBlocker[];
};

export type SubmissionGuardDocumentPage = {
  pageNumber: number;
  isReadable: boolean;
  manualEntryRequired: boolean;
};

export type SubmissionGuardField = {
  id: string;
  fieldKey: string;
  currentValue: string | null;
  modelConfidence: number | null;
  reviewStatus: ReviewStatus;
  reviewReason?: string | null;
  pageNumber?: number | null;
};

export type SubmissionGuardDocument = {
  id: string;
  docType: DocumentType;
  isCurrent: boolean;
  documentVersion: number;
  extractionStatus: DocumentStatus;
  typeMismatch?: boolean;
  pages: SubmissionGuardDocumentPage[];
  fields: SubmissionGuardField[];
};

export type SubmissionGuardResolution = {
  id: string;
  type: ResolutionType;
  reason: string;
  evidence?: string | null;
  managerApprovedAt: Date | null;
};

export type SubmissionGuardCrossCheck = {
  id: string;
  ruleKey: string;
  ruleCode?: string | null;
  status: CrossCheckStatus;
  severity: CrossCheckSeverity;
  resolutions: SubmissionGuardResolution[];
};

export type SubmissionGuardCheckRun = {
  id: string;
  revision: number;
  results: SubmissionGuardCrossCheck[];
};

export type SubmissionGuardInput = {
  shipmentId: string;
  currentRevision: number;
  shipmentStatus: ShipmentStatus;
  userRole: UserRole;
  documents: SubmissionGuardDocument[];
  latestCheckRun: SubmissionGuardCheckRun | null;
  lowConfidenceThreshold?: number;
};

function formatDocTypeName(type: DocumentType): string {
  switch (type) {
    case "INVOICE":
      return "Commercial Invoice";
    case "PACKING_LIST":
      return "Packing List";
    case "BILL_OF_LADING":
      return "Bill of Lading";
    default:
      return type;
  }
}

/**
 * Pure submission guard evaluating whether a shipment meets all criteria
 * to transition to READY_FOR_APPROVAL (Week 5 Step 1).
 */
export function evaluateSubmissionGuard(input: SubmissionGuardInput): SubmissionGuardResult {
  const blockers: SubmissionBlocker[] = [];
  const lowConfidenceThreshold =
    input.lowConfidenceThreshold ?? getEnv().LOW_CONFIDENCE_THRESHOLD ?? 0.85;

  // 1. Role requirement: Must be EXECUTIVE (Rule 9)
  if (input.userRole !== "EXECUTIVE") {
    blockers.push({
      code: "UNAUTHORIZED_ROLE",
      message: `Only documentation executives can submit shipments for approval (current role: ${input.userRole}).`,
    });
  }

  // 2. Shipment status check: Cannot submit if already approved or exported
  if (input.shipmentStatus === "APPROVED" || input.shipmentStatus === "EXPORTED") {
    blockers.push({
      code: "INVALID_SHIPMENT_STATUS",
      message: `Cannot submit a shipment that is already ${input.shipmentStatus.toLowerCase()}.`,
    });
  }

  // 3. Cross-check run revision check (Rule 8)
  if (!input.latestCheckRun) {
    blockers.push({
      code: "MISSING_CHECK_RUN",
      message: "Cross-checks have not been executed for this shipment. Run cross-checks before submission.",
    });
  } else if (input.latestCheckRun.revision !== input.currentRevision) {
    blockers.push({
      code: "STALE_CHECK_RUN",
      message: `Cross-checks are stale (check run revision ${input.latestCheckRun.revision} does not match current shipment revision ${input.currentRevision}). Re-run cross-checks before submission.`,
    });
  }

  // 4. Required documents & manual fallback check (Rule 2)
  const currentDocsByType = new Map<DocumentType, SubmissionGuardDocument>();
  for (const doc of input.documents) {
    if (doc.isCurrent) {
      currentDocsByType.set(doc.docType, doc);
    }
  }

  for (const requiredType of REQUIRED_DOCUMENT_TYPES) {
    const doc = currentDocsByType.get(requiredType);
    if (!doc) {
      blockers.push({
        code: "MISSING_REQUIRED_DOCUMENT",
        documentType: requiredType,
        message: `Missing required document: ${formatDocTypeName(requiredType)}.`,
      });
      continue;
    }

    if (doc.typeMismatch) {
      blockers.push({
        code: "DOCUMENT_TYPE_MISMATCH",
        documentType: requiredType,
        message: `Document ${formatDocTypeName(requiredType)} has an unresolved type mismatch.`,
      });
    }

    // If extraction failed and has no manual fallback fields entered
    if (doc.extractionStatus === "FAILED" && doc.fields.length === 0) {
      blockers.push({
        code: "DOCUMENT_EXTRACTION_FAILED",
        documentType: requiredType,
        message: `Document ${formatDocTypeName(requiredType)} extraction failed and has no manual fallback fields.`,
      });
    }
  }

  // Track unconfirmed fields to avoid duplicate blockers across checks
  const flaggedFieldIds = new Set<string>();

  // 5. Required fields must be present and confirmed (Rule 3)
  for (const requiredType of REQUIRED_DOCUMENT_TYPES) {
    const doc = currentDocsByType.get(requiredType);
    if (!doc) continue; // already blocked by Check 4

    const fieldPolicies = DOCUMENT_FIELD_POLICIES[requiredType] || {};
    for (const [fieldKey, policy] of Object.entries(fieldPolicies)) {
      if (policy.requirement !== "REQUIRED") continue;

      const field = doc.fields.find((f) => f.fieldKey === fieldKey);
      if (!field || field.currentValue === null || field.currentValue.trim() === "") {
        blockers.push({
          code: "REQUIRED_FIELD_MISSING",
          documentType: requiredType,
          fieldKey,
          message: `Required field "${fieldKey}" is missing in ${formatDocTypeName(requiredType)}.`,
        });
      } else if (!CONFIRMED_REVIEW_STATUSES.includes(field.reviewStatus)) {
        flaggedFieldIds.add(field.id);
        blockers.push({
          code: "REQUIRED_FIELD_UNCONFIRMED",
          documentType: requiredType,
          fieldKey,
          message: `Required field "${fieldKey}" in ${formatDocTypeName(requiredType)} must be confirmed or corrected before submission.`,
        });
      }
    }
  }

  // 6. Low-confidence values must be confirmed (Rule 4)
  for (const doc of input.documents) {
    if (!doc.isCurrent) continue;

    for (const field of doc.fields) {
      if (flaggedFieldIds.has(field.id)) continue;

      const isLowConfidence =
        (field.modelConfidence !== null && field.modelConfidence < lowConfidenceThreshold) ||
        field.reviewReason === "LOW_MODEL_CONFIDENCE" ||
        field.reviewReason === "LOW_CONFIDENCE" ||
        field.reviewReason === "low_model_confidence";

      if (isLowConfidence && !CONFIRMED_REVIEW_STATUSES.includes(field.reviewStatus)) {
        flaggedFieldIds.add(field.id);
        blockers.push({
          code: "LOW_CONFIDENCE_FIELD_UNCONFIRMED",
          documentType: doc.docType,
          fieldKey: field.fieldKey,
          message: `Field "${field.fieldKey}" in ${formatDocTypeName(doc.docType)} has low confidence (${(
            (field.modelConfidence ?? 0) * 100
          ).toFixed(0)}%) and must be confirmed or corrected.`,
        });
      }
    }
  }

  // 7. Unreadable-page manual fields must be confirmed (Rule 5)
  for (const doc of input.documents) {
    if (!doc.isCurrent) continue;

    for (const page of doc.pages) {
      if (!page.isReadable || page.manualEntryRequired) {
        const pageFields = doc.fields.filter((f) => f.pageNumber === page.pageNumber);
        const hasUnconfirmedPageFields =
          pageFields.length === 0 ||
          pageFields.some((f) => !CONFIRMED_REVIEW_STATUSES.includes(f.reviewStatus));

        if (hasUnconfirmedPageFields) {
          blockers.push({
            code: "UNREADABLE_PAGE_FIELD_UNCONFIRMED",
            documentType: doc.docType,
            pageNumber: page.pageNumber,
            message: `Manual fields for unreadable page ${page.pageNumber} of ${formatDocTypeName(
              doc.docType,
            )} must be confirmed before submission.`,
          });
        }
      }
    }
  }

  // 8. Cross-check results & resolutions check (Rules 6 & 7)
  if (input.latestCheckRun && input.latestCheckRun.revision === input.currentRevision) {
    for (const check of input.latestCheckRun.results) {
      const isFailed = check.status === "MISMATCH" || check.status === "INCOMPLETE";
      if (!isFailed) continue;

      if (!check.resolutions || check.resolutions.length === 0) {
        blockers.push({
          code: "UNRESOLVED_CROSS_CHECK",
          checkRuleKey: check.ruleKey,
          message: `Failed cross-check "${check.ruleKey}" (${check.status}) has not been resolved.`,
        });
        continue;
      }

      // Check active resolution (latest)
      const activeRes = check.resolutions[check.resolutions.length - 1];
      if (activeRes.type === "ACCEPTED_EXCEPTION") {
        // Rule 7: Accepted exception must have valid evidence and reason
        if (!activeRes.evidence || activeRes.evidence.trim().length < 3) {
          blockers.push({
            code: "ACCEPTED_EXCEPTION_MISSING_EVIDENCE",
            checkRuleKey: check.ruleKey,
            message: `Accepted exception for cross-check "${check.ruleKey}" requires external evidence or query reference.`,
          });
        }
        if (!activeRes.reason || activeRes.reason.trim().length < 5) {
          blockers.push({
            code: "ACCEPTED_EXCEPTION_MISSING_REASON",
            checkRuleKey: check.ruleKey,
            message: `Accepted exception for cross-check "${check.ruleKey}" requires a valid explanation (minimum 5 characters).`,
          });
        }
      }
    }
  }

  const allowed = blockers.length === 0;
  const reasons = Array.from(new Set(blockers.map((b) => b.code)));
  const blockingReasons = blockers.map((b) => b.message);

  return {
    allowed,
    reasons,
    blockingReasons,
    blockers,
  };
}

/**
 * Server-side evaluation loading full shipment context from the database.
 */
export async function evaluateShipmentSubmission(
  shipmentId: string,
  userRole: UserRole,
): Promise<SubmissionGuardResult> {
  const prisma = getPrisma();
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      documents: {
        where: { isCurrent: true },
        include: {
          pages: true,
          // Only the latest completed run counts (the one reviewers and cross-checks use);
          // fields of superseded or failed runs stay in history but do not gate submission.
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { fields: true },
          },
        },
      },
      crossCheckRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          results: {
            include: {
              resolutions: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!shipment) {
    throw new Error("Shipment not found.");
  }

  const latestCheckRun = shipment.crossCheckRuns[0] ?? null;

  const input: SubmissionGuardInput = {
    shipmentId: shipment.id,
    currentRevision: shipment.currentRevision,
    shipmentStatus: shipment.status,
    userRole,
    documents: shipment.documents.map((doc) => ({
      id: doc.id,
      docType: doc.selectedDocType as DocumentType,
      isCurrent: doc.isCurrent,
      documentVersion: doc.documentVersion,
      extractionStatus: doc.extractionStatus,
      typeMismatch: doc.typeMismatch,
      pages: doc.pages.map((p) => ({
        pageNumber: p.pageNumber,
        isReadable: p.isReadable,
        manualEntryRequired: p.manualEntryRequired,
      })),
      fields: (doc.extractionRuns[0]?.fields ?? []).map((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        currentValue: f.currentValue,
        modelConfidence: f.modelConfidence ? Number(f.modelConfidence) : null,
        reviewStatus: f.reviewStatus,
        reviewReason: f.reviewReason,
        pageNumber: f.pageNumber,
      })),
    })),
    latestCheckRun: latestCheckRun
      ? {
          id: latestCheckRun.id,
          revision: latestCheckRun.revision,
          results: latestCheckRun.results.map((r) => ({
            id: r.id,
            ruleKey: r.ruleKey,
            ruleCode: r.ruleCode,
            status: r.status,
            severity: r.severity,
            resolutions: r.resolutions.map((res) => ({
              id: res.id,
              type: res.type,
              reason: res.reason,
              evidence: res.evidence,
              managerApprovedAt: res.managerApprovedAt,
            })),
          })),
        }
      : null,
  };

  return evaluateSubmissionGuard(input);
}

/**
 * Executes shipment submission to manager (READY_FOR_APPROVAL).
 * Enforces role check, executes submission guard, and updates status in a transaction.
 */
export async function submitShipmentForApproval(
  shipmentId: string,
  appUser: { id: string; role: UserRole },
) {
  if (appUser.role !== "EXECUTIVE") {
    throw new Error("FORBIDDEN");
  }

  const guardResult = await evaluateShipmentSubmission(shipmentId, appUser.role);
  if (!guardResult.allowed) {
    return {
      success: false,
      status: 422,
      guardResult,
    };
  }

  const prisma = getPrisma();
  const updatedShipment = await prisma.$transaction(async (tx) => {
    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: "READY_FOR_APPROVAL",
      },
    });

    await tx.auditEvent.create({
      data: {
        shipmentId,
        actorId: appUser.id,
        action: "SHIPMENT_SUBMITTED_FOR_APPROVAL",
        entityType: "Shipment",
        entityId: shipmentId,
        metadata: {
          previousStatus: "NEEDS_REVIEW",
          revision: updated.currentRevision,
        },
      },
    });

    return updated;
  });

  return {
    success: true,
    status: 200,
    shipment: updatedShipment,
    guardResult,
  };
}
