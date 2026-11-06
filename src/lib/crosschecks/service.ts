import crypto from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import {
  CrossCheckDocument,
  runCrossChecks,
  selectLatestCrossCheckDocuments,
} from "./index";

export type CrossCheckSeverity = "BLOCKING" | "WARNING";

export const RULE_METADATA: Record<
  string,
  { ruleCode: string; severity: CrossCheckSeverity }
> = {
  invoice_line_total: {
    ruleCode: "CHK_INVOICE_ARITHMETIC",
    severity: "BLOCKING",
  },
  gross_weight_comparison: {
    ruleCode: "CHK_GROSS_WEIGHT",
    severity: "BLOCKING",
  },
  package_count_comparison: {
    ruleCode: "CHK_PACKAGE_COUNT",
    severity: "BLOCKING",
  },
  invoice_quantity_vs_packing_list: {
    ruleCode: "CHK_LINE_QUANTITY",
    severity: "BLOCKING",
  },
  gross_weight_vs_net_weight: {
    ruleCode: "CHK_GROSS_NET_SANITY",
    severity: "BLOCKING",
  },
  exporter_consistency: {
    ruleCode: "CHK_PARTY_REFERENCE",
    severity: "WARNING",
  },
};

/**
 * Computes a deterministic SHA-256 hash of the canonical input snapshot.
 */
export function computeInputHash(snapshot: unknown): string {
  const json = JSON.stringify(snapshot, Object.keys(snapshot as object).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

export type CreateCrossCheckRunParams = {
  shipmentId: string;
  requestedById?: string;
  triggeredBy?: string;
  prismaClient?: ReturnType<typeof getPrisma>;
};

/**
 * Week 4 Step 5: Persist cross-check runs.
 *
 * 1. Runs checks strictly from server-side current values (never browser-computed).
 * 2. Creates a versioned `CrossCheckRun` with shipment revision, input snapshot, and SHA-256 input hash.
 * 3. Creates immutable `CrossCheckResult` rows linked to the run.
 * 4. Stores ruleKey, ruleCode, severity, status, sourceFieldIds, and calculation details.
 * 5. Preserves complete historical check runs across shipment revisions.
 */
export async function createCrossCheckRun(params: CreateCrossCheckRunParams) {
  const prisma = params.prismaClient ?? getPrisma();
  const { shipmentId, requestedById, triggeredBy = "MANUAL" } = params;

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      documents: {
        where: { isCurrent: true },
        orderBy: { createdAt: "desc" },
        include: {
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { fields: true, lineItems: true },
          },
        },
      },
    },
  });

  if (!shipment) {
    throw new Error(`Shipment ${shipmentId} not found.`);
  }

  // 1. Prepare server-side current values snapshot
  const rawDocuments = shipment.documents.flatMap((document) => {
    const run = document.extractionRuns[0];
    if (!run) return [];

    return [
      {
        docType: document.docType,
        documentId: document.id,
        documentVersion: document.documentVersion,
        fields: Object.fromEntries(
          run.fields.map((f) => [
            f.fieldKey,
            {
              id: f.id,
              value: f.currentValue,
              unit: f.unit,
              sourceQuote: f.sourceQuote,
              pageNumber: f.pageNumber,
            },
          ]),
        ),
        lineItems: run.lineItems.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          description: item.description,
          hsnCode: item.hsnCode,
          quantity: item.quantity?.toString() ?? null,
          quantityUnit: item.quantityUnit,
          unitPrice: item.unitPrice?.toString() ?? null,
          lineTotal: item.lineTotal?.toString() ?? null,
          currency: item.currency,
          sourceQuote: item.sourceQuote,
          pageNumber: item.pageNumber,
        })),
      },
    ];
  });

  const latestDocuments: CrossCheckDocument[] = selectLatestCrossCheckDocuments(
    rawDocuments as unknown as CrossCheckDocument[],
  );

  const inputSnapshot = {
    shipmentId: shipment.id,
    revision: shipment.currentRevision,
    documents: rawDocuments.map((d) => ({
      documentId: d.documentId,
      docType: d.docType,
      documentVersion: d.documentVersion,
      fieldsCount: Object.keys(d.fields).length,
      lineItemsCount: d.lineItems.length,
      fields: d.fields,
      lineItems: d.lineItems,
    })),
  };

  const inputHash = computeInputHash(inputSnapshot);

  // 2. Execute Deterministic Cross-Check Engine
  const checkResults = runCrossChecks(latestDocuments);

  // 3. Persist CrossCheckRun and immutable CrossCheckResult rows in a transaction
  return await prisma.$transaction(async (tx) => {
    const run = await tx.crossCheckRun.create({
      data: {
        shipmentId: shipment.id,
        revision: shipment.currentRevision,
        inputHash,
        inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
        triggeredBy,
        requestedById: requestedById ?? null,
      },
    });

    const results = await Promise.all(
      checkResults.map((check) => {
        const meta = RULE_METADATA[check.ruleKey] ?? {
          ruleCode: check.ruleKey.toUpperCase(),
          severity: "BLOCKING" as const,
        };

        return tx.crossCheckResult.create({
          data: {
            shipmentId: shipment.id,
            runId: run.id,
            revision: shipment.currentRevision,
            ruleKey: check.ruleKey,
            ruleCode: meta.ruleCode,
            severity: meta.severity,
            status: check.status,
            details: check.details as Prisma.InputJsonValue,
          },
          include: {
            resolutions: true,
          },
        });
      }),
    );

    return {
      run,
      revision: shipment.currentRevision,
      results,
    };
  });
}

/**
 * Retrieves the latest check run for a shipment and computes effective status with human resolutions.
 */
export async function getLatestCrossCheckRun(params: {
  shipmentId: string;
  revision?: number;
  prismaClient?: ReturnType<typeof getPrisma>;
}) {
  const prisma = params.prismaClient ?? getPrisma();

  const whereClause: Prisma.CrossCheckRunWhereInput = {
    shipmentId: params.shipmentId,
  };
  if (params.revision !== undefined) {
    whereClause.revision = params.revision;
  }

  const run = await prisma.crossCheckRun.findFirst({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: {
      results: {
        include: {
          resolutions: {
            include: {
              resolvedBy: {
                select: { id: true, email: true, fullName: true, role: true },
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!run) return null;

  // Compute effective status for UI and export guard
  const resultsWithEffectiveStatus = run.results.map((result) => {
    const latestResolution = result.resolutions[0];
    const isHumanCleared =
      result.status !== "PASS" &&
      result.status !== "NOT_APPLICABLE" &&
      Boolean(
        latestResolution &&
          (latestResolution.type === "SOURCE_CORRECTED" ||
            latestResolution.type === "DOCUMENT_REPLACEMENT" ||
            (latestResolution.type === "ACCEPTED_EXCEPTION" &&
              latestResolution.managerApprovedAt !== null)),
      );

    return {
      ...result,
      effectiveStatus: isHumanCleared ? "HUMAN_CLEARED" : result.status,
      activeResolution: latestResolution ?? null,
    };
  });

  return {
    ...run,
    results: resultsWithEffectiveStatus,
  };
}

/**
 * Retrieves historical check runs for audit trail inspection (ensuring historical failed results remain visible).
 */
export async function getCrossCheckHistory(params: {
  shipmentId: string;
  prismaClient?: ReturnType<typeof getPrisma>;
}) {
  const prisma = params.prismaClient ?? getPrisma();

  return await prisma.crossCheckRun.findMany({
    where: { shipmentId: params.shipmentId },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    include: {
      results: {
        include: {
          resolutions: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
}

