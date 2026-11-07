import crypto from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { resolveTolerances, serializeTolerances, type ToleranceConfig } from "@/lib/normalizers/tolerances";
import {
  CrossCheckDocument,
  runCrossChecks,
  selectLatestCrossCheckDocuments,
  type ManualLineItemMapping,
} from "./index";
import { evaluateClearance, sortResolutions } from "./resolution-state";

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

export const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Stable canonical JSON: object keys sorted at every level, `undefined` object members omitted,
 * Decimal/bigint serialized as strings, Dates as ISO strings, array order preserved.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => (entry === undefined ? null : canonicalize(entry)));
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const member = (value as Record<string, unknown>)[key];
    if (member === undefined) continue;
    output[key] = canonicalize(member);
  }
  return output;
}

/** Deterministic SHA-256 of the canonical JSON of the input (covers nested values). */
export function computeInputHash(snapshot: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

export type CreateCrossCheckRunParams = {
  shipmentId: string;
  requestedById?: string;
  triggeredBy?: string;
  tolerances?: ToleranceConfig;
  prismaClient?: ReturnType<typeof getPrisma>;
};

type Tx = Prisma.TransactionClient;

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Week 4 Step 5: Persist a cross-check run inside an existing transaction.
 *
 * Reads the shipment, its current documents' latest COMPLETED extraction and active manual
 * mappings, runs the deterministic engine server-side, and writes an immutable run plus result
 * rows. Callers that already hold a revision lock (line mapping) use this directly.
 */
export async function createCrossCheckRunInTx(tx: Tx, params: Omit<CreateCrossCheckRunParams, "prismaClient">) {
  const { shipmentId, requestedById, triggeredBy = "MANUAL" } = params;
  const tolerances = params.tolerances ?? resolveTolerances();

  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      documents: {
        where: { isCurrent: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          extractionRuns: {
            where: { status: "COMPLETED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

  const activeMappings = await tx.lineItemMapping.findMany({
    where: { shipmentId, supersededAt: null },
    include: { createdBy: { select: { id: true, email: true, fullName: true } } },
  });

  // 1. Server-side current values (never browser-computed)
  const rawDocuments = (shipment.documents ?? [])
    .flatMap((document) => {
      const run = document.extractionRuns?.[0];
      if (!run) return [];

      const fields = Object.fromEntries(
        [...run.fields]
          .sort((a, b) => compareText(a.fieldKey, b.fieldKey))
          .map((f) => [
            f.fieldKey,
            {
              id: f.id,
              value: f.currentValue,
              unit: f.unit,
              sourceQuote: f.sourceQuote,
              pageNumber: f.pageNumber,
            },
          ]),
      );
      const lineItems = [...run.lineItems]
        .sort((a, b) => a.lineNumber - b.lineNumber || (a.batchNumber ?? 0) - (b.batchNumber ?? 0) || compareText(a.id, b.id))
        .map((item) => ({
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
        }));

      return [
        {
          docType: document.docType,
          documentId: document.id,
          documentVersion: document.documentVersion,
          extractionRunId: run.id,
          fields,
          lineItems,
        },
      ];
    });

  const latestDocuments: CrossCheckDocument[] = selectLatestCrossCheckDocuments(
    rawDocuments as unknown as CrossCheckDocument[],
  );

  const mappings = [...activeMappings]
    .sort((a, b) => compareText(a.invoiceLineItemId, b.invoiceLineItemId) || compareText(a.id, b.id))
    .map((mapping) => ({
      mappingId: mapping.id,
      invoiceLineId: mapping.invoiceLineItemId,
      packingListLineId: mapping.packingListLineItemId,
      reason: mapping.reason,
      mappedBy: mapping.createdById,
      mappedByLabel: mapping.createdBy?.fullName ?? mapping.createdBy?.email ?? null,
      createdAt: mapping.createdAt instanceof Date ? mapping.createdAt.toISOString() : String(mapping.createdAt),
    }));

  const sortedDocuments = [...rawDocuments].sort(
    (a, b) => compareText(a.docType, b.docType) || compareText(a.documentId, b.documentId),
  );
  const serializedTolerances = serializeTolerances(tolerances);

  // Hash input: everything that can change a result (values, units, line items, mappings,
  // tolerances, revision). Source quotes and page numbers are stored but not hashed.
  const hashInput = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    shipmentId: shipment.id,
    revision: shipment.currentRevision,
    tolerances: serializedTolerances,
    mappings: mappings.map(({ mappingId, invoiceLineId, packingListLineId }) => ({ mappingId, invoiceLineId, packingListLineId })),
    documents: sortedDocuments.map((d) => ({
      documentId: d.documentId,
      docType: d.docType,
      documentVersion: d.documentVersion,
      fields: Object.fromEntries(
        Object.entries(d.fields).map(([key, field]) => [key, { id: field.id, value: field.value, unit: field.unit }]),
      ),
      lineItems: d.lineItems.map((item) => ({
        id: item.id,
        lineNumber: item.lineNumber,
        description: item.description,
        hsnCode: item.hsnCode,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        currency: item.currency,
      })),
    })),
  };

  const inputSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    shipmentId: shipment.id,
    revision: shipment.currentRevision,
    tolerances: serializedTolerances,
    mappings,
    documents: sortedDocuments.map((d) => ({
      documentId: d.documentId,
      docType: d.docType,
      documentVersion: d.documentVersion,
      extractionRunId: d.extractionRunId,
      fieldsCount: Object.keys(d.fields).length,
      lineItemsCount: d.lineItems.length,
      fields: d.fields,
      lineItems: d.lineItems,
    })),
  };

  const inputHash = computeInputHash(hashInput);

  // 2. Deterministic engine
  const manualMappings: ManualLineItemMapping[] = mappings.map((mapping) => ({
    mappingId: mapping.mappingId,
    invoiceLineId: mapping.invoiceLineId,
    packingListLineId: mapping.packingListLineId,
    mappedBy: mapping.mappedBy,
    mappedByLabel: mapping.mappedByLabel ?? undefined,
    reason: mapping.reason,
    createdAt: mapping.createdAt,
  }));
  const checkResults = runCrossChecks(latestDocuments, { tolerances, manualMappings });

  // 3. Immutable run + results (sequential writes on one transaction client)
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

  const results = [];
  for (const check of checkResults) {
    const meta = RULE_METADATA[check.ruleKey] ?? {
      ruleCode: check.ruleKey.toUpperCase(),
      severity: check.severity,
    };
    results.push(
      await tx.crossCheckResult.create({
        data: {
          shipmentId: shipment.id,
          runId: run.id,
          revision: shipment.currentRevision,
          ruleKey: check.ruleKey,
          ruleCode: meta.ruleCode,
          severity: check.severity ?? meta.severity,
          status: check.status,
          details: check.details as Prisma.InputJsonValue,
        },
        include: {
          resolutions: true,
        },
      }),
    );
  }

  return {
    run,
    revision: shipment.currentRevision,
    results,
  };
}

/**
 * Week 4 Step 5: Persist cross-check runs.
 *
 * Read -> snapshot -> engine -> create happen in ONE RepeatableRead transaction, so the stored
 * revision, snapshot, hash and results always describe the same consistent shipment state.
 * Every call creates a new run (history is preserved, rows are never mutated), even when the
 * hash matches a previous run.
 */
export async function createCrossCheckRun(params: CreateCrossCheckRunParams) {
  const prisma = params.prismaClient ?? getPrisma();
  const { prismaClient: _ignored, ...rest } = params;
  void _ignored;
  return prisma.$transaction((tx) => createCrossCheckRunInTx(tx as Tx, rest), {
    isolationLevel: "RepeatableRead",
    timeout: 20_000,
  });
}

/**
 * Retrieves the latest check run for a shipment and computes derived statuses with the shared
 * clearance helper (HUMAN_CLEARED / PENDING_MANAGER_APPROVAL are derived, never stored).
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
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      results: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          resolutions: {
            include: {
              resolvedBy: {
                select: { id: true, email: true, fullName: true, role: true },
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          },
        },
      },
    },
  });

  if (!run) return null;

  const resultsWithEffectiveStatus = run.results.map((result) => {
    const clearance = evaluateClearance(result, { isLatestRun: true, atCurrentRevision: true });
    // Newest first for display, deterministic under createdAt ties.
    const resolutions = sortResolutions(result.resolutions).reverse();

    return {
      ...result,
      resolutions,
      effectiveStatus: clearance.derivedStatus,
      derivedStatus: clearance.derivedStatus,
      activeResolution: clearance.activeResolution ?? null,
      activeException: clearance.activeException ?? null,
      clearedForSubmission: clearance.clearedForSubmission,
      clearedForApproval: clearance.clearedForApproval,
    };
  });

  return {
    ...run,
    results: resultsWithEffectiveStatus,
  };
}

/**
 * Historical check runs for audit inspection. Old failed results and their resolutions stay
 * readable; ordering is deterministic.
 */
export async function getCrossCheckHistory(params: {
  shipmentId: string;
  prismaClient?: ReturnType<typeof getPrisma>;
}) {
  const prisma = params.prismaClient ?? getPrisma();

  return await prisma.crossCheckRun.findMany({
    where: { shipmentId: params.shipmentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      results: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          resolutions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          },
        },
      },
    },
  });
}
