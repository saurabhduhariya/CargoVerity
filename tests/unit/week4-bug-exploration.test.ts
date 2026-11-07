import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";

import { checkInvoiceArithmetic } from "@/lib/crosschecks/invoice-arithmetic";
import { matchLineItems } from "@/lib/crosschecks/line-item-matching";
import { checkGrossWeight } from "@/lib/crosschecks/weight-package-checks";
import { runCrossChecks, type CrossCheckDocument, type CrossCheckField } from "@/lib/crosschecks";
import { computeInputHash, createCrossCheckRun, getLatestCrossCheckRun } from "@/lib/crosschecks/service";
import { deriveCrossChecksSummary } from "@/lib/shipments";
import { evaluateSubmissionGuard, type SubmissionGuardCrossCheck } from "@/lib/submission/guard";
import {
  compareMonetaryAmounts,
  comparePartyNames,
  normalizeMonetaryAmount,
  normalizePackageDetails,
  normalizeWeight,
  parseStrictDecimal,
} from "@/lib/normalizers";

/**
 * Week 4 bug condition exploration tests (C1-C8, unit level).
 *
 * These encode the EXPECTED (fixed) behavior. They are meant to FAIL on the unfixed code; each
 * failure is a counterexample that confirms a defect from bugfix.md. DB-backed and concurrency
 * cases live in tests/integration/week4-crosscheck-review.test.ts.
 */

const ROOT = process.cwd();
const dec = (value: unknown) => new Decimal(String(value));

function field(value: string | number | null, unit: string | null = null, id?: string): CrossCheckField {
  return { id, value, unit };
}

function doc(
  docType: CrossCheckDocument["docType"],
  fields: Record<string, CrossCheckField | undefined>,
  lineItems: CrossCheckDocument["lineItems"] = [],
): CrossCheckDocument {
  return { docType, fields, lineItems };
}

function ruleResult(results: ReturnType<typeof runCrossChecks>, ruleKey: string) {
  const found = results.find((r) => r.ruleKey === ruleKey);
  if (!found) throw new Error(`rule ${ruleKey} not produced`);
  return found;
}

describe("C1 - Normalizers, tolerances and comparison helpers", () => {
  it("SHP-24811: 3,120 / 3,165 / 3,165 kg is an exact 45 kg MISMATCH with tolerance 15.825 kg (0.5%) and unknown cause", () => {
    const results = runCrossChecks([
      doc("INVOICE", { grossWeight: field("3120", "kg", "inv-gw") }),
      doc("PACKING_LIST", { grossWeight: field("3165", "kg", "pl-gw") }),
      doc("BILL_OF_LADING", { grossWeight: field("3165", "kg", "bl-gw") }),
    ]);
    const gross = ruleResult(results, "gross_weight_comparison");
    const details = gross.details as Record<string, unknown>;

    expect(gross.status).toBe("MISMATCH");
    expect(dec(details.differenceKg).equals(45)).toBe(true);
    expect(dec(details.toleranceKg).equals("15.825")).toBe(true);
    expect(dec(details.tolerancePercent).equals("0.5")).toBe(true);
    expect(details.cause).toBe("unknown");
  });

  it("weights: 1,000 vs 1,004 kg passes (5.02 kg tolerance); 1,000 vs 1,010 kg mismatches", () => {
    const run = (a: string, b: string) =>
      checkGrossWeight({
        candidates: [
          { documentType: "PACKING_LIST", value: a, unit: "kg" },
          { documentType: "BILL_OF_LADING", value: b, unit: "kg" },
        ],
        requiredDocuments: ["PACKING_LIST", "BILL_OF_LADING"],
      });

    expect(run("1000", "1004").status).toBe("PASS");
    expect(run("1000", "1010").status).toBe("MISMATCH");
  });

  it("money: 100.00 vs 100.01 passes and 100.00 vs 100.02 mismatches at the default 0.01 tolerance", () => {
    const money = (amount: string) => {
      const parsed = normalizeMonetaryAmount({ amount, currency: "USD" });
      if (!parsed.ok) throw new Error("fixture must parse");
      return parsed;
    };
    const near = compareMonetaryAmounts(money("100.00"), money("100.01"));
    const far = compareMonetaryAmounts(money("100.00"), money("100.02"));

    expect(near.comparable && near.isMatch).toBe(true);
    expect(far.comparable && far.isMatch).toBe(false);
    expect(far.comparable && far.tolerance.equals("0.01")).toBe(true);
  });

  it.each(["ton", "tons"])("weight unit %s is ambiguous (AMBIGUOUS_WEIGHT_UNIT), while t and mt still parse as tonnes", (unit) => {
    const ambiguous = normalizeWeight({ value: "2.5", unit });
    expect(ambiguous.ok).toBe(false);
    expect(!ambiguous.ok && ambiguous.error).toBe("AMBIGUOUS_WEIGHT_UNIT");

    for (const tonne of ["t", "mt"]) {
      const parsed = normalizeWeight({ value: "2.5", unit: tonne });
      expect(parsed.ok && parsed.weightInKg.equals(2500)).toBe(true);
    }
  });

  it("currency: ZZZ is INVALID_CURRENCY_CODE while USD is accepted", () => {
    const invalid = normalizeMonetaryAmount({ amount: "10.00", currency: "ZZZ" });
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && invalid.error).toBe("INVALID_CURRENCY_CODE");
    expect(normalizeMonetaryAmount({ amount: "10.00", currency: "USD" }).ok).toBe(true);
  });

  it("decimal: Indian lakh grouping parses; malformed groupings are rejected", () => {
    const lakh = parseStrictDecimal("12,34,567.50");
    expect(lakh.ok && lakh.value.equals("1234567.5")).toBe(true);
    for (const bad of ["3,120.00.00", "abc", "", "1,2,3"]) {
      expect(parseStrictDecimal(bad).ok, `"${bad}" must be rejected`).toBe(false);
    }
  });

  it("party: leading designator words are kept; dotted and extra designators are stripped when non-leading", () => {
    expect(comparePartyNames("SA Logistics", "AB Logistics").isMatch).toBe(false);
    expect(comparePartyNames("Acme Trading L.L.C.", "Acme Trading LLC").isMatch).toBe(true);
    expect(comparePartyNames("Acme Pte Ltd", "Acme").isMatch).toBe(true);
  });

  it("package: '1,200,000 cartons' parses to count 1200000 and a carton type", () => {
    const parsed = normalizePackageDetails({ combinedInput: "1,200,000 cartons" });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.count).toBe(1_200_000);
    expect(parsed.ok && parsed.packageType?.toLowerCase()).toMatch(/^carton/);
  });
});

describe("C2 - Invoice arithmetic", () => {
  const goodsLine = {
    id: "line-1",
    lineNumber: 1,
    description: "Steel bolts M8",
    quantity: "10",
    unitPrice: "500.00",
    lineTotal: "5000.00",
    currency: null,
  };

  it("falls back to invoiceTotal.unit for the currency (not INCOMPLETE / MISSING_INVOICE_CURRENCY)", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { id: "total", value: "5000.00", unit: "USD", currency: null },
      lineItems: [goodsLine],
    });

    expect(JSON.stringify(result.details)).not.toContain("MISSING_INVOICE_CURRENCY");
    expect(result.status).toBe("PASS");
  });

  it("goods 1,000 + Ocean freight 100 + Discount 50 = 1,050 with the discount signed -50", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { id: "total", value: "1050.00", unit: "USD", currency: "USD" },
      currency: { id: "cur", value: "USD" },
      lineItems: [
        { id: "g", lineNumber: 1, description: "Steel bolts M8", quantity: "1", unitPrice: "1000.00", lineTotal: "1000.00", currency: "USD" },
        { id: "f", lineNumber: 2, description: "Ocean freight", quantity: "1", unitPrice: "100.00", lineTotal: "100.00", currency: "USD" },
        { id: "d", lineNumber: 3, description: "Discount", quantity: "1", unitPrice: "50.00", lineTotal: "50.00", currency: "USD" },
      ],
    });

    expect(result.status).toBe("PASS");
    const compared = (result.details as unknown as { compared?: { charges?: Array<{ kind: string; sign: number }> } }).compared;
    expect(compared?.charges?.find((c) => c.kind === "DISCOUNT")?.sign).toBe(-1);
    expect(compared?.charges?.find((c) => c.kind === "FREIGHT")?.sign).toBe(1);
  });

  it("result details carry compared values, difference, tolerance, derived markers and source field IDs", () => {
    const result = checkInvoiceArithmetic({
      invoiceTotal: { id: "total", value: "5000.00", unit: "USD", currency: "USD" },
      lineItems: [{ ...goodsLine, currency: "USD" }],
    });
    const details = result.details as unknown as Record<string, unknown>;

    for (const key of ["compared", "difference", "toleranceUsed", "derived", "sourceFieldIds", "sourceFieldIdList", "lines"]) {
      expect(details, `details.${key}`).toHaveProperty(key);
    }
    // sourceFieldIds keeps its existing keyed-object contract; the flat list is additive.
    expect(Array.isArray(details.sourceFieldIdList)).toBe(true);
    expect(Array.isArray(details.derived)).toBe(true);
  });

  it("charge lines are excluded from line-item matching", () => {
    const results = runCrossChecks([
      doc(
        "INVOICE",
        { invoiceTotal: field("1100.00", "USD") },
        [
          { id: "g", lineNumber: 1, description: "Steel bolts M8", quantity: "10", quantityUnit: "pcs", lineTotal: "1000.00", currency: "USD" },
          { id: "f", lineNumber: 2, description: "Ocean freight", quantity: "1", quantityUnit: null, lineTotal: "100.00", currency: "USD" },
        ],
      ),
      doc("PACKING_LIST", {}, [{ id: "p", lineNumber: 1, description: "Steel bolts M8", quantity: "10", quantityUnit: "pcs", lineTotal: null, currency: null }]),
    ]);
    const matching = ruleResult(results, "invoice_quantity_vs_packing_list");
    const details = matching.details as Record<string, unknown>;

    expect(details.totalInvoiceLines).toBe(1);
    expect(matching.status).toBe("PASS");
  });
});

describe("C3 - Weight and package checks", () => {
  it("gross>=net sanity runs on the Invoice (net > gross is a MISMATCH in the aggregate)", () => {
    const results = runCrossChecks([
      doc("INVOICE", { grossWeight: field("10", "kg"), netWeight: field("12", "kg") }),
      doc("PACKING_LIST", { grossWeight: field("10", "kg") }),
    ]);
    expect(ruleResult(results, "gross_weight_vs_net_weight").status).toBe("MISMATCH");
  });

  it("no document with both gross and net => NOT_APPLICABLE, never INCOMPLETE solely for the optional net weight", () => {
    const results = runCrossChecks([doc("PACKING_LIST", { grossWeight: field("100", "kg") })]);
    expect(ruleResult(results, "gross_weight_vs_net_weight").status).toBe("NOT_APPLICABLE");
  });

  it("exporter_consistency uses the party normalizer and carries WARNING severity", () => {
    const results = runCrossChecks([
      doc("INVOICE", { exporter: field("Acme Trading L.L.C.") }),
      doc("PACKING_LIST", { exporter: field("Acme Trading LLC") }),
    ]);
    const exporter = ruleResult(results, "exporter_consistency") as { status: string; severity?: string };

    expect(exporter.status).toBe("PASS");
    expect(exporter.severity).toBe("WARNING");
  });
});

describe("C4 - Line matching", () => {
  const plLine = { id: "pl-1", lineNumber: 1, description: "Steel bolts M8", quantity: "10", quantityUnit: "pcs" };
  const invA = { id: "inv-1", lineNumber: 1, description: "Steel bolts M8", quantity: "10", quantityUnit: "pcs" };
  const invB = { id: "inv-2", lineNumber: 2, description: "Steel bolts M8", quantity: "20", quantityUnit: "pcs" };

  const pairSet = (invoiceLines: typeof invA[]) =>
    matchLineItems({ invoiceLines, packingListLines: [plLine] })
      .details.matchedPairs.map((p) => `${p.invoiceLineId}->${p.packingListLineId}`)
      .sort();

  it("permuting the invoice lines yields the same matched pairs", () => {
    expect(pairSet([invA, invB])).toEqual(pairSet([invB, invA]));
  });

  it("two invoice lines competing for one packing-list line stay unresolved (INCOMPLETE), no greedy claim", () => {
    const result = matchLineItems({ invoiceLines: [invA, invB], packingListLines: [plLine] });
    expect(result.details.matchedPairsCount).toBe(0);
    expect(result.status).toBe("INCOMPLETE");
  });

  it("duplicate candidates on the packing-list side stay INCOMPLETE with no array-index fallback", () => {
    const result = matchLineItems({
      invoiceLines: [invA],
      packingListLines: [plLine, { ...plLine, id: "pl-2", lineNumber: 2 }],
    });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.details.matchedPairsCount).toBe(0);
    expect(result.details.unmatchedLines.some((l) => l.reason === "AMBIGUOUS_DUPLICATE_CANDIDATES")).toBe(true);
  });

  it("an unmatched packing-list line reports its quantity even when quantityUnit is null", () => {
    const result = matchLineItems({
      invoiceLines: [invA],
      packingListLines: [{ id: "pl-x", lineNumber: 1, description: "Unrelated widget", quantity: "5", quantityUnit: null }],
    });
    const unmatched = result.details.unmatchedLines.find((l) => l.documentType === "PACKING_LIST");
    expect(unmatched?.quantity).toBe("5");
  });

  it("a manual-mapping data model, service and route exist (LineItemMapping)", () => {
    const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model\s+LineItemMapping\s*\{/);
    expect(existsSync(join(ROOT, "src/lib/crosschecks/line-mapping.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/api/shipments/[id]/line-mappings/route.ts"))).toBe(true);
  });
});

describe("C5 - Persistence hash and transaction", () => {
  const snapshot = (overrides: { value?: string; quantity?: string; mapping?: string; tolerance?: string } = {}) => ({
    shipmentId: "s1",
    revision: 3,
    tolerances: { monetary: overrides.tolerance ?? "0.01", weightPercent: "0.5" },
    mappings: [{ invoiceLineId: "i1", packingListLineId: overrides.mapping ?? "p1" }],
    documents: [
      {
        documentId: "d1",
        docType: "PACKING_LIST",
        documentVersion: 1,
        fields: { grossWeight: { id: "f1", value: overrides.value ?? "3165", unit: "kg" } },
        lineItems: [{ id: "l1", lineNumber: 1, quantity: overrides.quantity ?? "10" }],
      },
    ],
  });

  it("changes when a nested field value changes (3165 -> 3156)", () => {
    expect(computeInputHash(snapshot({ value: "3156" }))).not.toBe(computeInputHash(snapshot()));
  });

  it("changes when a line quantity changes", () => {
    expect(computeInputHash(snapshot({ quantity: "11" }))).not.toBe(computeInputHash(snapshot()));
  });

  it("changes when an active mapping changes", () => {
    expect(computeInputHash(snapshot({ mapping: "p2" }))).not.toBe(computeInputHash(snapshot()));
  });

  it("changes when a tolerance changes", () => {
    expect(computeInputHash(snapshot({ tolerance: "0.05" }))).not.toBe(computeInputHash(snapshot()));
  });

  it("is stable under key reordering at every level", () => {
    const reordered = {
      documents: [
        {
          lineItems: [{ quantity: "10", lineNumber: 1, id: "l1" }],
          fields: { grossWeight: { unit: "kg", value: "3165", id: "f1" } },
          documentVersion: 1,
          docType: "PACKING_LIST",
          documentId: "d1",
        },
      ],
      mappings: [{ packingListLineId: "p1", invoiceLineId: "i1" }],
      tolerances: { weightPercent: "0.5", monetary: "0.01" },
      revision: 3,
      shipmentId: "s1",
    };
    expect(computeInputHash(reordered)).toBe(computeInputHash(snapshot()));
  });

  it("reads the shipment inside the same transaction that creates the run", async () => {
    const calls: string[] = [];
    const shipmentRow = { id: "s1", currentRevision: 4, documents: [] };
    const runRow = { id: "run-1", createdAt: new Date() };
    const txClient = {
      shipment: { findUnique: vi.fn(async () => (calls.push("tx.shipment.findUnique"), shipmentRow)) },
      lineItemMapping: { findMany: vi.fn(async () => []) },
      crossCheckRun: { create: vi.fn(async () => (calls.push("tx.crossCheckRun.create"), runRow)) },
      crossCheckResult: {
        create: vi.fn(async () => ({})),
        createMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
    };
    const client = {
      shipment: { findUnique: vi.fn(async () => (calls.push("client.shipment.findUnique"), shipmentRow)) },
      $transaction: vi.fn(async (callback: (tx: typeof txClient) => unknown) => callback(txClient)),
    };

    await createCrossCheckRun({ shipmentId: "s1", prismaClient: client as never }).catch(() => undefined);

    expect(calls).not.toContain("client.shipment.findUnique");
    expect(calls.indexOf("tx.shipment.findUnique")).toBeGreaterThanOrEqual(0);
  });
});

describe("C6 - Review workspace", () => {
  it("nextUncertainFieldId([A,B,C], A) gives B, then C, then wraps to A", async () => {
    const mod = await import("@/features/review/next-uncertain");
    const ids = ["A", "B", "C"];
    expect(mod.nextUncertainFieldId(ids, "A")).toBe("B");
    expect(mod.nextUncertainFieldId(ids, "B")).toBe("C");
    expect(mod.nextUncertainFieldId(ids, "C")).toBe("A");
  });

  it("the workspace does not render PDFs in an <iframe>", () => {
    const source = readFileSync(join(ROOT, "src/features/review/review-workspace.tsx"), "utf8");
    expect(source).not.toMatch(/<iframe/);
  });

  it("a PDF.js canvas viewer exists with range and stream disabled", () => {
    const viewerPath = join(ROOT, "src/features/review/document-viewer.tsx");
    expect(existsSync(viewerPath)).toBe(true);
    const source = readFileSync(viewerPath, "utf8");
    expect(source).toMatch(/disableRange:\s*true/);
    expect(source).toMatch(/disableStream:\s*true/);
  });

  it("review-panel.tsx has no importers and is removed", () => {
    const importers: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", ".next", "generated"].includes(entry.name)) continue;
          scan(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith("week4-bug-exploration.test.ts")) {
          const source = readFileSync(full, "utf8");
          const imports = /from\s+["'][^"']*review-panel["']|import\(\s*["'][^"']*review-panel["']|<ReviewPanel\b/.test(source);
          if (imports && !full.endsWith("review-panel.tsx")) {
            importers.push(full);
          }
        }
      }
    };
    scan(join(ROOT, "src"));
    scan(join(ROOT, "tests"));

    expect(importers).toEqual([]);
    expect(existsSync(join(ROOT, "src/features/review/review-panel.tsx"))).toBe(false);
  });
});

describe("C8 - Resolution semantics across consumers", () => {
  const base = new Date("2026-11-05T10:00:00.000Z");
  const resolution = (
    id: string,
    type: "SOURCE_CORRECTED" | "DOCUMENT_REPLACEMENT" | "ACCEPTED_EXCEPTION",
    extra: { evidence?: string | null; managerApprovedAt?: Date | null; createdAt?: Date } = {},
  ) => ({
    id,
    type,
    reason: "reviewed with supplier",
    evidence: extra.evidence ?? null,
    managerApprovedAt: extra.managerApprovedAt ?? null,
    createdAt: extra.createdAt ?? base,
  });

  function guardBlockers(check: SubmissionGuardCrossCheck) {
    const result = evaluateSubmissionGuard({
      shipmentId: "s1",
      currentRevision: 2,
      shipmentStatus: "NEEDS_REVIEW",
      userRole: "EXECUTIVE",
      documents: [],
      latestCheckRun: { id: "run", revision: 2, results: [check] },
      lowConfidenceThreshold: 0.85,
    });
    return result.blockers.filter((b) => b.checkRuleKey === check.ruleKey).map((b) => b.code);
  }

  function failingCheck(overrides: Partial<SubmissionGuardCrossCheck> & { resolutions: unknown[] }) {
    return {
      id: "c1",
      ruleKey: "gross_weight_comparison",
      status: "MISMATCH",
      severity: "BLOCKING",
      ...overrides,
    } as unknown as SubmissionGuardCrossCheck;
  }

  function summaryFor(check: ReturnType<typeof failingCheck> & { createdAt?: Date }) {
    return deriveCrossChecksSummary(
      [{ ...(check as object), createdAt: base, revision: 2 }] as never,
      2,
    );
  }

  async function latestFor(check: ReturnType<typeof failingCheck>) {
    const run = {
      id: "run",
      shipmentId: "s1",
      revision: 2,
      createdAt: base,
      results: [{ ...(check as object), runId: "run", revision: 2, details: {}, createdAt: base }],
    };
    const client = { crossCheckRun: { findFirst: vi.fn(async () => run) } };
    return getLatestCrossCheckRun({ shipmentId: "s1", prismaClient: client as never });
  }

  it("a reason-only SOURCE_CORRECTED resolution does not clear a failing BLOCKING check in any consumer", async () => {
    const check = failingCheck({ resolutions: [resolution("r1", "SOURCE_CORRECTED")] });

    expect(guardBlockers(check)).toContain("UNRESOLVED_CROSS_CHECK");
    expect(summaryFor(check).blockingUnresolved).toBe(1);
    const latest = await latestFor(check);
    expect(latest?.results[0].effectiveStatus).not.toBe("HUMAN_CLEARED");
  });

  it("an unapproved valid ACCEPTED_EXCEPTION clears submission but not approval/export in getLatestCrossCheckRun", async () => {
    const check = failingCheck({ resolutions: [resolution("r1", "ACCEPTED_EXCEPTION", { evidence: "TKT-8492" })] });
    const latest = await latestFor(check);
    const first = latest?.results[0] as unknown as { clearedForSubmission?: boolean; clearedForApproval?: boolean };

    expect(guardBlockers(check)).toEqual([]);
    expect(first.clearedForSubmission).toBe(true);
    expect(first.clearedForApproval).toBe(false);
  });

  it("an ACCEPTED_EXCEPTION without evidence is reported as a blocker by the guard", () => {
    const check = failingCheck({ resolutions: [resolution("r1", "ACCEPTED_EXCEPTION", { evidence: null })] });
    expect(guardBlockers(check)).toContain("ACCEPTED_EXCEPTION_MISSING_EVIDENCE");
  });

  it("createdAt ties are resolved deterministically: input order does not change any consumer's answer", async () => {
    const exception = resolution("a-exception", "ACCEPTED_EXCEPTION", { evidence: "TKT-1", managerApprovedAt: null });
    const link = resolution("b-link", "SOURCE_CORRECTED");
    const forward = failingCheck({ resolutions: [exception, link] });
    const reversed = failingCheck({ resolutions: [link, exception] });

    expect(guardBlockers(forward)).toEqual(guardBlockers(reversed));
    expect(summaryFor(forward).blockingUnresolved).toBe(summaryFor(reversed).blockingUnresolved);
    const [a, b] = await Promise.all([latestFor(forward), latestFor(reversed)]);
    expect(a?.results[0].effectiveStatus).toBe(b?.results[0].effectiveStatus);
  });

  it("a failing WARNING exporter_consistency check never blocks submission or the shipment summary", () => {
    const check = failingCheck({ ruleKey: "exporter_consistency", severity: "WARNING", resolutions: [] });

    expect(guardBlockers(check)).toEqual([]);
    expect(summaryFor(check).blockingUnresolved).toBe(0);
  });
});
