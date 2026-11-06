import { describe, expect, it, vi } from "vitest";
import {
  computeInputHash,
  createCrossCheckRun,
  getCrossCheckHistory,
  getLatestCrossCheckRun,
  RULE_METADATA,
} from "@/lib/crosschecks/service";
import * as db from "@/lib/db";
import * as auth from "@/lib/auth";
import { GET, POST } from "@/app/api/shipments/[id]/crosschecks/route";

describe("Cross-Check Run Persistence Service (Week 4 Step 5)", () => {
  it("computes a deterministic SHA-256 hash for identical input snapshots regardless of key order", () => {
    const snapshotA = { revision: 1, shipmentId: "ship-1", documents: [{ docType: "INVOICE" }] };
    const snapshotB = { documents: [{ docType: "INVOICE" }], shipmentId: "ship-1", revision: 1 };

    const hashA = computeInputHash(snapshotA);
    const hashB = computeInputHash(snapshotB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates a CrossCheckRun snapshot and immutable CrossCheckResult rows linked to runId", async () => {
    const mockShipment = {
      id: "ship-123",
      currentRevision: 2,
      documents: [
        {
          id: "doc-inv",
          docType: "INVOICE",
          documentVersion: 1,
          isCurrent: true,
          extractionRuns: [
            {
              id: "run-ext-1",
              status: "COMPLETED",
              fields: [
                { fieldKey: "invoiceTotal", currentValue: "100.00", unit: null, sourceQuote: "Total: $100.00" },
                { fieldKey: "currency", currentValue: "USD", unit: null, sourceQuote: "USD" },
              ],
              lineItems: [
                {
                  id: "item-1",
                  lineNumber: 1,
                  description: "Electronic Sensor",
                  quantity: 10,
                  quantityUnit: "pcs",
                  lineTotal: 100,
                  currency: "USD",
                },
              ],
            },
          ],
        },
      ],
    };

    let createdRunData: unknown = null;
    const createdResults: unknown[] = [];

    const mockPrisma = {
      shipment: {
        findUnique: vi.fn().mockResolvedValue(mockShipment),
      },
      crossCheckRun: {
        create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
          createdRunData = { id: "cc-run-999", ...(data as object) };
          return createdRunData;
        }),
      },
      crossCheckResult: {
        create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
          const res = { id: `res-${createdResults.length + 1}`, ...(data as object), resolutions: [] };
          createdResults.push(res);
          return res;
        }),
      },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };

    const runResult = await createCrossCheckRun({
      shipmentId: "ship-123",
      requestedById: "user-exec-1",
      triggeredBy: "USER_REQUEST",
      prismaClient: mockPrisma as never,
    });

    expect(mockPrisma.shipment.findUnique).toHaveBeenCalledWith({
      where: { id: "ship-123" },
      include: expect.anything(),
    });

    expect(mockPrisma.crossCheckRun.create).toHaveBeenCalled();
    const runRecord = createdRunData as { id: string; revision: number; inputHash: string; triggeredBy: string };
    expect(runRecord.id).toBe("cc-run-999");
    expect(runRecord.revision).toBe(2);
    expect(runRecord.triggeredBy).toBe("USER_REQUEST");
    expect(runRecord.inputHash).toMatch(/^[a-f0-9]{64}$/);

    // Results linked to run
    expect(createdResults.length).toBeGreaterThan(0);
    for (const res of createdResults as Array<{ runId: string; revision: number; severity: string; ruleCode: string }>) {
      expect(res.runId).toBe("cc-run-999");
      expect(res.revision).toBe(2);
      expect(["BLOCKING", "WARNING"]).toContain(res.severity);
      expect(res.ruleCode).toBeDefined();
    }

    expect(runResult.run.id).toBe("cc-run-999");
    expect(runResult.results).toHaveLength(createdResults.length);
  });

  it("retrieves the latest run and computes HUMAN_CLEARED effective status when accepted exception is manager-approved", async () => {
    const mockRun = {
      id: "run-rev-2",
      shipmentId: "ship-100",
      revision: 2,
      createdAt: new Date("2026-11-06T12:00:00Z"),
      results: [
        {
          id: "res-arithmetic",
          ruleKey: "invoice_line_total",
          ruleCode: "CHK_INVOICE_ARITHMETIC",
          status: "PASS",
          severity: "BLOCKING",
          resolutions: [],
        },
        {
          id: "res-gross-weight",
          ruleKey: "gross_weight_comparison",
          ruleCode: "CHK_GROSS_WEIGHT",
          status: "MISMATCH", // historical mismatch
          severity: "BLOCKING",
          resolutions: [
            {
              id: "resolv-1",
              type: "ACCEPTED_EXCEPTION",
              reason: "Known tare variance confirmed by port agent",
              managerApprovedAt: new Date("2026-11-06T12:30:00Z"), // approved by manager
              resolvedBy: { id: "mgr-1", email: "mgr@cargoverity.test", role: "MANAGER" },
            },
          ],
        },
      ],
    };

    const mockPrisma = {
      crossCheckRun: {
        findFirst: vi.fn().mockResolvedValue(mockRun),
      },
    };

    const latest = await getLatestCrossCheckRun({
      shipmentId: "ship-100",
      revision: 2,
      prismaClient: mockPrisma as never,
    });

    expect(latest).not.toBeNull();
    const passedCheck = latest?.results.find((r) => r.ruleKey === "invoice_line_total");
    expect(passedCheck?.effectiveStatus).toBe("PASS");

    // The historical failed result remains MISMATCH in status, but effectiveStatus is derived as HUMAN_CLEARED
    const weightCheck = latest?.results.find((r) => r.ruleKey === "gross_weight_comparison");
    expect(weightCheck?.status).toBe("MISMATCH"); // Original status is immutable
    expect(weightCheck?.effectiveStatus).toBe("HUMAN_CLEARED"); // Derived UI state
    expect(weightCheck?.activeResolution?.type).toBe("ACCEPTED_EXCEPTION");
  });

  it("retrieves complete historical check runs across multiple revisions", async () => {
    const mockHistory = [
      { id: "run-2", revision: 2, createdAt: new Date("2026-11-06T14:00:00Z"), results: [] },
      { id: "run-1", revision: 1, createdAt: new Date("2026-11-06T10:00:00Z"), results: [] },
    ];

    const mockPrisma = {
      crossCheckRun: {
        findMany: vi.fn().mockResolvedValue(mockHistory),
      },
    };

    const history = await getCrossCheckHistory({
      shipmentId: "ship-100",
      prismaClient: mockPrisma as never,
    });

    expect(history).toHaveLength(2);
    expect(history[0].revision).toBe(2);
    expect(history[1].revision).toBe(1);
  });

  it("verifies RULE_METADATA classifies arithmetic and weights as BLOCKING and party checks as WARNING", () => {
    expect(RULE_METADATA.invoice_line_total.severity).toBe("BLOCKING");
    expect(RULE_METADATA.gross_weight_comparison.severity).toBe("BLOCKING");
    expect(RULE_METADATA.package_count_comparison.severity).toBe("BLOCKING");
    expect(RULE_METADATA.invoice_quantity_vs_packing_list.severity).toBe("BLOCKING");
    expect(RULE_METADATA.gross_weight_vs_net_weight.severity).toBe("BLOCKING");
    expect(RULE_METADATA.exporter_consistency.severity).toBe("WARNING");
  });

  it("supports POST and GET /api/shipments/[id]/crosschecks Route Handlers", async () => {
    vi.spyOn(auth, "requireAppUser").mockResolvedValue({
      appUser: { id: "user-1", email: "user@test.com", role: "EXECUTIVE" },
    } as never);

    const mockShipment = {
      id: "shp-abc",
      currentRevision: 1,
      documents: [],
    };

    const mockRun = {
      id: "run-123",
      shipmentId: "shp-abc",
      revision: 1,
      results: [],
    };

    const mockPrisma = {
      shipment: {
        findFirst: vi.fn().mockResolvedValue(mockShipment),
        findUnique: vi.fn().mockResolvedValue(mockShipment),
      },
      crossCheckRun: {
        create: vi.fn().mockResolvedValue(mockRun),
        findFirst: vi.fn().mockResolvedValue(mockRun),
      },
      crossCheckResult: {
        create: vi.fn().mockResolvedValue({ id: "res-1", status: "PASS", resolutions: [] }),
      },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };

    vi.spyOn(db, "getPrisma").mockReturnValue(mockPrisma as never);

    // POST
    const postReq = new Request("http://localhost/api/shipments/shp-abc/crosschecks", { method: "POST" });
    const postRes = await POST(postReq, { params: Promise.resolve({ id: "shp-abc" }) });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.runId).toBe("run-123");
    expect(postJson.revision).toBe(1);

    // GET
    const getReq = new Request("http://localhost/api/shipments/shp-abc/crosschecks", { method: "GET" });
    const getRes = await GET(getReq, { params: Promise.resolve({ id: "shp-abc" }) });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.shipmentId).toBe("shp-abc");
    expect(getJson.latestRun).toBeDefined();
  });
});

