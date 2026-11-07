import { Prisma, type ShipmentStatus } from "@/generated/prisma/client";
import { evaluateClearance, selectLatestByRule } from "@/lib/crosschecks/resolution-state";

export type ShipmentListFilters = {
  search?: string;
  status?: ShipmentStatus;
  supplierId?: string;
  fromDate?: string;
  toDate?: string;
  sort?: "risk" | "date_desc" | "date_asc";
};

export function normalizeSupplierName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSupplierKey(value: string) {
  return normalizeSupplierName(value).toLocaleLowerCase();
}

/**
 * Builds Prisma where clause supporting search, status, supplier, and date range filters (Rule 6 & 7).
 */
export function buildShipmentWhere(
  filters: ShipmentListFilters,
  user: { id: string; role: "EXECUTIVE" | "MANAGER" | "ADMIN" | "SPECIALIST" },
): Prisma.ShipmentWhereInput {
  const clauses: Prisma.ShipmentWhereInput[] = [];

  if (user.role !== "MANAGER") {
    clauses.push({ createdById: user.id });
  }

  if (filters.status) {
    clauses.push({ status: filters.status });
  }

  if (filters.supplierId) {
    clauses.push({ supplierId: filters.supplierId });
  }

  if (filters.search) {
    clauses.push({
      OR: [
        { reference: { contains: filters.search, mode: "insensitive" } },
        { importerName: { contains: filters.search, mode: "insensitive" } },
        { exporterName: { contains: filters.search, mode: "insensitive" } },
        { supplier: { name: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }

  // Dates are calendar days in UTC: fromDate includes its whole day (>= 00:00Z) and toDate
  // includes its whole day (< next day 00:00Z). A full timestamp is used as given.
  if (filters.fromDate) {
    const from = new Date(filters.fromDate);
    if (!Number.isNaN(from.getTime())) {
      clauses.push({ createdAt: { gte: from } });
    }
  }

  if (filters.toDate) {
    const to = new Date(filters.toDate);
    if (!Number.isNaN(to.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.toDate)) {
        const nextDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1));
        clauses.push({ createdAt: { lt: nextDay } });
      } else {
        clauses.push({ createdAt: { lte: to } });
      }
    }
  }

  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

/* ========================================================================= */
/* Week 5 Step 7: Enriched Shipment Status List & High-Risk Priority Helpers  */
/* ========================================================================= */

export type DocumentSlotInfo = {
  present: boolean;
  status: string | null;
  documentId: string | null;
  fileName: string | null;
};

export type DocumentSlotsSummary = {
  invoice: DocumentSlotInfo;
  packingList: DocumentSlotInfo;
  billOfLading: DocumentSlotInfo;
  allPresent: boolean;
  presentCount: number;
};

export type CrossChecksSummary = {
  total: number;
  passed: number;
  mismatch: number;
  incomplete: number;
  resolved: number;
  blockingUnresolved: number;
  hasBlockingMismatches: boolean;
};

export type ShipmentNextActionType =
  | "upload"
  | "extract"
  | "review"
  | "resolve"
  | "submit"
  | "approve"
  | "export"
  | "completed";

export type ShipmentNextAction = {
  type: ShipmentNextActionType;
  label: string;
  href: string;
  description: string;
  urgency: "high" | "medium" | "low" | "none";
};

export type RawDocumentInput = {
  id: string;
  docType: string;
  extractionStatus: string;
  originalFileName: string;
  documentVersion?: number;
  isCurrent?: boolean;
  fields?: Array<{ reviewStatus: string }>;
  pages?: Array<{ isReadable: boolean; manualEntryRequired: boolean }>;
};

export type RawCrossCheckInput = {
  id: string;
  ruleKey: string;
  status: string;
  severity: string;
  createdAt: Date | string;
  revision: number;
  resolutions?: Array<{
    id: string;
    type: string;
    reason?: string | null;
    evidence?: string | null;
    managerApprovedAt: Date | string | null;
    createdAt?: Date | string | null;
  }>;
};

/**
 * Derives CI/PL/BL slot presence and extraction status (Rule 2).
 */
export function deriveDocumentSlots(
  documents: RawDocumentInput[],
): DocumentSlotsSummary {
  const currentDocs = documents.filter((d) => d.isCurrent !== false);

  const findDoc = (type: string): DocumentSlotInfo => {
    const doc = currentDocs.find((d) => d.docType === type);
    return {
      present: Boolean(doc),
      status: doc?.extractionStatus ?? null,
      documentId: doc?.id ?? null,
      fileName: doc?.originalFileName ?? null,
    };
  };

  const invoice = findDoc("INVOICE");
  const packingList = findDoc("PACKING_LIST");
  const billOfLading = findDoc("BILL_OF_LADING");

  const presentCount =
    (invoice.present ? 1 : 0) +
    (packingList.present ? 1 : 0) +
    (billOfLading.present ? 1 : 0);

  return {
    invoice,
    packingList,
    billOfLading,
    allPresent: presentCount === 3,
    presentCount,
  };
}

/**
 * Computes deterministic cross-checks summary for current revision (Rule 3).
 */
export function deriveCrossChecksSummary(
  checks: RawCrossCheckInput[],
  currentRevision: number,
): CrossChecksSummary {
  const revisionChecks = checks.filter((c) => c.revision === currentRevision);

  // Latest check per ruleKey (createdAt ties broken by ID)
  const latestChecks = selectLatestByRule(revisionChecks);

  let passed = 0;
  let mismatch = 0;
  let incomplete = 0;
  let resolved = 0;
  let blockingUnresolved = 0;

  for (const check of latestChecks) {
    // Shared clearance rules: resolved = cleared for approval (valid exception with manager
    // sign-off). WARNING failures are counted but never block; audit links never clear.
    const clearance = evaluateClearance(check, { isLatestRun: true, atCurrentRevision: true });

    if (check.status === "PASS") {
      passed++;
    } else if (check.status === "MISMATCH" || check.status === "INCOMPLETE") {
      if (check.status === "MISMATCH") mismatch++;
      else incomplete++;
      if (!clearance.isBlockingSeverity) continue;
      if (clearance.clearedForApproval) resolved++;
      else blockingUnresolved++;
    }
  }

  return {
    total: latestChecks.length,
    passed,
    mismatch,
    incomplete,
    resolved,
    blockingUnresolved,
    hasBlockingMismatches: blockingUnresolved > 0,
  };
}

/**
 * Derives the deterministic Next Action for a shipment (Rule 5).
 */
export function deriveNextAction(params: {
  id: string;
  status: string;
  slots: DocumentSlotsSummary;
  checks: CrossChecksSummary;
  reviewRequiredCount: number;
  userRole?: string;
}): ShipmentNextAction {
  const { id, status, slots, checks, reviewRequiredCount, userRole } = params;

  if (status === "EXPORTED") {
    return {
      type: "completed",
      label: "View Exported CSV",
      href: `/review/${id}`,
      description: "Shipment exported successfully. Audit event recorded.",
      urgency: "none",
    };
  }

  if (status === "APPROVED") {
    return {
      type: "export",
      label: "Export Customs CSV",
      href: `/review/${id}`,
      description: "Manager approval complete. Ready for official CSV generation.",
      urgency: "medium",
    };
  }

  if (status === "READY_FOR_APPROVAL") {
    if (userRole === "MANAGER") {
      return {
        type: "approve",
        label: "Manager Review & Decision",
        href: `/review/${id}`,
        description: "Awaiting your managerial approval or rejection decision.",
        urgency: "high",
      };
    }
    return {
      type: "review",
      label: "Awaiting Manager Decision",
      href: `/review/${id}`,
      description: "Submitted for manager review. Pending decision.",
      urgency: "medium",
    };
  }

  if (!slots.allPresent) {
    return {
      type: "upload",
      label: "Upload Missing Documents",
      href: `/shipments/${id}`,
      description: `Missing ${3 - slots.presentCount} required document slot(s).`,
      urgency: "medium",
    };
  }

  const slotStatuses = [slots.invoice.status, slots.packingList.status, slots.billOfLading.status];

  if (status === "EXTRACTING" || slotStatuses.includes("PROCESSING")) {
    return {
      type: "extract",
      label: "Extraction In Progress",
      href: `/shipments/${id}`,
      description: "AI extraction is currently analyzing uploaded documents.",
      urgency: "low",
    };
  }

  if (slotStatuses.includes("FAILED")) {
    const failed = slotStatuses.filter((s) => s === "FAILED").length;
    return {
      type: "extract",
      label: "Retry Extraction Or Enter Manually",
      href: `/shipments/${id}`,
      description: `Extraction failed for ${failed} document(s). Retry it or enter the values manually.`,
      urgency: "high",
    };
  }

  if (slotStatuses.includes("UPLOADED")) {
    return {
      type: "extract",
      label: "Run Extraction",
      href: `/shipments/${id}`,
      description: "Uploaded documents have not been extracted yet.",
      urgency: "medium",
    };
  }

  if (checks.blockingUnresolved > 0) {
    return {
      type: "resolve",
      label: "Resolve Discrepancies",
      href: `/review/${id}`,
      description: `${checks.blockingUnresolved} cross-check discrepancies require resolution.`,
      urgency: "high",
    };
  }

  if (reviewRequiredCount > 0) {
    return {
      type: "review",
      label: "Review Extracted Fields",
      href: `/review/${id}`,
      description: `${reviewRequiredCount} fields require reviewer verification.`,
      urgency: "high",
    };
  }

  if (checks.total === 0) {
    return {
      type: "review",
      label: "Run Cross-Checks",
      href: `/review/${id}`,
      description: "No cross-check run exists for the current revision.",
      urgency: "medium",
    };
  }

  // All documents present, extraction complete, checks clear, fields reviewed
  return {
    type: "submit",
    label: "Submit for Approval",
    href: `/review/${id}`,
    description: "All guards verified. Ready for manager submission.",
    urgency: "high",
  };
}

/**
 * Calculates a deterministic priority risk score (0 to 100) based on stored data (Rule 8).
 */
export function calculateShipmentRiskScore(params: {
  status: string;
  blockingUnresolved: number;
  reviewRequiredCount: number;
  allDocumentsPresent: boolean;
  /** READY_FOR_APPROVAL is the Manager's work; for an Executive it is a waiting state. */
  userRole?: string;
}): number {
  const { status, blockingUnresolved, reviewRequiredCount, allDocumentsPresent, userRole } = params;

  if (status === "READY_FOR_APPROVAL") return userRole && userRole !== "MANAGER" ? 30 : 100;
  if (blockingUnresolved > 0) return 90;
  if (reviewRequiredCount > 0) return 80;
  if (!allDocumentsPresent && status !== "APPROVED" && status !== "EXPORTED") return 70;
  if (status === "APPROVED") return 40;
  if (status === "EXPORTED") return 10;
  return 50;
}

export type EnrichedShipment = {
  id: string;
  reference: string;
  status: string;
  currentRevision: number;
  importerName: string | null;
  exporterName: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: { id: string; name: string } | null;
  documentSlots: DocumentSlotsSummary;
  checksSummary: CrossChecksSummary;
  reviewRequiredCount: number;
  nextAction: ShipmentNextAction;
  riskScore: number;
};

/**
 * Sorts enriched shipments according to requested sort order (Rule 8).
 */
export function sortShipments(
  shipments: EnrichedShipment[],
  sortMode: "risk" | "date_desc" | "date_asc" = "risk",
): EnrichedShipment[] {
  return [...shipments].sort((a, b) => {
    if (sortMode === "date_asc") {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    if (sortMode === "date_desc") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    // "risk" default: high risk first, tiebreak by updatedAt desc
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
