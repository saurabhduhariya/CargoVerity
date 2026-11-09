import { z } from "zod";

import type { Prisma, PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import { DOCUMENT_FIELD_POLICIES } from "@/lib/ai/review-policy.service";
import { normalizeManualValue } from "@/lib/ai/manual-fallback";
import type { DocumentType } from "@/lib/ai/types";
import * as crossCheckService from "@/lib/crosschecks/service";
import { evaluateClearance } from "@/lib/crosschecks/resolution-state";
import { ExtractionError, ReviewError, safeErrorCode } from "@/lib/errors";

/**
 * Week 4 Step 7: confirm / correct / manual-entry for one extracted field.
 *
 * - Editable only in pre-approval states (DRAFT, IN_REVIEW, NEEDS_REVIEW, READY_FOR_APPROVAL).
 * - `expectedRevision` is required. Inside ONE transaction a conditional update bumps the
 *   revision only if it still equals `expectedRevision` and the status is editable, so two
 *   concurrent edits at the same revision commit exactly one (the other gets 409).
 * - Field, FieldCorrection (for real changes), AuditEvent, revision bump and approval
 *   invalidation (READY_FOR_APPROVAL -> NEEDS_REVIEW) commit or roll back together.
 * - Only fields of the latest COMPLETED extraction of a current document can be edited.
 * - Cross-checks are recomputed after commit; if that fails the edit stays committed and the
 *   response says `crossChecksStale: true` (only a safe error code is logged).
 */

export type FieldActor = { id: string; role: "EXECUTIVE" | "MANAGER" };
export type FieldAction = "CONFIRMED" | "CORRECTED" | "MANUAL_ENTRY";

export const EDITABLE_FIELD_STATUSES: readonly ShipmentStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "NEEDS_REVIEW",
  "READY_FOR_APPROVAL",
];

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const reviewFieldSchema = z.object({
  status: z.enum(["CONFIRMED", "CORRECTED", "MANUAL_ENTRY"]),
  value: z.string().max(500).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
  expectedRevision: z.number().int().positive(),
  /**
   * Set to false to skip the cross-check recompute for this request. Only confirmations may skip
   * it: they change no value, so the caller recomputes once after a burst of confirmations. The
   * response then reports `crossChecksStale: true` until that recompute has run.
   */
  recompute: z.boolean().optional(),
});

export const correctFieldSchema = z.object({
  value: z.string().max(500).nullable(),
  reason: z.string().trim().min(3).max(500),
  expectedRevision: z.number().int().positive(),
});

function normalizeValue(documentType: DocumentType, fieldKey: string, value: string | null): string | null {
  const policy = DOCUMENT_FIELD_POLICIES[documentType]?.[fieldKey];
  try {
    if (policy) return normalizeManualValue(documentType, fieldKey, value);
  } catch (error) {
    if (error instanceof ExtractionError) throw new ReviewError(error.message, "INVALID_FIELD_VALUE", 422);
    throw error;
  }
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Canonical form used to decide whether a correction actually changes the value. */
function canonicalCurrent(documentType: DocumentType, fieldKey: string, value: string | null) {
  try {
    return normalizeValue(documentType, fieldKey, value);
  } catch {
    return value?.trim() ?? null;
  }
}

async function lockShipment(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  expectedRevision: number,
) {
  const before = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
  const bumped = await tx.shipment.updateMany({
    where: { id: shipmentId, currentRevision: expectedRevision, status: { in: [...EDITABLE_FIELD_STATUSES] } },
    data: { currentRevision: { increment: 1 }, status: "NEEDS_REVIEW" },
  });
  if (bumped.count !== 1) {
    const current = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
    if (current && !EDITABLE_FIELD_STATUSES.includes(current.status)) {
      throw new ReviewError(`Fields cannot be edited while the shipment is ${current.status}.`, "SHIPMENT_LOCKED", 409);
    }
    throw new ReviewError("The shipment changed since you loaded it. Refresh and try again.", "STALE_REVISION", 409);
  }
  const after = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  return { previousStatus: before?.status ?? null, shipment: after };
}

export async function applyFieldAction(
  prisma: PrismaClient,
  params: {
    fieldId: string;
    actor: FieldActor;
    action: FieldAction;
    value?: string | null;
    reason?: string | null;
    expectedRevision: number;
    route: "review" | "correction";
    /** Defaults to true. Honoured only for confirmations; any value change always recomputes. */
    recompute?: boolean;
  },
) {
  const { fieldId, actor, action, expectedRevision } = params;
  const reason = params.reason?.trim() || null;
  const recompute = action === "CONFIRMED" ? params.recompute !== false : true;

  const field = await prisma.extractedField.findFirst({
    where: {
      id: fieldId,
      document: actor.role === "MANAGER" ? undefined : { shipment: { createdById: actor.id } },
    },
    include: { document: { include: { shipment: true } } },
  });
  if (!field) throw new ReviewError("Field not found or inaccessible.", "FIELD_NOT_FOUND", 404);

  const shipment = field.document.shipment;
  const documentType = field.document.selectedDocType as DocumentType;

  // Fast pre-checks (the conditional update in the transaction is authoritative).
  if (!EDITABLE_FIELD_STATUSES.includes(shipment.status)) {
    throw new ReviewError(`Fields cannot be edited while the shipment is ${shipment.status}.`, "SHIPMENT_LOCKED", 409);
  }
  if (shipment.currentRevision !== expectedRevision) {
    throw new ReviewError("The shipment changed since you loaded it. Refresh and try again.", "STALE_REVISION", 409);
  }

  let targetValue: string | null;
  if (action === "CONFIRMED") {
    targetValue = field.currentValue;
    if (targetValue === null || targetValue.trim() === "") {
      throw new ReviewError("There is no value to confirm. Enter the value from the document instead.", "EMPTY_CONFIRM_VALUE", 422);
    }
  } else {
    if (!reason || reason.length < 3) {
      throw new ReviewError("A reason (at least 3 characters) is required to correct or enter a value.", "INVALID_FIELD_VALUE", 422);
    }
    targetValue = normalizeValue(documentType, field.fieldKey, params.value ?? null);
    if (targetValue === canonicalCurrent(documentType, field.fieldKey, field.currentValue)) {
      throw new ReviewError("The new value is the same as the current value; nothing was changed.", "NO_CHANGE", 422);
    }
  }

  const isValueChange = action !== "CONFIRMED";
  const auditAction = action === "CONFIRMED" ? "FIELD_CONFIRMED" : action === "CORRECTED" ? "FIELD_CORRECTED" : "FIELD_MANUAL_ENTRY";

  const committed = await prisma.$transaction(async (tx) => {
    const { previousStatus, shipment: updatedShipment } = await lockShipment(tx, shipment.id, expectedRevision);

    // With the revision lock held: only the latest completed extraction of a current document.
    const document = await tx.document.findUnique({ where: { id: field.documentId }, select: { isCurrent: true } });
    const latestRun = await tx.extractionRun.findFirst({
      where: { documentId: field.documentId, status: "COMPLETED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!document?.isCurrent || !latestRun || latestRun.id !== field.extractionRunId) {
      throw new ReviewError(
        "This value belongs to an older extraction or document version. Refresh to review the current values.",
        "FIELD_SUPERSEDED",
        409,
      );
    }

    const updatedField = await tx.extractedField.update({
      where: { id: field.id },
      data: {
        currentValue: targetValue,
        reviewStatus: action,
        reviewReason: action === "CONFIRMED" ? null : reason,
      },
    });

    if (isValueChange) {
      await tx.fieldCorrection.create({
        data: {
          fieldId: field.id,
          previousValue: field.currentValue,
          newValue: targetValue,
          reason: reason!,
          correctedById: actor.id,
        },
      });
    }

    const approvalInvalidated = previousStatus === "READY_FOR_APPROVAL";
    await tx.auditEvent.create({
      data: {
        shipmentId: shipment.id,
        actorId: actor.id,
        action: auditAction,
        entityType: "ExtractedField",
        entityId: field.id,
        metadata: {
          fieldKey: field.fieldKey,
          documentType,
          reason,
          modelValue: field.modelValue,
          previousValue: field.currentValue,
          newValue: targetValue,
          isMaterialChange: isValueChange,
          previousStatus,
          approvalInvalidated,
          expectedRevision,
          revision: updatedShipment.currentRevision,
          route: params.route,
        },
      },
    });

    return { updatedField, updatedShipment, previousStatus, approvalInvalidated };
  }, TX);

  const checks = recompute
    ? await recomputeAfterCommit(prisma, shipment.id, actor.id, auditAction)
    : { crossChecks: null, crossCheckRunId: null, crossChecksStale: true };

  return {
    field: committed.updatedField,
    revision: committed.updatedShipment.currentRevision,
    shipmentStatus: committed.updatedShipment.status,
    previousStatus: committed.previousStatus,
    approvalInvalidated: committed.approvalInvalidated,
    ...checks,
  };
}

/** Recompute after commit. A failure leaves the edit committed and reports stale checks. */
async function recomputeAfterCommit(prisma: PrismaClient, shipmentId: string, actorId: string, triggeredBy: string) {
  try {
    const run = await crossCheckService.createCrossCheckRun({
      shipmentId,
      requestedById: actorId,
      triggeredBy,
      prismaClient: prisma,
    });
    const crossChecks: unknown[] = run.results.map((result) => {
      const clearance = evaluateClearance(result);
      return {
        ...result,
        effectiveStatus: clearance.derivedStatus,
        derivedStatus: clearance.derivedStatus,
        activeResolution: null,
        clearedForSubmission: clearance.clearedForSubmission,
        clearedForApproval: clearance.clearedForApproval,
      };
    });
    return { crossChecks, crossCheckRunId: run.run.id as string | null, crossChecksStale: false };
  } catch (error) {
    console.error("[fields.recompute_failed]", safeErrorCode(error));
    return { crossChecks: null, crossCheckRunId: null, crossChecksStale: true };
  }
}

export const confirmFieldsSchema = z.object({
  fieldIds: z.array(z.string().uuid()).min(1).max(200),
  expectedRevision: z.number().int().positive(),
});

const CONFIRMABLE_STATUSES = ["PENDING", "REQUIRES_REVIEW"] as const;

/**
 * Confirms several fields of one document in a single request ("Confirm all").
 *
 * The same rules as a single confirmation apply to every field: access scope, editable shipment
 * status, required `expectedRevision`, latest completed extraction of a current document and a
 * non-empty saved value. All fields commit together with ONE revision bump and one audit event
 * per field, or nothing commits. Cross-checks are recomputed once after commit.
 */
export async function confirmFields(
  prisma: PrismaClient,
  params: { documentId: string; actor: FieldActor; body: unknown },
) {
  const input = confirmFieldsSchema.parse(params.body);
  const { actor } = params;
  const fieldIds = [...new Set(input.fieldIds)];
  const { expectedRevision } = input;

  const document = await prisma.document.findFirst({
    where: {
      id: params.documentId,
      ...(actor.role === "MANAGER" ? {} : { shipment: { createdById: actor.id } }),
    },
    include: { shipment: true },
  });
  if (!document) throw new ReviewError("Document not found or inaccessible.", "DOCUMENT_NOT_FOUND", 404);

  const shipment = document.shipment;
  const documentType = document.selectedDocType as DocumentType;
  if (!EDITABLE_FIELD_STATUSES.includes(shipment.status)) {
    throw new ReviewError(`Fields cannot be edited while the shipment is ${shipment.status}.`, "SHIPMENT_LOCKED", 409);
  }
  if (shipment.currentRevision !== expectedRevision) {
    throw new ReviewError("The shipment changed since you loaded it. Refresh and try again.", "STALE_REVISION", 409);
  }

  const fields = await prisma.extractedField.findMany({ where: { id: { in: fieldIds }, documentId: document.id } });
  if (fields.length !== fieldIds.length) {
    throw new ReviewError("One or more fields were not found on this document.", "FIELD_NOT_FOUND", 404);
  }
  const empty = fields.find((field) => !field.currentValue?.trim());
  if (empty) {
    throw new ReviewError(`${empty.fieldKey} has no value to confirm. Enter the value from the document instead.`, "EMPTY_CONFIRM_VALUE", 422);
  }
  const reviewed = fields.find((field) => !(CONFIRMABLE_STATUSES as readonly string[]).includes(field.reviewStatus));
  if (reviewed) {
    throw new ReviewError(`${reviewed.fieldKey} is already reviewed. Refresh to see the latest values.`, "FIELD_SUPERSEDED", 409);
  }

  const committed = await prisma.$transaction(async (tx) => {
    const { previousStatus, shipment: updatedShipment } = await lockShipment(tx, shipment.id, expectedRevision);

    const current = await tx.document.findUnique({ where: { id: document.id }, select: { isCurrent: true } });
    const latestRun = await tx.extractionRun.findFirst({
      where: { documentId: document.id, status: "COMPLETED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!current?.isCurrent || !latestRun || fields.some((field) => field.extractionRunId !== latestRun.id)) {
      throw new ReviewError(
        "These values belong to an older extraction or document version. Refresh to review the current values.",
        "FIELD_SUPERSEDED",
        409,
      );
    }

    // Conditional on the state that was validated, so a concurrent change cannot be overwritten.
    const updated = await tx.extractedField.updateMany({
      where: { id: { in: fieldIds }, extractionRunId: latestRun.id, reviewStatus: { in: [...CONFIRMABLE_STATUSES] } },
      data: { reviewStatus: "CONFIRMED", reviewReason: null },
    });
    if (updated.count !== fieldIds.length) {
      throw new ReviewError("A field changed since you loaded it. Refresh and try again.", "FIELD_SUPERSEDED", 409);
    }

    const approvalInvalidated = previousStatus === "READY_FOR_APPROVAL";
    await tx.auditEvent.createMany({
      data: fields.map((field) => ({
        shipmentId: shipment.id,
        actorId: actor.id,
        action: "FIELD_CONFIRMED" as const,
        entityType: "ExtractedField",
        entityId: field.id,
        metadata: {
          fieldKey: field.fieldKey,
          documentType,
          reason: null,
          modelValue: field.modelValue,
          previousValue: field.currentValue,
          newValue: field.currentValue,
          isMaterialChange: false,
          previousStatus,
          approvalInvalidated,
          expectedRevision,
          revision: updatedShipment.currentRevision,
          route: "confirm-all",
          batchSize: fields.length,
        },
      })),
    });

    const updatedFields = await tx.extractedField.findMany({ where: { id: { in: fieldIds } } });
    return { updatedFields, updatedShipment, previousStatus, approvalInvalidated };
  }, TX);

  const checks = await recomputeAfterCommit(prisma, shipment.id, actor.id, "FIELD_CONFIRMED");

  return {
    fields: committed.updatedFields,
    revision: committed.updatedShipment.currentRevision,
    shipmentStatus: committed.updatedShipment.status,
    previousStatus: committed.previousStatus,
    approvalInvalidated: committed.approvalInvalidated,
    ...checks,
  };
}

export function confirmOrReviewField(
  prisma: PrismaClient,
  params: { fieldId: string; actor: FieldActor; body: unknown },
) {
  const input = reviewFieldSchema.parse(params.body);
  return applyFieldAction(prisma, {
    fieldId: params.fieldId,
    actor: params.actor,
    action: input.status,
    value: input.value ?? null,
    reason: input.reason ?? null,
    expectedRevision: input.expectedRevision,
    route: "review",
    recompute: input.recompute,
  });
}

export function correctField(
  prisma: PrismaClient,
  params: { fieldId: string; actor: FieldActor; body: unknown },
) {
  const input = correctFieldSchema.parse(params.body);
  return applyFieldAction(prisma, {
    fieldId: params.fieldId,
    actor: params.actor,
    action: "CORRECTED",
    value: input.value,
    reason: input.reason,
    expectedRevision: input.expectedRevision,
    route: "correction",
  });
}
