import { vi } from "vitest";

/**
 * In-memory stand-in for the queries made by src/lib/export/export-service.ts:
 * shipment.findFirst (scoped), approval.findUnique, crossCheckRun.findFirst and the export
 * transaction (conditional shipment.updateMany, exportEvent.create, auditEvent.create).
 */

type Field = { fieldKey: string; currentValue: string | null; unit?: string | null };
type Line = { lineNumber: number; description: string | null; hsnCode?: string | null; quantity?: string | null; quantityUnit?: string | null; unitPrice?: string | null; lineTotal?: string | null; currency?: string | null };

export function exportDocuments(overrides: { lines?: Line[]; extraFields?: Partial<Record<"INVOICE" | "PACKING_LIST" | "BILL_OF_LADING", Field[]>> } = {}) {
  const lines = overrides.lines ?? [
    { lineNumber: 1, description: "Optical Sensor Mod A", hsnCode: "9026.10.20", quantity: "50", quantityUnit: "PCS", unitPrice: "45.00", lineTotal: "2250.00", currency: "USD" },
    { lineNumber: 2, description: "Digital Controller Unit B", hsnCode: "9032.89.10", quantity: "20", quantityUnit: "PCS", unitPrice: "120.00", lineTotal: "2400.00", currency: "USD" },
  ];
  const fields: Record<"INVOICE" | "PACKING_LIST" | "BILL_OF_LADING", Field[]> = {
    INVOICE: [
      { fieldKey: "exporter", currentValue: "Global Tech Exporters Ltd" },
      { fieldKey: "documentNumber", currentValue: "INV-2026-9001" },
      { fieldKey: "issueDate", currentValue: "2026-11-02" },
      { fieldKey: "currency", currentValue: "USD" },
      { fieldKey: "invoiceTotal", currentValue: "4650.00", unit: "USD" },
    ],
    PACKING_LIST: [
      { fieldKey: "grossWeight", currentValue: "3165", unit: "kg" },
      { fieldKey: "packageCount", currentValue: "120", unit: "cartons" },
    ],
    BILL_OF_LADING: [
      { fieldKey: "documentNumber", currentValue: "MEDU12345678" },
      { fieldKey: "portOfLoading", currentValue: "INBOM" },
      { fieldKey: "portOfDischarge", currentValue: "USLAX" },
      { fieldKey: "grossWeight", currentValue: "3165", unit: "kg" },
      { fieldKey: "packageCount", currentValue: "120", unit: "cartons" },
    ],
  };
  return (["INVOICE", "PACKING_LIST", "BILL_OF_LADING"] as const).map((docType) => ({
    id: `doc-${docType}`,
    docType,
    selectedDocType: docType,
    isCurrent: true,
    extractionRuns: [
      {
        id: `run-${docType}`,
        status: "COMPLETED",
        fields: [...fields[docType], ...(overrides.extraFields?.[docType] ?? [])],
        lineItems: docType === "INVOICE" ? lines : [],
      },
    ],
  }));
}

export type FakeExportOptions = {
  status?: string;
  currentRevision?: number;
  approvalRevision?: number | null;
  checkRunRevision?: number | null;
  checkResults?: Array<{ id: string; ruleKey: string; status: string; severity: string; createdAt?: Date; resolutions: unknown[] }>;
  documents?: ReturnType<typeof exportDocuments>;
  exportEvents?: unknown[];
  visible?: boolean;
  lockCount?: number;
};

export function fakeExportDb(options: FakeExportOptions = {}) {
  const currentRevision = options.currentRevision ?? 1;
  const shipment = {
    id: "shp-1",
    reference: "SHP-2026-001",
    status: options.status ?? "APPROVED",
    currentRevision,
    createdById: "executive-uuid",
    importerName: "CargoVerity Imports Inc",
    supplier: { id: "sup-1", name: "Global Tech Exporters Ltd" },
    exportEvents: options.exportEvents ?? [],
    documents: options.documents ?? exportDocuments(),
  };
  const approvalRevision = options.approvalRevision === undefined ? currentRevision : options.approvalRevision;
  const approval =
    approvalRevision === null
      ? null
      : {
          id: "approval-1",
          revision: approvalRevision,
          approvedById: "manager-uuid",
          approvedAt: new Date("2026-11-05T12:00:00Z"),
          approvedBy: { email: "manager@cargoverity.test", fullName: "Mona Manager" },
        };
  const runRevision = options.checkRunRevision === undefined ? currentRevision : options.checkRunRevision;
  const run =
    runRevision === null
      ? null
      : {
          id: "check-run-1",
          revision: runRevision,
          results: (options.checkResults ?? [{ id: "c-1", ruleKey: "gross_weight_comparison", status: "PASS", severity: "BLOCKING", resolutions: [] }]).map((r) => ({
            createdAt: new Date("2026-11-05T11:00:00Z"),
            ...r,
          })),
        };

  const tx = {
    shipment: { updateMany: vi.fn().mockResolvedValue({ count: options.lockCount ?? 1 }) },
    exportEvent: { create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "export-1", ...data })) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  };
  const prisma = {
    shipment: { findFirst: vi.fn().mockResolvedValue(options.visible === false ? null : shipment) },
    // The approval row is keyed by revision: only an approval for the current revision is found.
    approval: { findUnique: vi.fn().mockResolvedValue(approval && approval.revision === currentRevision ? approval : null) },
    crossCheckRun: { findFirst: vi.fn().mockResolvedValue(run) },
    $transaction: vi.fn().mockImplementation(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx, shipment };
}
