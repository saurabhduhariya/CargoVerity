import {
  demoV1Profile,
  DEMO_V1_COLUMNS,
  DEMO_V1_REQUIRED_FIELDS,
  getExportProfile,
  registerExportProfile,
  formatExportDate,
  formatExportNumber,
  escapeCsvCell,
  serializeCsv,
  sanitizeCsvCell,
  type ExportDocumentSnapshot,
  type ShipmentExportSnapshot,
  type ExportProfile,
  type ExportProfileResult,
} from "@/lib/export/profile";

export {
  demoV1Profile,
  DEMO_V1_COLUMNS,
  DEMO_V1_REQUIRED_FIELDS,
  getExportProfile,
  registerExportProfile,
  formatExportDate,
  formatExportNumber,
  escapeCsvCell,
  serializeCsv,
  sanitizeCsvCell,
};

export type ExportDocument = ExportDocumentSnapshot;
export type { ExportProfile, ExportProfileResult, ShipmentExportSnapshot };

/**
 * Builds the demo-v1 export payload according to the typed ExportProfile specification.
 */
export function buildDemoV1Export(
  reference: string,
  documents: ExportDocumentSnapshot[],
  metadata?: {
    supplierName?: string | null;
    importerName?: string | null;
    approvedBy?: string | null;
    approvedAt?: Date | string | null;
    approvedRevision?: number | null;
  },
): ExportProfileResult {
  const snapshot: ShipmentExportSnapshot = {
    shipmentReference: reference,
    supplierName: metadata?.supplierName ?? null,
    importerName: metadata?.importerName ?? null,
    approvedBy: metadata?.approvedBy ?? null,
    approvedAt: metadata?.approvedAt ?? null,
    approvedRevision: metadata?.approvedRevision ?? null,
    documents,
  };

  return demoV1Profile.generateRows(snapshot);
}

/**
 * Serializes a shipment and its documents into RFC 4180 CSV string using demo-v1 profile.
 */
export function buildDemoV1Csv(
  reference: string,
  documents: ExportDocumentSnapshot[],
  metadata?: {
    supplierName?: string | null;
    importerName?: string | null;
    approvedBy?: string | null;
    approvedAt?: Date | string | null;
    approvedRevision?: number | null;
  },
): string {
  return buildDemoV1Export(reference, documents, metadata).csv;
}
