import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireAppUser } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { canExport, selectLatestCrossChecks } from "@/lib/export/guard";
import { summarizeClearance } from "@/lib/crosschecks/resolution-state";
import { getExportProfile } from "@/lib/export/csv";

const REQUIRED_EXPORT_DOC_TYPES = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const;

/**
 * Week 5 Step 4: Guarded CSV Export Route
 *
 * 1. Authorizes user and shipment access (Rule 1).
 * 2. Loads current shipment snapshot from the database (Rule 2).
 * 3. Evaluates pure export guard:
 *    - Requires APPROVED status (Rule 4).
 *    - Requires approvedRevision === currentRevision (Rule 5).
 *    - Requires current documents and fields (Rule 6).
 *    - Requires current checks and resolutions to be clear and approved (Rule 7).
 *    - Loads approved export profile (Rule 8).
 * 4. Generates RFC 4180 CSV with line-item row expansion and formula sanitization (Rules 9-15).
 * 5. Returns text/csv with safe filename (Rule 16).
 * 6. Records ExportEvent and AuditEvent with SHA-256 checksum, profile/version, actor, and revision (Rule 17).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { appUser } = await requireAppUser();
    const { id } = await context.params;
    const prisma = getPrisma();

    // 1. Authorize user and shipment access (Rule 1)
    const shipment = await prisma.shipment.findFirst({
      where: {
        id,
        ...(appUser.role === "MANAGER" ? {} : { createdById: appUser.id }),
      },
      include: {
        supplier: true,
        exportEvents: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            exportedBy: { select: { email: true, fullName: true } },
          },
        },
        documents: {
          where: { isCurrent: true },
          include: {
            extractionRuns: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { fields: true, lineItems: true },
            },
          },
        },
      },
    });

    if (!shipment) {
      throw new Error("Shipment not found or inaccessible.");
    }

    // 2. Load approval and cross-checks with resolutions
    const approval = await prisma.approval.findUnique({
      where: {
        shipmentId_revision: {
          shipmentId: id,
          revision: shipment.currentRevision,
        },
      },
      include: {
        approvedBy: { select: { email: true, fullName: true } },
      },
    });

    const checks = await prisma.crossCheckResult.findMany({
      where: {
        shipmentId: id,
        revision: shipment.currentRevision,
      },
      include: {
        resolutions: true,
      },
    });

    const latestChecks = selectLatestCrossChecks(checks);
    const profileId = getEnv().EXPORT_PROFILE_ID || "demo-v1";
    const profile = getExportProfile(profileId);

    // Check required documents presence
    const hasCurrentDocuments = REQUIRED_EXPORT_DOC_TYPES.every((type) =>
      shipment.documents.some((d) => d.docType === type),
    );

    // Shared clearance rules (same as submission guard, manager decision and shipment summary):
    // - unresolved: failing BLOCKING checks with no valid ACCEPTED_EXCEPTION
    // - unapproved: failing BLOCKING checks cleared by an exception that lacks manager sign-off
    const clearance = summarizeClearance(latestChecks, { isLatestRun: true, atCurrentRevision: true });
    const unapprovedExceptionCount = clearance.pendingManagerApproval.length;
    const unresolvedStatuses = clearance.unresolvedStatuses;

    // 3. Run pure export guard (Rules 3, 4, 5, 6, 7, 8)
    const guard = canExport({
      shipmentStatus: shipment.status,
      hasManagerApproval: Boolean(approval),
      approvedRevision: approval?.revision ?? null,
      currentRevision: shipment.currentRevision,
      hasCurrentDocuments,
      unresolvedStatuses,
      unapprovedExceptionCount,
      profileId,
    });

    const isPreview = new URL(request.url).searchParams.get("preview") === "1";

    if (!guard.allowed) {
      if (isPreview) {
        return NextResponse.json(
          {
            ready: false,
            allowed: false,
            error: `Export blocked: ${guard.reasons.join(", ")}.`,
            blockers: guard.reasons,
            profileId: profile.id,
            profileVersion: profile.version,
            assumptionLabel: profile.assumptionLabel,
            approvedRevision: approval?.revision ?? null,
            approvedAt: approval?.approvedAt ? approval.approvedAt.toISOString() : null,
            approvedBy:
              approval?.approvedBy?.email ??
              approval?.approvedBy?.fullName ??
              null,
            currentRevision: shipment.currentRevision,
            shipmentStatus: shipment.status,
            recentExport: shipment.exportEvents?.[0]
              ? {
                  id: shipment.exportEvents[0].id,
                  profileId: shipment.exportEvents[0].profileId,
                  revision: shipment.exportEvents[0].revision,
                  createdAt: shipment.exportEvents[0].createdAt.toISOString(),
                  exportedBy:
                    shipment.exportEvents[0].exportedBy?.email ??
                    shipment.exportEvents[0].exportedBy?.fullName ??
                    null,
                }
              : null,
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        {
          error: `Export blocked: ${guard.reasons.join(", ")}.`,
          blockers: guard.reasons,
        },
        { status: 422 },
      );
    }

    // 4. Construct export documents snapshot
    const exportDocuments = shipment.documents.flatMap((document) => {
      const run = document.extractionRuns[0];
      return run
        ? [
            {
              docType: document.docType,
              fields: run.fields,
              lineItems: run.lineItems,
            },
          ]
        : [];
    });

    const snapshot = {
      shipmentReference: shipment.reference,
      supplierName: shipment.supplier?.name ?? null,
      importerName: shipment.importerName ?? null,
      approvedBy:
        approval?.approvedBy?.email ??
        approval?.approvedBy?.fullName ??
        approval?.approvedById ??
        null,
      approvedAt: approval?.approvedAt ?? null,
      approvedRevision: approval?.revision ?? null,
      documents: exportDocuments,
    };

    // Validate required export fields
    const validation = profile.validate(snapshot);
    if (!validation.valid) {
      if (isPreview) {
        return NextResponse.json(
          {
            ready: false,
            allowed: false,
            error: `Export blocked: missing required export fields: ${validation.missingFields.join(", ")}.`,
            blockers: validation.missingFields.map((f) => `missing_field_${f}`),
            missingFields: validation.missingFields,
            profileId: profile.id,
            profileVersion: profile.version,
            assumptionLabel: profile.assumptionLabel,
            approvedRevision: approval?.revision ?? null,
            approvedAt: approval?.approvedAt ? approval.approvedAt.toISOString() : null,
            approvedBy:
              approval?.approvedBy?.email ??
              approval?.approvedBy?.fullName ??
              null,
            currentRevision: shipment.currentRevision,
            shipmentStatus: shipment.status,
            recentExport: shipment.exportEvents?.[0]
              ? {
                  id: shipment.exportEvents[0].id,
                  profileId: shipment.exportEvents[0].profileId,
                  revision: shipment.exportEvents[0].revision,
                  createdAt: shipment.exportEvents[0].createdAt.toISOString(),
                  exportedBy:
                    shipment.exportEvents[0].exportedBy?.email ??
                    shipment.exportEvents[0].exportedBy?.fullName ??
                    null,
                }
              : null,
          },
          { status: 400 },
        );
      }
      throw new Error(
        `Export blocked: missing required export fields: ${validation.missingFields.join(", ")}.`,
      );
    }

    // 5. Generate CSV using approved export profile (Rules 9 - 15)
    const exportData = profile.generateRows(snapshot);
    const checksum = createHash("sha256")
      .update(exportData.csv, "utf-8")
      .digest("hex");

    const safeReference = shipment.reference.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `${safeReference}-${profile.id}-rev${shipment.currentRevision}.csv`;

    // 6. Handle preview requests (Week 5 Step 5 preview support)
    if (isPreview) {
      return NextResponse.json({
        ready: true,
        allowed: true,
        blockers: [],
        fileName,
        headers: exportData.headers,
        rows: exportData.rows,
        profileId: exportData.profileId,
        profileVersion: exportData.profileVersion,
        assumptionLabel: exportData.assumptionLabel,
        checksumSha256: checksum,
        rowCount: exportData.rows.length,
        approvedRevision: approval?.revision ?? null,
        approvedAt: approval?.approvedAt ? approval.approvedAt.toISOString() : null,
        approvedBy:
          approval?.approvedBy?.email ??
          approval?.approvedBy?.fullName ??
          null,
        currentRevision: shipment.currentRevision,
        shipmentStatus: shipment.status,
        recentExport: shipment.exportEvents?.[0]
          ? {
              id: shipment.exportEvents[0].id,
              profileId: shipment.exportEvents[0].profileId,
              revision: shipment.exportEvents[0].revision,
              createdAt: shipment.exportEvents[0].createdAt.toISOString(),
              exportedBy:
                shipment.exportEvents[0].exportedBy?.email ??
                shipment.exportEvents[0].exportedBy?.fullName ??
                null,
            }
          : null,
      });
    }

    // 7. Record ExportEvent and AuditEvent with checksum and metadata (Rule 17)
    await prisma.$transaction(async (tx) => {
      await tx.exportEvent.create({
        data: {
          shipmentId: id,
          exportedById: appUser.id,
          profileId: profile.id,
          revision: shipment.currentRevision,
        },
      });

      await tx.auditEvent.create({
        data: {
          shipmentId: id,
          actorId: appUser.id,
          action: "SHIPMENT_EXPORTED",
          entityType: "Shipment",
          entityId: id,
          metadata: {
            profileId: profile.id,
            profileVersion: profile.version,
            checksumSha256: checksum,
            revision: shipment.currentRevision,
            fileName,
            rowCount: exportData.rows.length,
            byteSize: Buffer.byteLength(exportData.csv, "utf-8"),
          },
        },
      });

      await tx.shipment.update({
        where: { id },
        data: { status: "EXPORTED" },
      });
    });

    // 8. Return text/csv response with safe filename (Rule 16)
    return new NextResponse(exportData.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Checksum-Sha256": checksum,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
