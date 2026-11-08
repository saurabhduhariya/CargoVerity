import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShipmentDocumentSlots, uploadFileToSignedUrl, uploadProgressLabel, type DocumentSlotItem } from "@/features/documents/shipment-document-slots";
import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { documentStateLabel, formatQueueDate, matchesQueueView, mergeSupplierOptions, queueActionLabel, queuePriority } from "@/features/dashboard/queue-presentation";
import type { EnrichedShipment } from "@/lib/shipments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const shipment = (patch: Partial<EnrichedShipment> = {}): EnrichedShipment => ({
  id: "qa", reference: "QA-OPERATIONS", status: "DRAFT", currentRevision: 1, importerName: null, exporterName: null,
  createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z", supplier: null,
  documentSlots: { invoice: { present: false, status: null, documentId: null, fileName: null }, packingList: { present: false, status: null, documentId: null, fileName: null }, billOfLading: { present: false, status: null, documentId: null, fileName: null }, allPresent: false, presentCount: 0 },
  checksSummary: { total: 0, passed: 0, mismatch: 0, incomplete: 0, resolved: 0, blockingUnresolved: 0, hasBlockingMismatches: false },
  reviewRequiredCount: 0, nextAction: { type: "upload", label: "Upload Missing Documents", href: "/shipments/qa", description: "Missing documents", urgency: "medium" }, riskScore: 70,
  ...patch,
});

describe("private upload byte progress", () => {
  afterEach(() => vi.unstubAllGlobals());
  function xhr() {
    const instance = { open: vi.fn(), setRequestHeader: vi.fn(), send: vi.fn(), upload: {} as { onprogress: (event: { lengthComputable: boolean; loaded: number; total: number }) => void }, onload: () => {}, onerror: () => {}, status: 201, responseText: "" };
    vi.stubGlobal("XMLHttpRequest", class { constructor() { return instance; } });
    return instance;
  }
  it("uses actual byte events, private signed PUT, and no upsert", async () => {
    const request = xhr();
    const progress = vi.fn();
    const blob = new Blob(["synthetic"]);
    const pending = uploadFileToSignedUrl("https://storage.example.test/signed", blob, "application/pdf", progress);
    expect(request.open).toHaveBeenCalledWith("PUT", "https://storage.example.test/signed");
    expect(request.setRequestHeader).toHaveBeenCalledWith("x-upsert", "false");
    expect(request.send).toHaveBeenCalledWith(blob);
    request.upload.onprogress({ lengthComputable: false, loaded: 20, total: 100 });
    expect(progress).not.toHaveBeenCalled();
    request.upload.onprogress({ lengthComputable: true, loaded: 47, total: 100 });
    expect(progress).toHaveBeenCalledWith(47);
    request.onload();
    await pending;
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it.each([[413, "maximum allowed size"], [415, "Only PDF"]])("explains storage rejection %s without marking it complete", async (status, message) => {
    const request = xhr(); request.status = status;
    const progress = vi.fn();
    const pending = uploadFileToSignedUrl("https://storage.example.test/signed", new Blob(["synthetic"]), "application/pdf", progress);
    const rejected = expect(pending).rejects.toThrow(message);
    request.onload();
    await rejected;
    expect(progress).not.toHaveBeenCalledWith(100);
  });
});
const doc = (patch: Partial<DocumentSlotItem> = {}): DocumentSlotItem => ({ id: "qa-doc", docType: "INVOICE", documentVersion: 1, originalFileName: "SYNTHETIC-invoice.pdf", mimeType: "application/pdf", sizeBytes: 1234, pageCount: 2, extractionStatus: "UPLOADED", createdAt: "2026-11-08T00:00:00Z", isCurrent: true, ...patch });
const render = (documents: DocumentSlotItem[] = [], status = "DRAFT") => renderToStaticMarkup(createElement(ShipmentDocumentSlots, { shipmentId: "qa", shipmentReference: "QA-OPERATIONS", initialRevision: 1, initialShipmentStatus: status, initialDocuments: documents }));
function buttonAttributes(html: string, label: string) {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(([, , content]) => content.replace(/<[^>]+>/g, "") === label);
  if (!button) throw new Error(`Missing button ${label}`);
  return button[1];
}

describe("queue presentation uses server-derived actions", () => {
  it("wraps queue views on mobile and leaves padding for keyboard focus rings", () => {
    const html = renderToStaticMarkup(createElement(DashboardShell, { email: "synthetic@example.test", role: "EXECUTIVE" }));
    const group = html.match(/<div role="group" aria-label="Queue views" class="([^"]+)"/);
    expect(group?.[1]).toContain("flex-wrap");
    expect(group?.[1]).toContain("px-3");
    expect(group?.[1]).not.toContain("overflow-x-auto");
  });
  it("filters without inferring approval from badges or risk scores", () => {
    expect(matchesQueueView(shipment(), "documents")).toBe(true);
    expect(matchesQueueView(shipment({ riskScore: 100 }), "attention")).toBe(false);
    expect(matchesQueueView(shipment({ status: "READY_FOR_APPROVAL" }), "approval")).toBe(true);
    expect(matchesQueueView(shipment({ nextAction: { ...shipment().nextAction, urgency: "high" } }), "attention")).toBe(true);
  });
  it("provides explanatory priorities instead of invented risk percentages", () => {
    expect(queuePriority(shipment()).label).toBe("Next up");
    expect(queuePriority(shipment({ nextAction: { ...shipment().nextAction, urgency: "high" } }))).toEqual({ label: "High priority", variant: "warning" });
  });
  it("keeps approval/export actions in the guarded review route with honest copy", () => {
    expect(queueActionLabel(shipment({ nextAction: { ...shipment().nextAction, type: "export" } }))).toBe("Preview export");
    expect(queueActionLabel(shipment({ nextAction: { ...shipment().nextAction, type: "completed" } }))).toBe("View export history");
  });
  it("keeps supplier options through narrow and empty results", () => {
    const saved = [{ id: "a", name: "A supplier" }, { id: "b", name: "B supplier" }];
    expect(mergeSupplierOptions(saved, [])).toEqual(saved);
    expect(mergeSupplierOptions(saved, [shipment({ supplier: saved[0] })])).toEqual(saved);
    expect(mergeSupplierOptions(saved, [shipment({ supplier: { id: "c", name: "C supplier" } })])).toHaveLength(3);
  });
  it("labels absent, failed, processing, and unknown documents without a false pass", () => {
    expect(documentStateLabel("EXTRACTED", false)).toBe("Missing");
    expect(documentStateLabel("PROCESSING", true)).toBe("Extracting");
    expect(documentStateLabel("FAILED", true)).toBe("Failed");
    expect(documentStateLabel("NEW_STATUS", true)).toBe("NEW STATUS");
  });
  it("uses a deterministic UTC calendar date", () => {
    expect(formatQueueDate("2026-11-08T00:30:00+02:00")).toBe("07 Nov 2026");
  });
});

describe("document intake rendering", () => {
  it("puts three slots ahead of the collapsed synthetic loader", () => {
    const html = render();
    expect(html.indexOf('data-testid="slot-INVOICE"')).toBeLessThan(html.indexOf("Load synthetic sample documents"));
    expect(html).toContain('accept="application/pdf,image/png,image/jpeg"');
    expect(html).toContain('aria-describedby="upload-limits-INVOICE"');
    expect(html).toContain('id="slot-title-INVOICE"');
    expect(buttonAttributes(html, "Run extraction (3 documents)")).toContain('disabled=""');
    expect(html).not.toContain("certified synthetic");
  });
  it.each(["READY_FOR_APPROVAL", "APPROVED", "EXPORTED"])("locks extraction for %s, retaining evidence", (status) => {
    const html = render([doc()], status);
    expect(buttonAttributes(html, "Run extraction")).toContain('disabled=""');
    expect(buttonAttributes(html, "Preview")).not.toContain('disabled=""');
  });
  it("allows explicit approved document replacement, but locks exported uploads", () => {
    expect(buttonAttributes(render([doc()], "APPROVED"), "Replace")).not.toContain('disabled=""');
    expect(buttonAttributes(render([doc()], "EXPORTED"), "Replace")).toContain('disabled=""');
    expect(render([], "EXPORTED")).toMatch(/id="file-input-INVOICE"[^>]*disabled/);
  });
  it("makes saved processing visible even after page reload", () => {
    const html = render([doc({ extractionStatus: "PROCESSING" })], "EXTRACTING");
    expect(html).toContain("Waiting for the provider&#x27;s saved result");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("animate-pulse");
    expect(buttonAttributes(html, "Retry extraction")).toContain('disabled=""');
  });
  it("shows extraction failure, manual recovery, and a guarded retry", () => {
    const html = render([doc({ extractionStatus: "FAILED", latestRun: { id: "run", status: "FAILED", provider: "groq", model: "model", errorCode: "RATE_LIMIT", errorMessage: null, completedAt: null } })]);
    expect(html).toContain("Provider rate limit reached");
    expect(html).toContain("Enter values manually");
    expect(html).toContain('href="/review/qa-doc"');
    expect(html).toContain('data-slot="confirm-dialog"');
  });
  it("shows saved review flags and source inspection, not confidence as accuracy", () => {
    const html = render([doc({ extractionStatus: "REVIEW_REQUIRED", extractedFieldCount: 12, reviewRequiredCount: 2, lowConfidenceCount: 4, typeMismatch: true, detectedDocType: "PACKING_LIST", unreadablePageCount: 1 })]);
    expect(html).toContain("12 fields extracted");
    expect(html).toContain("2 fields require review");
    expect(html).toContain("saved review decisions take precedence");
    expect(html).toContain("Document type mismatch");
    expect(html).toContain("1 unreadable page(s) flagged");
  });
  it("uses saved review decisions instead of a stale extraction-time warning", () => {
    const html = render([doc({ extractionStatus: "REVIEW_REQUIRED", extractedFieldCount: 9, reviewRequiredCount: 0, lowConfidenceCount: 3 })], "EXPORTED");
    expect(html).toContain("0 fields require review");
    expect(html).not.toContain("Extracted · review needed");
    expect(html).toContain("saved review decisions take precedence");
    expect(buttonAttributes(html, "Retry extraction")).toContain('disabled=""');
  });
  it("preserves review warnings when saved counts are unresolved or unknown", () => {
    expect(render([doc({ extractionStatus: "REVIEW_REQUIRED", reviewRequiredCount: 2 })])).toContain("Extracted · review needed");
    expect(render([doc({ extractionStatus: "REVIEW_REQUIRED" })])).toContain("Extracted · review needed");
  });
  it("distinguishes upload transfer and validation without fake percent completion", () => {
    expect(uploadProgressLabel({ phase: "authorizing", percent: null })).toContain("Authorizing");
    expect(uploadProgressLabel({ phase: "uploading", percent: 47 })).toContain("47%");
    expect(uploadProgressLabel({ phase: "validating", percent: null })).toContain("Validating file");
    expect(uploadProgressLabel({ phase: "validating", percent: null })).not.toContain("100%");
  });
});
