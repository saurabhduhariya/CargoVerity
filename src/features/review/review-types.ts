export type ReviewWorkspaceField = {
  id: string;
  fieldKey: string;
  modelValue: string | null;
  currentValue: string | null;
  unit: string | null;
  modelConfidence: number | string | null;
  sourceQuote: string | null;
  pageNumber: number | null;
  reviewStatus: string;
  reviewReason?: string | null;
};

export type ReviewWorkspaceLineItem = {
  id: string;
  lineNumber?: number;
  description: string | null;
  hsnCode?: string | null;
  sku?: string | null;
  quantity: string | number | null;
  quantityUnit: string | null;
  unitPrice?: string | number | null;
  lineTotal: string | number | null;
  currency: string | null;
  sourceQuote?: string | null;
  pageNumber?: number | null;
};

export type ReviewWorkspacePage = {
  id: string;
  pageNumber: number;
  isReadable: boolean;
  manualEntryRequired: boolean;
  reviewNote: string | null;
};

export type ManualFieldOption = {
  fieldKey: string;
  required: boolean;
  isNumeric?: boolean;
  isDate?: boolean;
};

export type ReviewWorkspaceDocument = {
  id: string;
  docType: "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING";
  originalFileName: string;
  mimeType: string;
  documentVersion: number;
  pageCount: number | null;
  /** Empty when private evidence is unavailable; never substitute a public sample. */
  signedUrl: string;
  pages: ReviewWorkspacePage[];
  fields: ReviewWorkspaceField[];
  lineItems: ReviewWorkspaceLineItem[];
  extractionStatus: string;
  latestRunId?: string | null;
  extractionProvider?: string | null;
  manualFieldOptions?: ManualFieldOption[];
};

export type CrossCheckResolutionData = {
  id: string;
  type: "SOURCE_CORRECTED" | "DOCUMENT_REPLACEMENT" | "ACCEPTED_EXCEPTION";
  reason: string;
  evidence?: string | null;
  managerApprovedAt?: string | Date | null;
  createdAt?: string | Date;
  resolvedBy?: { id: string; email?: string; fullName?: string | null; role?: string };
};

export type ReviewWorkspaceCrossCheck = {
  id?: string;
  ruleKey: string;
  ruleCode?: string;
  status: "PASS" | "MISMATCH" | "INCOMPLETE" | "NOT_APPLICABLE";
  severity?: "BLOCKING" | "WARNING";
  effectiveStatus?: string;
  derivedStatus?: string;
  runId?: string | null;
  clearedForSubmission?: boolean;
  clearedForApproval?: boolean;
  activeResolution?: CrossCheckResolutionData | null;
  resolutions?: CrossCheckResolutionData[];
  details: {
    message?: string;
    note?: string;
    difference?: string | number | null;
    differenceKg?: string | null;
    comparedValuesKg?: Record<string, string>;
    unreconciledReason?: string;
    [key: string]: unknown;
  };
};

export type ReviewWorkspaceAuditEvent = {
  id: string;
  action: string;
  entityType: string;
  actorEmail?: string | null;
  actorRole?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string | Date;
};

export type ReviewWorkspaceLineMapping = {
  id: string;
  invoiceLineId: string;
  packingListLineId: string;
  reason: string;
  createdAt: string;
  createdBy: string | null;
};

export type CheckRunSummary = { id: string; revision: number; createdAt: string | Date | null };
export type ReviewCheckRun = CheckRunSummary & {
  createdAt: string | Date;
  triggeredBy?: string | null;
  snapshot?: unknown;
  inputSnapshot?: unknown;
  results: ReviewWorkspaceCrossCheck[];
};

export type ReviewWorkspaceInitialData = {
  shipment: {
    id: string;
    reference: string;
    status: string;
    currentRevision: number;
    importerName?: string | null;
    exporterName?: string | null;
    supplier?: { id: string; name: string } | null;
  };
  currentUserRole?: "EXECUTIVE" | "MANAGER";
  initialDocumentId?: string;
  documents: ReviewWorkspaceDocument[];
  crossChecks: ReviewWorkspaceCrossCheck[];
  latestCheckRun?: CheckRunSummary | null;
  crossChecksStale?: boolean;
  lineMappings?: ReviewWorkspaceLineMapping[];
  auditHistory?: ReviewWorkspaceAuditEvent[];
};

export type FieldCategory = "parties" | "identifiers" | "commercial" | "logistics" | "other";
export type FieldAction = "CONFIRMED" | "CORRECTED" | "MANUAL_ENTRY";
export type InspectorTab = "fields" | "checks" | "history";
export type ReviewFeedback = { kind: "info" | "success" | "warning" | "error"; message: string };

export type FieldDraft = {
  documentId: string;
  docType: ReviewWorkspaceDocument["docType"];
  fieldKey: string;
  value: string;
  reason: string;
  baseValue: string | null;
  baseStatus: string;
  baseUnit: string | null;
  baseReason: string | null;
  basePage: number | null;
  baseRevision: number;
  conflict?: "changed" | "removed";
  error?: string;
};

export type ManualFieldDraft = { fieldKey: string; value: string; unit: string; reason: string; page: number };
export type ManualFieldBase = {
  runId: string | null;
  fieldId: string | null;
  value: string | null;
  unit: string | null;
  status: string | null;
  reason: string | null;
  page: number | null;
};
export type ManualFieldEntry = { open: boolean; draft: ManualFieldDraft; base: ManualFieldBase | null };
export type ResolutionDraft = { reason: string; evidence: string; valuesConfirmed: boolean };
export type EvidenceTarget = { documentId: string; page: number; fieldId?: string; label: string };
