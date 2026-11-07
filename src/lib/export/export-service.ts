import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { summarizeClearance } from "@/lib/crosschecks/resolution-state";
import { getEnv } from "@/lib/env";
import { ReviewError } from "@/lib/errors";
import { canExport, EXPORTABLE_STATUSES } from "@/lib/export/guard";
import { getExportProfile, type ExportProfile, type ExportProfileResult, type ShipmentExportSnapshot } from "@/lib/export/profile";

/**
 * Week 5 Steps 4-5: one evaluation shared by the export preview and the CSV download, so the
 * preview always shows exactly what the guarded download would produce.
 */

export const REQUIRED_EXPORT_DOC_TYPES = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const;
export const PREVIEW_ROW_LIMIT = 10;

export type ExportActor = { id: string; role: "EXECUTIVE" | "MANAGER" };

export type ExportBlockerDetail = { code: string; detail?: string };

export function safeExportFileName(reference: string, profileId: string, revision: number) {
  const safeReference = reference.normalize("NFKD").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 80) || "shipment";
  return `${safeReference}-${profileId}-rev${revision}.csv`;
}

function sha256(text: string) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Loads the current shipment snapshot and evaluates every export gate. */
export async function evaluateExport(prisma: PrismaClient, actor: ExportActor, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, ...(actor.role === "MANAGER" ? {} : { createdById: actor.id }) },
    include: {
      supplier: true,
      exportEvents: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: { exportedBy: { select: { email: true, fullName: true } } },
      },
      documents: {
        where: { isCurrent: true },
        include: {
          // Only the latest COMPLETED extraction is the reviewed snapshot (failed/running runs are ignored).
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            include: { fields: true, lineItems: { orderBy: [{ lineNumber: "asc" }, { id: "asc" }] } },
          },
        },
      },
    },
  });
  if (!shipment) throw new ReviewError("Shipment not found or inaccessible.", "SHIPMENT_NOT_FOUND", 404);

  const approval = await prisma.approval.findUnique({
    where: { shipmentId_revision: { shipmentId, revision: shipment.currentRevision } },
    include: { approvedBy: { select: { email: true, fullName: true } } },
  });

  // Checks: the latest run, and only if it belongs to the current revision.
  const latestRun = await prisma.crossCheckRun.findFirst({
    where: { shipmentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { results: { include: { resolutions: true } } },
  });
  const currentRun = latestRun && latestRun.revision === shipment.currentRevision ? latestRun : null;
  const clearance = summarizeClearance(currentRun?.results ?? [], { isLatestRun: true, atCurrentRevision: true });

  const profileId = getEnv().EXPORT_PROFILE_ID || "demo-v1";
  const profile: ExportProfile = getExportProfile(profileId);

  const hasCurrentDocuments = REQUIRED_EXPORT_DOC_TYPES.every((type) =>
    shipment.documents.some((d) => d.selectedDocType === type && d.extractionRuns.length > 0),
  );

  const snapshot: ShipmentExportSnapshot = {
    shipmentReference: shipment.reference,
    supplierName: shipment.supplier?.name ?? null,
    importerName: shipment.importerName ?? null,
    approvedBy: approval?.approvedBy?.fullName ?? approval?.approvedBy?.email ?? null,
    approvedAt: approval?.approvedAt ?? null,
    approvedRevision: approval?.revision ?? null,
    documents: shipment.documents.flatMap((document) => {
      const run = document.extractionRuns[0];
      return run ? [{ docType: document.selectedDocType, fields: run.fields, lineItems: run.lineItems }] : [];
    }),
  };

  const validation = profile.validate(snapshot);
  const guard = canExport({
    shipmentStatus: shipment.status,
    hasManagerApproval: Boolean(approval),
    approvedRevision: approval?.revision ?? null,
    currentRevision: shipment.currentRevision,
    hasCurrentDocuments,
    hasMissingRequiredFields: !validation.valid,
    hasCurrentCheckRun: Boolean(currentRun),
    unresolvedStatuses: clearance.unresolvedStatuses,
    unapprovedExceptionCount: clearance.pendingManagerApproval.length,
    profileId,
  });

  // Exact blockers: guard reasons plus the specific fields and checks behind them.
  const blockerDetails: ExportBlockerDetail[] = [];
  for (const reason of guard.reasons) {
    if (reason === "required_fields_missing") continue; // replaced by the per-field entries below
    if (reason === "cross_checks_unresolved") {
      blockerDetails.push({ code: reason, detail: clearance.submissionBlockers.map((c) => c.ruleKey).join(", ") });
    } else if (reason === "unapproved_exceptions_present") {
      blockerDetails.push({ code: reason, detail: clearance.pendingManagerApproval.map((c) => c.ruleKey).join(", ") });
    } else {
      blockerDetails.push({ code: reason });
    }
  }
  for (const column of validation.missingFields) blockerDetails.push({ code: `missing_field_${column}` });
  for (const issue of validation.invalidFields) blockerDetails.push({ code: `invalid_field_${issue.column}`, detail: issue.problem });

  const fileName = safeExportFileName(shipment.reference, profile.id, shipment.currentRevision);
  let output: (ExportProfileResult & { checksumSha256: string }) | null = null;
  if (guard.allowed) {
    const generated = profile.generateRows(snapshot);
    output = { ...generated, checksumSha256: sha256(generated.csv) };
  }

  const lastExport = shipment.exportEvents[0] ?? null;

  return {
    shipment,
    approval,
    profile,
    ready: guard.allowed,
    blockers: blockerDetails.map((b) => b.code),
    blockerDetails,
    fileName,
    output,
    recentExport: lastExport
      ? {
          id: lastExport.id,
          profileId: lastExport.profileId,
          profileVersion: lastExport.profileVersion,
          revision: lastExport.revision,
          createdAt: lastExport.createdAt.toISOString(),
          exportedBy: lastExport.exportedBy?.fullName ?? lastExport.exportedBy?.email ?? null,
          checksumSha256: lastExport.checksumSha256 ?? undefined,
          fileName: lastExport.fileName ?? undefined,
          rowCount: lastExport.rowCount,
        }
      : null,
  };
}

export type ExportEvaluation = Awaited<ReturnType<typeof evaluateExport>>;

/** JSON body for ?preview=1 (same mapping as the download, first rows only). */
export function previewBody(evaluation: ExportEvaluation) {
  const { shipment, approval, profile, output } = evaluation;
  return {
    ready: evaluation.ready,
    allowed: evaluation.ready,
    ...(evaluation.ready ? {} : { error: `Export blocked: ${evaluation.blockers.join(", ")}.` }),
    blockers: evaluation.blockers,
    blockerDetails: evaluation.blockerDetails,
    profileId: profile.id,
    profileVersion: profile.version,
    assumptionLabel: profile.assumptionLabel,
    approvedRevision: approval?.revision ?? null,
    approvedAt: approval?.approvedAt ? approval.approvedAt.toISOString() : null,
    approvedBy: approval?.approvedBy?.fullName ?? approval?.approvedBy?.email ?? null,
    currentRevision: shipment.currentRevision,
    shipmentStatus: shipment.status,
    recentExport: evaluation.recentExport,
    ...(output
      ? {
          fileName: evaluation.fileName,
          headers: output.headers,
          rows: output.rows.slice(0, PREVIEW_ROW_LIMIT),
          rowCount: output.rows.length,
          previewRowLimit: PREVIEW_ROW_LIMIT,
          checksumSha256: output.checksumSha256,
        }
      : {}),
  };
}

/**
 * Records the export atomically. The conditional update succeeds only if the shipment is still
 * APPROVED/EXPORTED at the evaluated revision, so a concurrent edit or a second approval change
 * cannot slip in between the guard and the record.
 */
export async function recordExport(prisma: PrismaClient, actor: ExportActor, evaluation: ExportEvaluation) {
  const { shipment, profile, output, fileName } = evaluation;
  if (!evaluation.ready || !output) {
    throw new ReviewError(`Export blocked: ${evaluation.blockers.join(", ")}.`, "EXPORT_BLOCKED", 422);
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.shipment.updateMany({
      where: { id: shipment.id, currentRevision: shipment.currentRevision, status: { in: [...EXPORTABLE_STATUSES] } },
      data: { status: "EXPORTED" },
    });
    if (locked.count !== 1) {
      throw new ReviewError("The shipment changed while exporting. Refresh the preview and try again.", "STALE_REVISION", 409);
    }

    const exportEvent = await tx.exportEvent.create({
      data: {
        shipmentId: shipment.id,
        exportedById: actor.id,
        profileId: profile.id,
        profileVersion: profile.version,
        checksumSha256: output.checksumSha256,
        fileName,
        rowCount: output.rows.length,
        revision: shipment.currentRevision,
      },
    });

    await tx.auditEvent.create({
      data: {
        shipmentId: shipment.id,
        actorId: actor.id,
        action: "SHIPMENT_EXPORTED",
        entityType: "ExportEvent",
        entityId: exportEvent.id,
        metadata: {
          profileId: profile.id,
          profileVersion: profile.version,
          checksumSha256: output.checksumSha256,
          revision: shipment.currentRevision,
          fileName,
          rowCount: output.rows.length,
          byteSize: Buffer.byteLength(output.csv, "utf-8"),
          previousStatus: shipment.status,
          reExport: shipment.status === "EXPORTED",
        },
      },
    });

    return exportEvent;
  }, { maxWait: 10_000, timeout: 30_000 });
}
