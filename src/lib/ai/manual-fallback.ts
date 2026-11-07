import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import { PROMPT_VERSION } from "@/lib/ai/extraction-prompts";
import { DOCUMENT_FIELD_POLICIES, isValidDateFormat } from "@/lib/ai/review-policy.service";
import { CANONICAL_DECIMAL_REGEX, toCanonicalDecimalString } from "@/lib/ai/schemas/common";
import type { DocumentType } from "@/lib/ai/types";
import { ExtractionError } from "@/lib/errors";

/**
 * Week 3 Step 5: manual fallback.
 *
 * - The AI may report a page unreadable; a person (Executive or Manager) marks it for manual
 *   entry. That unlocks manual entry only for fields on that page and for required fields the
 *   AI did not find. If no AI run completed (failed, quota, unreadable scan) the whole document
 *   is unlocked. Every other field goes through the normal correction route.
 * - Manual values are saved explicitly, marked MANUAL_ENTRY, and recorded as a FieldCorrection
 *   with the actor and timestamp. AI runs, including failed ones, are never deleted or rewritten:
 *   when no AI run completed, manual values live in a separate "manual" run.
 * - Each change bumps the shipment revision (invalidating approval and cross-checks).
 */

export type ManualActor = { id: string; role: "EXECUTIVE" | "MANAGER" };

const EDIT_BLOCKED: readonly ShipmentStatus[] = ["APPROVED", "EXPORTED"];
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const markPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  manualEntryRequired: z.boolean().default(true),
  reviewNote: z.string().trim().max(500).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

export const manualFieldSchema = z.object({
  fieldKey: z.string().trim().min(1).max(100),
  value: z.string().max(500).nullable(),
  unit: z.string().trim().max(20).nullable().optional(),
  pageNumber: z.number().int().positive().optional(),
  reason: z.string().trim().min(1).max(500),
  expectedRevision: z.number().int().positive().optional(),
});

async function loadDocument(prisma: PrismaClient, documentId: string, actor: ManualActor) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      isCurrent: true,
      shipment: actor.role === "MANAGER" ? undefined : { createdById: actor.id },
    },
    include: { shipment: true, pages: true },
  });
  if (!document) throw new ExtractionError("Document not found or inaccessible.", "DOCUMENT_NOT_FOUND", 404);
  if (EDIT_BLOCKED.includes(document.shipment.status)) {
    throw new ExtractionError(
      `Cannot change a shipment with status ${document.shipment.status}.`,
      "EXTRACTION_LOCKED",
      409,
    );
  }
  return document;
}

function staleRevision() {
  return new ExtractionError("The shipment changed since you loaded it. Refresh and try again.", "STALE_REVISION", 409);
}

/** Fast pre-check; the conditional update inside the transaction is the authoritative guard. */
function assertFreshRevision(current: number, expected?: number) {
  if (expected !== undefined && expected !== current) throw staleRevision();
}

/** Bumps the revision inside the transaction; with expectedRevision it is a conditional update. */
async function bumpRevision(tx: Prisma.TransactionClient, shipmentId: string, expectedRevision?: number) {
  const bumped = await tx.shipment.updateMany({
    where: {
      id: shipmentId,
      status: { notIn: [...EDIT_BLOCKED] },
      ...(expectedRevision !== undefined ? { currentRevision: expectedRevision } : {}),
    },
    data: { currentRevision: { increment: 1 }, status: "NEEDS_REVIEW" },
  });
  if (bumped.count !== 1) throw staleRevision();
  return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
}

export async function markPageForManualEntry(
  prisma: PrismaClient,
  params: { documentId: string; actor: ManualActor; body: unknown },
) {
  const input = markPageSchema.parse(params.body);
  const document = await loadDocument(prisma, params.documentId, params.actor);
  assertFreshRevision(document.shipment.currentRevision, input.expectedRevision);
  if (document.pageCount !== null && input.pageNumber > document.pageCount) {
    throw new ExtractionError(
      `Page ${input.pageNumber} does not exist; this document has ${document.pageCount} page(s).`,
      "INVALID_PAGE",
      400,
    );
  }

  return prisma.$transaction(async (tx) => {
    const reviewNote = input.reviewNote ?? (input.manualEntryRequired ? "Marked for manual entry by reviewer." : null);
    // Only the manual-entry flag is a human decision; the AI's readability evidence is kept.
    const page = await tx.documentPage.upsert({
      where: { documentId_pageNumber: { documentId: document.id, pageNumber: input.pageNumber } },
      update: { manualEntryRequired: input.manualEntryRequired, ...(reviewNote ? { reviewNote } : {}) },
      create: {
        documentId: document.id,
        pageNumber: input.pageNumber,
        manualEntryRequired: input.manualEntryRequired,
        reviewNote,
      },
    });

    const shipment = await bumpRevision(tx, document.shipmentId, input.expectedRevision);

    await tx.auditEvent.create({
      data: {
        shipmentId: document.shipmentId,
        actorId: params.actor.id,
        action: input.manualEntryRequired ? "PAGE_MARKED_FOR_MANUAL_ENTRY" : "PAGE_MANUAL_ENTRY_CLEARED",
        entityType: "DocumentPage",
        entityId: page.id,
        metadata: {
          documentId: document.id,
          pageNumber: input.pageNumber,
          manualEntryRequired: input.manualEntryRequired,
          revision: shipment.currentRevision,
        },
      },
    });

    return { page, shipment };
  }, TX);
}

/** Validates and canonicalizes a manual value for the field's policy. */
export function normalizeManualValue(documentType: DocumentType, fieldKey: string, value: string | null) {
  const policy = DOCUMENT_FIELD_POLICIES[documentType][fieldKey];
  if (!policy) {
    throw new ExtractionError(`"${fieldKey}" is not a ${documentType.replaceAll("_", " ").toLowerCase()} field.`, "UNKNOWN_FIELD", 400);
  }
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    if (policy.requirement === "REQUIRED") {
      throw new ExtractionError(`"${fieldKey}" is required; enter the value shown on the document.`, "INVALID_FIELD_VALUE", 400);
    }
    return null;
  }
  if (policy.isNumeric) {
    const canonical = toCanonicalDecimalString(trimmed);
    if (!canonical || !CANONICAL_DECIMAL_REGEX.test(canonical)) {
      throw new ExtractionError(`"${fieldKey}" must be a number such as 3120 or 16320.50.`, "INVALID_FIELD_VALUE", 400);
    }
    return canonical;
  }
  if (policy.isDate && !isValidDateFormat(trimmed)) {
    throw new ExtractionError(`"${fieldKey}" must be a date such as 2026-10-15.`, "INVALID_FIELD_VALUE", 400);
  }
  return trimmed;
}

export async function saveManualField(
  prisma: PrismaClient,
  params: { documentId: string; actor: ManualActor; body: unknown },
) {
  const input = manualFieldSchema.parse(params.body);
  const document = await loadDocument(prisma, params.documentId, params.actor);
  assertFreshRevision(document.shipment.currentRevision, input.expectedRevision);
  const docType = document.selectedDocType as DocumentType;
  const value = normalizeManualValue(docType, input.fieldKey, input.value);

  if (input.pageNumber !== undefined && document.pageCount !== null && input.pageNumber > document.pageCount) {
    throw new ExtractionError(`Page ${input.pageNumber} does not exist on this document.`, "INVALID_PAGE", 400);
  }

  const latestRun = await prisma.extractionRun.findFirst({
    where: { documentId: document.id },
    orderBy: { createdAt: "desc" },
  });
  if (latestRun?.status === "PROCESSING") {
    throw new ExtractionError("Wait for the running extraction to finish before entering values.", "EXTRACTION_IN_PROGRESS", 409);
  }
  const completedRun = await prisma.extractionRun.findFirst({
    where: { documentId: document.id, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  const existingField = completedRun
    ? await prisma.extractedField.findUnique({
        where: { extractionRunId_fieldKey: { extractionRunId: completedRun.id, fieldKey: input.fieldKey } },
      })
    : null;

  // Unlock rule.
  const manualPages = new Set(document.pages.filter((p) => p.manualEntryRequired).map((p) => p.pageNumber));
  const fieldPage = input.pageNumber ?? existingField?.pageNumber ?? null;
  const aiCompleted = Boolean(completedRun && completedRun.provider !== "manual");
  const unlocked =
    !aiCompleted ||
    (manualPages.size > 0 &&
      ((fieldPage !== null && manualPages.has(fieldPage)) || !existingField || existingField.modelValue === null));
  if (!unlocked) {
    throw new ExtractionError(
      "Manual entry is only unlocked for pages marked for manual entry or values the AI could not read. Use field correction instead.",
      "MANUAL_ENTRY_NOT_UNLOCKED",
      409,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Anchor run: the latest completed run, or a dedicated manual run (one per document version).
    const runId =
      completedRun?.id ??
      (
        await tx.extractionRun.upsert({
          where: { idempotencyKey: `manual:${document.id}:v${document.documentVersion}` },
          update: {},
          create: {
            documentId: document.id,
            documentVersion: document.documentVersion,
            requestedById: params.actor.id,
            idempotencyKey: `manual:${document.id}:v${document.documentVersion}`,
            retryOfRunId: latestRun?.id ?? null,
            provider: "manual",
            model: "human-fallback",
            promptVersion: PROMPT_VERSION,
            status: "COMPLETED",
            pageCount: document.pageCount ?? 1,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        })
      ).id;

    const current = await tx.extractedField.findUnique({
      where: { extractionRunId_fieldKey: { extractionRunId: runId, fieldKey: input.fieldKey } },
    });

    const field = current
      ? await tx.extractedField.update({
          where: { id: current.id },
          data: {
            currentValue: value,
            unit: input.unit !== undefined ? input.unit : current.unit,
            pageNumber: fieldPage,
            reviewStatus: "MANUAL_ENTRY",
            reviewReason: input.reason,
          },
        })
      : await tx.extractedField.create({
          data: {
            documentId: document.id,
            extractionRunId: runId,
            fieldKey: input.fieldKey,
            modelValue: null,
            currentValue: value,
            unit: input.unit ?? null,
            pageNumber: fieldPage,
            sourceQuote: null,
            modelConfidence: null,
            reviewStatus: "MANUAL_ENTRY",
            reviewReason: input.reason,
          },
        });

    await tx.fieldCorrection.create({
      data: {
        fieldId: field.id,
        previousValue: current?.currentValue ?? null,
        newValue: value,
        reason: input.reason,
        correctedById: params.actor.id,
      },
    });

    const shipment = await bumpRevision(tx, document.shipmentId, input.expectedRevision);

    await tx.auditEvent.create({
      data: {
        shipmentId: document.shipmentId,
        actorId: params.actor.id,
        action: "FIELD_MANUALLY_ENTERED",
        entityType: "ExtractedField",
        entityId: field.id,
        metadata: {
          documentId: document.id,
          extractionRunId: runId,
          fieldKey: input.fieldKey,
          previousValue: current?.currentValue ?? null,
          value,
          reason: input.reason,
          revision: shipment.currentRevision,
        },
      },
    });

    return { field, shipment };
  }, TX);

  return result;
}
