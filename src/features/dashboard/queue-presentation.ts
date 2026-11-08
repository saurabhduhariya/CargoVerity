import type { EnrichedShipment } from "@/lib/shipments";

export type QueueView = "all" | "attention" | "documents" | "approval";

export function matchesQueueView(shipment: EnrichedShipment, view: QueueView) {
  switch (view) {
    case "attention":
      return shipment.nextAction.urgency === "high";
    case "documents":
      return shipment.nextAction.type === "upload";
    case "approval":
      return shipment.status === "READY_FOR_APPROVAL";
    default:
      return true;
  }
}

export function queuePriority(shipment: EnrichedShipment) {
  if (shipment.nextAction.urgency === "high") return { label: "High priority", variant: "warning" as const };
  if (shipment.nextAction.urgency === "medium") return { label: "Next up", variant: "default" as const };
  if (shipment.nextAction.urgency === "low") return { label: "In progress", variant: "info" as const };
  return { label: "Complete", variant: "default" as const };
}

export function queueActionLabel(shipment: EnrichedShipment) {
  const { type } = shipment.nextAction;
  if (type === "upload") return "Upload documents";
  if (type === "resolve") return "Resolve discrepancies";
  if (type === "approve") return "Review submission";
  if (type === "export") return "Preview export";
  if (type === "completed") return "View export history";
  if (type === "submit") return "Review & submit";
  if (type === "extract" && [shipment.documentSlots.invoice, shipment.documentSlots.packingList, shipment.documentSlots.billOfLading].some((slot) => slot.status === "FAILED")) return "Retry or enter manually";
  if (type === "extract" && shipment.status === "EXTRACTING") return "View extraction";
  if (shipment.status === "READY_FOR_APPROVAL") return "View submission";
  return shipment.nextAction.label;
}

export function documentStateLabel(status: string | null, present: boolean) {
  if (!present) return "Missing";
  const labels: Record<string, string> = {
    UPLOADED: "Uploaded", PROCESSING: "Extracting", EXTRACTED: "Extracted",
    REVIEW_REQUIRED: "Review needed", FAILED: "Failed",
  };
  return status ? labels[status] ?? status.replaceAll("_", " ") : "Uploaded";
}

export function formatQueueDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function mergeSupplierOptions(
  existing: Array<{ id: string; name: string }>, shipments: EnrichedShipment[],
) {
  const suppliers = new Map(existing.map((supplier) => [supplier.id, supplier]));
  for (const shipment of shipments) if (shipment.supplier) suppliers.set(shipment.supplier.id, shipment.supplier);
  return [...suppliers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
