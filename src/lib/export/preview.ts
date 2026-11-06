/**
 * Week 5 Step 5: Export Preview Data Contracts & Formatting Utilities
 */

export type ExportRecordSummary = {
  id: string;
  profileId: string;
  revision: number;
  createdAt: string;
  exportedBy: string | null;
  checksumSha256?: string;
  fileName?: string;
};

export type ExportPreviewData = {
  ready: boolean;
  allowed: boolean;
  blockers: string[];
  error?: string;
  fileName?: string;
  headers?: string[];
  rows?: string[][];
  profileId: string;
  profileVersion: string;
  assumptionLabel: string;
  checksumSha256?: string;
  rowCount?: number;
  approvedRevision: number | null;
  approvedAt: string | null;
  approvedBy: string | null;
  currentRevision: number;
  shipmentStatus: string;
  recentExport: ExportRecordSummary | null;
};

export type FormattedBlocker = {
  code: string;
  title: string;
  description: string;
  category: "approval" | "revision" | "documents" | "cross_checks" | "fields" | "profile" | "other";
};

export function formatExportBlocker(blocker: string): FormattedBlocker {
  switch (blocker) {
    case "shipment_not_approved":
      return {
        code: blocker,
        title: "Shipment Not Approved",
        description: "Shipment workflow status must be APPROVED by a Manager before CSV export can be generated.",
        category: "approval",
      };
    case "manager_approval_required":
      return {
        code: blocker,
        title: "Manager Approval Required",
        description: "Official manager sign-off is required to authorize customs CSV generation.",
        category: "approval",
      };
    case "approval_is_stale":
      return {
        code: blocker,
        title: "Approval Is Stale",
        description: "Shipment was modified after the previous approval, incrementing the revision. A Manager must re-approve.",
        category: "revision",
      };
    case "documents_missing":
      return {
        code: blocker,
        title: "Required Documents Missing",
        description: "Commercial Invoice, Packing List, and Bill of Lading must all be present and current.",
        category: "documents",
      };
    case "required_fields_missing":
      return {
        code: blocker,
        title: "Mandatory Customs Fields Missing",
        description: "Key customs fields (e.g., supplier, importer, weights, currencies) could not be extracted or verified.",
        category: "fields",
      };
    case "cross_checks_unresolved":
      return {
        code: blocker,
        title: "Unresolved Cross-Checks",
        description: "Deterministic cross-checks detected arithmetic or weight mismatches that have not been resolved.",
        category: "cross_checks",
      };
    case "unapproved_exceptions_present":
      return {
        code: blocker,
        title: "Accepted Exceptions Awaiting Manager Sign-off",
        description: "One or more cross-check rules were marked as Accepted Exceptions and require explicit Manager sign-off.",
        category: "cross_checks",
      };
    case "export_profile_missing":
      return {
        code: blocker,
        title: "Export Profile Missing",
        description: "Target export profile configuration could not be resolved by the system.",
        category: "profile",
      };
    default:
      if (blocker.startsWith("missing_field_")) {
        const fieldName = blocker.replace("missing_field_", "");
        return {
          code: blocker,
          title: `Missing Field: ${fieldName.replaceAll("_", " ")}`,
          description: `The export profile requires '${fieldName}' to be populated from extracted documents.`,
          category: "fields",
        };
      }
      return {
        code: blocker,
        title: "Export Guard Blocker",
        description: blocker.replaceAll("_", " "),
        category: "other",
      };
  }
}

