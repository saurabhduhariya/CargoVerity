import { describe, expect, it } from "vitest";

import { runCrossChecks, selectLatestCrossCheckDocuments } from "@/lib/crosschecks";
import { canExport, selectLatestCrossChecks } from "@/lib/export/guard";

describe("deterministic cross-checks", () => {
  it("detects invoice arithmetic and weight mismatches without guessing a cause", () => {
    const results = runCrossChecks([
      {
        docType: "INVOICE",
        fields: { invoiceTotal: { value: "100" }, currency: { value: "USD" }, exporter: { value: "Exporter" } },
        lineItems: [{ description: "Widget", quantity: "1", quantityUnit: "pcs", lineTotal: "90", currency: "USD" }],
      },
      {
        docType: "PACKING_LIST",
        fields: { grossWeight: { value: "45", unit: "kg" }, netWeight: { value: "50", unit: "kg" }, packageCount: { value: "2" }, exporter: { value: "Exporter" } },
        lineItems: [{ description: "Widget", quantity: "1", quantityUnit: "pcs", lineTotal: null, currency: null }],
      },
      {
        docType: "BILL_OF_LADING",
        fields: { grossWeight: { value: "40", unit: "kg" }, packageCount: { value: "2" }, exporter: { value: "Exporter" } },
        lineItems: [],
      },
    ]);

    expect(results.find((result) => result.ruleKey === "invoice_line_total")?.status).toBe("MISMATCH");
    expect(results.find((result) => result.ruleKey === "gross_weight_comparison")?.status).toBe("MISMATCH");
    expect(results.find((result) => result.ruleKey === "gross_weight_vs_net_weight")?.status).toBe("MISMATCH");
  });

  it("blocks export until the current revision has manager approval and resolved checks", () => {
    expect(canExport({ hasManagerApproval: false, approvedRevision: null, currentRevision: 2, unresolvedStatuses: ["MISMATCH"], profileId: "demo-v1" })).toEqual({ allowed: false, reasons: ["manager_approval_required", "approval_is_stale", "cross_checks_unresolved"] });
    expect(canExport({ hasManagerApproval: true, approvedRevision: 2, currentRevision: 2, unresolvedStatuses: [], profileId: "demo-v1" })).toEqual({ allowed: true, reasons: [] });
  });

  it("uses the newest document of each type for cross-checks", () => {
    const invoice = { docType: "INVOICE" as const, fields: {}, lineItems: [] };
    const packingList = { docType: "PACKING_LIST" as const, fields: {}, lineItems: [] };

    expect(selectLatestCrossCheckDocuments([invoice, packingList, { ...invoice, fields: { invoiceTotal: { value: "400" } } }])).toEqual([invoice, packingList]);
  });

  it("uses the latest result for each rule when checks are rerun", () => {
    const older = new Date("2026-11-04T10:00:00Z");
    const newer = new Date("2026-11-04T10:01:00Z");

    expect(selectLatestCrossChecks([
      { ruleKey: "invoice_line_total", status: "INCOMPLETE", createdAt: older },
      { ruleKey: "invoice_line_total", status: "PASS", createdAt: newer },
    ])).toEqual([{ ruleKey: "invoice_line_total", status: "PASS", createdAt: newer }]);
  });
});
