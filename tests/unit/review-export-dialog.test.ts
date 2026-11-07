import { afterEach, describe, expect, it, vi } from "vitest";

import { canDownloadExport, copyExportChecksum, exportSnapshotMatches, isExportPreviewResponse, latestServerExportRecord } from "@/features/review/export-preview-dialog";
import { makeExportPreview, makeExportRecord } from "../fixtures/review-workspace-data";

afterEach(() => vi.unstubAllGlobals());

describe("export preview response structure", () => {
  it("accepts actual ready and guarded-blocked preview shapes", () => {
    expect(isExportPreviewResponse(makeExportPreview())).toBe(true);
    expect(isExportPreviewResponse(makeExportPreview({ ready: false, allowed: false, shipmentStatus: "NEEDS_REVIEW", approvedRevision: null, approvedAt: null, approvedBy: null, blockers: ["shipment_not_approved"], headers: undefined, rows: undefined, fileName: undefined, checksumSha256: undefined }))).toBe(true);
    expect(isExportPreviewResponse(makeExportPreview({ recentExport: makeExportRecord() }))).toBe(true);
  });

  it.each([
    null, {}, { ready: true }, { error: "Authentication required" },
    { ...makeExportPreview(), blockers: [false] }, { ...makeExportPreview(), currentRevision: "6" },
    { ...makeExportPreview(), approvedRevision: undefined }, { ...makeExportPreview(), approvedAt: {} },
    { ...makeExportPreview(), approvedBy: [] }, { ...makeExportPreview(), headers: [42] },
    { ...makeExportPreview(), rows: [[null]] }, { ...makeExportPreview(), fileName: {} },
    { ...makeExportPreview(), checksumSha256: "not-a-sha256" }, { ...makeExportPreview(), rowCount: -1 },
    { ...makeExportPreview(), blockerDetails: [{ code: "blocked", detail: {} }] },
    { ...makeExportPreview(), recentExport: {} },
    { ...makeExportPreview(), recentExport: makeExportRecord({ createdAt: "invalid-date" }) },
  ])("rejects malformed data rather than rendering untrusted receipt fields: %j", (body) => {
    expect(isExportPreviewResponse(body)).toBe(false);
  });
});

describe("checksum clipboard feedback", () => {
  it("removes the earlier clipboard error after a successful retry", async () => {
    const hash = "a".repeat(64);
    const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const denied = await copyExportChecksum(hash);
    expect(denied.copiedHash).toBeNull();
    expect(denied.error).toContain("Select and copy the full checksum below.");
    expect(await copyExportChecksum(hash)).toEqual({ copiedHash: hash, error: null });
    expect(writeText.mock.calls).toEqual([[hash], [hash]]);
  });

  it("does not retain a success indicator when a later copy fails", async () => {
    const hash = "a".repeat(64);
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Clipboard denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    expect(await copyExportChecksum(hash)).toEqual({ copiedHash: hash, error: null });
    expect(await copyExportChecksum(hash)).toEqual({ copiedHash: null, error: "Clipboard access was unavailable. Select and copy the full checksum below." });
  });

  it("provides manual-copy recovery when the clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const result = await copyExportChecksum("a".repeat(64));
    expect(result.copiedHash).toBeNull();
    expect(result.error).toContain("Clipboard access was unavailable.");
  });
});

describe("guarded download readiness and integrity", () => {
  it("permits only the exact approved or exported saved revision", () => {
    const preview = makeExportPreview();
    expect(canDownloadExport(preview, 6, "APPROVED", false)).toBe(true);
    expect(canDownloadExport({ ...preview, shipmentStatus: "EXPORTED" }, 6, "EXPORTED", false)).toBe(true);
    expect(canDownloadExport(preview, 7, "APPROVED", false)).toBe(false);
    expect(canDownloadExport({ ...preview, approvedRevision: 5 }, 6, "APPROVED", false)).toBe(false);
  });

  it.each(["DRAFT", "IN_REVIEW", "NEEDS_REVIEW", "READY_FOR_APPROVAL", "FUTURE_STATUS"])("blocks an unapproved workspace status %s", (status) => {
    expect(canDownloadExport(makeExportPreview(), 6, status, false)).toBe(false);
  });

  it("blocks pending drafts, blocked previews and missing preview artifacts", () => {
    const preview = makeExportPreview();
    expect(canDownloadExport(preview, 6, "APPROVED", true)).toBe(false);
    for (const patch of [{ ready: false }, { allowed: false }, { blockers: ["unapproved_exceptions_present"] }, { headers: [] }, { rows: undefined }, { checksumSha256: undefined }, { fileName: undefined }, { shipmentStatus: "NEEDS_REVIEW" }]) {
      expect(canDownloadExport({ ...preview, ...patch }, 6, "APPROVED", false)).toBe(false);
    }
    expect(canDownloadExport(null, 6, "APPROVED", false)).toBe(false);
  });

  it("compares both the server header and the downloaded bytes' digest with the preview", () => {
    const preview = makeExportPreview();
    const metadata = { checksum: preview.checksumSha256!, profile: "demo-v1@1", fileName: preview.fileName, contentType: "text/csv; charset=utf-8" };
    expect(exportSnapshotMatches(preview, metadata, preview.checksumSha256!)).toBe(true);
    expect(exportSnapshotMatches(preview, metadata, "b".repeat(64))).toBe(false);
    expect(exportSnapshotMatches(preview, { ...metadata, checksum: "b".repeat(64) }, preview.checksumSha256!)).toBe(false);
    expect(exportSnapshotMatches(preview, { ...metadata, profile: "demo-v1@2" }, preview.checksumSha256!)).toBe(false);
    expect(exportSnapshotMatches(preview, { ...metadata, fileName: "different.csv" }, preview.checksumSha256!)).toBe(false);
    expect(exportSnapshotMatches(preview, { ...metadata, contentType: "application/json" }, preview.checksumSha256!)).toBe(false);
  });

  it("uses the most recent complete server receipt and never fabricates one", () => {
    const older = makeExportRecord();
    const newer = makeExportRecord({ id: "server-export-2", createdAt: "2026-11-07T18:05:00Z" });
    expect(latestServerExportRecord(older, newer)).toBe(newer);
    expect(latestServerExportRecord(newer, older)).toBe(newer);
    expect(latestServerExportRecord(older, null)).toBe(older);
    expect(latestServerExportRecord(null, newer)).toBe(newer);
    expect(latestServerExportRecord(null, null)).toBeNull();
  });
});
