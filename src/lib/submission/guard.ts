import { DocumentType } from "@/lib/ai/types";
import { DOCUMENT_FIELD_POLICIES } from "@/lib/ai/review-policy.service";
import { getEnv } from "@/lib/env";
import { getPrisma } from "@/lib/db";
import { evaluateClearance } from "@/lib/crosschecks/resolution-state";
import { ReviewError } from "@/lib/errors";

/** Minimal client surface used to load the guard input (PrismaClient or a transaction client). */
type SubmissionClient = Pick<ReturnType<typeof getPrisma>, "shipment">;
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

/** Statuses from which an Executive may submit for approval. */
export const SUBMITTABLE_STATUSES: readonly ShipmentStatus[] = ["DRAFT", "IN_REVIEW", "NEEDS_REVIEW"];

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
  | "DOCUMENT_NOT_EXTRACTED"
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

export type PendingManagerException = {
  checkId: string;
  checkRuleKey: string;
  resolutionId: string;
  evidence: string | null;
};

export type SubmissionGuardResult = {
  allowed: boolean;
  reasons: SubmissionBlockerCode[];
  blockingReasons: string[];
  blockers: SubmissionBlocker[];
  /** Failed checks cleared only by an accepted exception that still needs manager sign-off. */
  pendingManagerExceptions: PendingManagerException[];
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
  createdAt?: Date | null;
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

  // 2. Shipment status check: only DRAFT / IN_REVIEW / NEEDS_REVIEW can be submitted.
  if (!SUBMITTABLE_STATUSES.includes(input.shipmentStatus)) {
    blockers.push({
      code: "INVALID_SHIPMENT_STATUS",
      message:
        input.shipmentStatus === "READY_FOR_APPROVAL"
          ? "This shipment has already been submitted and is waiting for manager approval."
          : input.shipmentStatus === "EXTRACTING"
            ? "Extraction is still running. Wait for it to finish, review the values, then submit."
            : `Cannot submit a shipment that is already ${input.shipmentStatus.toLowerCase()}.`,
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

  const docsWithoutValues = new Set<DocumentType>();
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

    // No usable values: extraction failed with no manual fallback, or it never completed.
    // (Manual fallback values live in the latest completed run, so `fields` covers both paths.)
    if (doc.fields.length === 0) {
      if (doc.extractionStatus === "FAILED") {
        blockers.push({
          code: "DOCUMENT_EXTRACTION_FAILED",
          documentType: requiredType,
          message: `Document ${formatDocTypeName(requiredType)} extraction failed and has no manual fallback fields. Retry extraction or enter the values manually.`,
        });
        docsWithoutValues.add(requiredType);
      } else if (doc.extractionStatus === "UPLOADED" || doc.extractionStatus === "PROCESSING") {
        blockers.push({
          code: "DOCUMENT_NOT_EXTRACTED",
          documentType: requiredType,
          message:
            doc.extractionStatus === "PROCESSING"
              ? `Extraction of the ${formatDocTypeName(requiredType)} is still running.`
              : `The ${formatDocTypeName(requiredType)} has not been extracted yet. Run extraction or enter the values manually.`,
        });
        docsWithoutValues.add(requiredType);
      }
    }
  }

  // Track unconfirmed fields to avoid duplicate blockers across checks
  const flaggedFieldIds = new Set<string>();

  // 5. Required fields must be present and confirmed (Rule 3)
  for (const requiredType of REQUIRED_DOCUMENT_TYPES) {
    const doc = currentDocsByType.get(requiredType);
    if (!doc) continue; // already blocked by Check 4
    if (docsWithoutValues.has(requiredType)) continue; // one exact reason instead of one per field

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
        const unconfirmed = pageFields.filter((f) => !CONFIRMED_REVIEW_STATUSES.includes(f.reviewStatus));
        // A page a reviewer marked for manual entry needs at least one entered value. A page only
        // the AI reported unreadable blocks on its unconfirmed values; missing required values are
        // already caught by the required-field gate, so a blank page cannot deadlock submission.
        const missingManualValues = page.manualEntryRequired && pageFields.length === 0;

        if (missingManualValues || unconfirmed.length > 0) {
          blockers.push({
            code: "UNREADABLE_PAGE_FIELD_UNCONFIRMED",
            documentType: doc.docType,
            pageNumber: page.pageNumber,
            message: missingManualValues
              ? `Page ${page.pageNumber} of ${formatDocTypeName(doc.docType)} is marked for manual entry but has no manually entered values yet.`
              : `Values from unreadable page ${page.pageNumber} of ${formatDocTypeName(doc.docType)} must be confirmed before submission (${unconfirmed
                  .map((f) => f.fieldKey)
                  .join(", ")}).`,
          });
        }
      }
    }
  }

  // 8. Cross-check results & resolutions check (Rules 6 & 7), via the shared clearance helper.
  //    Only a valid ACCEPTED_EXCEPTION clears a failing BLOCKING check; WARNING failures never block;
  //    SOURCE_CORRECTED / DOCUMENT_REPLACEMENT are audit links and never clear a current failure.
  const pendingManagerExceptions: PendingManagerException[] = [];
  if (input.latestCheckRun && input.latestCheckRun.revision === input.currentRevision) {
    for (const check of input.latestCheckRun.results) {
      const clearance = evaluateClearance(check, { isLatestRun: true, atCurrentRevision: true });
      // Rule 7: an exception that clears submission but not approval is explicitly pending.
      if (clearance.clearedForSubmission && clearance.blocksApproval && clearance.activeException) {
        pendingManagerExceptions.push({
          checkId: check.id,
          checkRuleKey: check.ruleKey,
          resolutionId: clearance.activeException.id,
          evidence: clearance.activeException.evidence ?? null,
        });
      }
      if (!clearance.blocksSubmission) continue;

      if (clearance.problem === "EXCEPTION_MISSING_EVIDENCE") {
        blockers.push({
          code: "ACCEPTED_EXCEPTION_MISSING_EVIDENCE",
          checkRuleKey: check.ruleKey,
          message: `Accepted exception for cross-check "${check.ruleKey}" requires external evidence or query reference.`,
        });
      } else if (clearance.problem === "EXCEPTION_MISSING_REASON") {
        blockers.push({
          code: "ACCEPTED_EXCEPTION_MISSING_REASON",
          checkRuleKey: check.ruleKey,
          message: `Accepted exception for cross-check "${check.ruleKey}" requires a valid explanation (minimum 5 characters).`,
        });
      } else {
        blockers.push({
          code: "UNRESOLVED_CROSS_CHECK",
          checkRuleKey: check.ruleKey,
          message: `Failed cross-check "${check.ruleKey}" (${check.status}) has not been resolved with a valid accepted exception or a corrected source.`,
        });
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
    pendingManagerExceptions,
  };
}

/**
 * Loads the guard input from the database. Executives only see their own shipments
 * (`actorId` scope); Managers see all. Returns null when the shipment is not visible.
 */
async function loadSubmissionInput(
  client: SubmissionClient,
  shipmentId: string,
  userRole: UserRole,
  actorId?: string,
): Promise<SubmissionGuardInput | null> {
  const shipment = await client.shipment.findFirst({
    where: {
      id: shipmentId,
      ...(userRole !== "MANAGER" && actorId ? { createdById: actorId } : {}),
    },
    include: {
      documents: {
        where: { isCurrent: true },
        include: {
          pages: true,
          // Only the latest completed run counts (the one reviewers and cross-checks use);
          // fields of superseded or failed runs stay in history but do not gate submission.
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            include: { fields: true },
          },
        },
      },
      crossCheckRuns: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          results: {
            include: {
              resolutions: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              },
            },
          },
        },
      },
    },
  });

  if (!shipment) return null;

  const latestCheckRun = shipment.crossCheckRuns[0] ?? null;

  return {
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
        modelConfidence: f.modelConfidence !== null && f.modelConfidence !== undefined ? Number(f.modelConfidence) : null,
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
              createdAt: res.createdAt,
            })),
          })),
        }
      : null,
  };
}

function shipmentNotFound() {
  return new ReviewError("Shipment not found or inaccessible.", "SHIPMENT_NOT_FOUND", 404);
}

/**
 * Server-side evaluation loading full shipment context from the database.
 * Pass `actorId` so Executives can only evaluate their own shipments.
 */
export async function evaluateShipmentSubmission(
  shipmentId: string,
  userRole: UserRole,
  options: { actorId?: string; prismaClient?: SubmissionClient } = {},
): Promise<SubmissionGuardResult & { currentRevision: number; shipmentStatus: ShipmentStatus }> {
  const client = options.prismaClient ?? getPrisma();
  const input = await loadSubmissionInput(client, shipmentId, userRole, options.actorId);
  if (!input) throw shipmentNotFound();
  return { ...evaluateSubmissionGuard(input), currentRevision: input.currentRevision, shipmentStatus: input.shipmentStatus };
}

/**
 * Executes shipment submission to manager (READY_FOR_APPROVAL).
 *
 * - Executive only; Executives can submit only their own shipments.
 * - `expectedRevision` (optional) must match the revision the reviewer saw (409 otherwise).
 * - Inside one transaction the shipment row is locked with a conditional no-op update at the
 *   evaluated revision, the guard is evaluated AGAIN on the locked state, and only then is the
 *   status changed. Any concurrent edit (all of which bump the revision) either commits first and
 *   makes the lock fail with 409, or waits until the submission has committed.
 */
export async function submitShipmentForApproval(
  shipmentId: string,
  appUser: { id: string; role: UserRole },
  options: { expectedRevision?: number; prismaClient?: ReturnType<typeof getPrisma> } = {},
) {
  if (appUser.role !== "EXECUTIVE") {
    throw new Error("FORBIDDEN");
  }

  const prisma = options.prismaClient ?? getPrisma();
  const preliminary = await evaluateShipmentSubmission(shipmentId, appUser.role, {
    actorId: appUser.id,
    prismaClient: prisma,
  });

  if (options.expectedRevision !== undefined && options.expectedRevision !== preliminary.currentRevision) {
    throw new ReviewError("The shipment changed since you loaded it. Refresh and review the latest values before submitting.", "STALE_REVISION", 409);
  }

  if (!preliminary.allowed) {
    return { success: false as const, status: 422, guardResult: preliminary };
  }

  const revision = preliminary.currentRevision;

  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.shipment.updateMany({
      where: { id: shipmentId, currentRevision: revision, status: { in: [...SUBMITTABLE_STATUSES] } },
      data: { currentRevision: revision },
    });
    if (locked.count !== 1) {
      const current = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
      if (current?.status === "READY_FOR_APPROVAL") {
        throw new ReviewError("This shipment has already been submitted for approval.", "SHIPMENT_LOCKED", 409);
      }
      if (current && !SUBMITTABLE_STATUSES.includes(current.status)) {
        throw new ReviewError(`A shipment with status ${current.status} cannot be submitted.`, "SHIPMENT_LOCKED", 409);
      }
      throw new ReviewError("The shipment changed while submitting. Refresh and review the latest values.", "STALE_REVISION", 409);
    }

    // Authoritative evaluation on the locked row.
    const input = await loadSubmissionInput(tx as unknown as SubmissionClient, shipmentId, appUser.role, appUser.id);
    if (!input) throw shipmentNotFound();
    const guardResult = evaluateSubmissionGuard(input);
    if (!guardResult.allowed) {
      return { success: false as const, guardResult };
    }

    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: "READY_FOR_APPROVAL" },
    });

    await tx.auditEvent.create({
      data: {
        shipmentId,
        actorId: appUser.id,
        action: "SHIPMENT_SUBMITTED_FOR_APPROVAL",
        entityType: "Shipment",
        entityId: shipmentId,
        metadata: {
          previousStatus: input.shipmentStatus,
          revision: updated.currentRevision,
          checkRunId: input.latestCheckRun?.id ?? null,
          pendingManagerExceptions: guardResult.pendingManagerExceptions,
        },
      },
    });

    return { success: true as const, shipment: updated, guardResult };
  }, { maxWait: 10_000, timeout: 30_000 });

  if (!outcome.success) {
    return { success: false as const, status: 422, guardResult: outcome.guardResult };
  }
  return { success: true as const, status: 200, shipment: outcome.shipment, guardResult: outcome.guardResult };
}
