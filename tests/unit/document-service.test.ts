import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createDocumentVersion,
  getCurrentDocument,
  listDocumentVersions,
} from "@/lib/documents/service";

const shipmentId = "11111111-1111-4111-8111-111111111111";

describe("document versioning service", () => {
  it("queries only the current version for a selected document slot", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "current-document" });
    const db = { document: { findFirst } } as unknown as Pick<PrismaClient, "document">;

    await expect(getCurrentDocument(db, shipmentId, "INVOICE")).resolves.toEqual({ id: "current-document" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { shipmentId, selectedDocType: "INVOICE", isCurrent: true },
      orderBy: { documentVersion: "desc" },
    });
  });

  it("lists historical versions newest first", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { document: { findMany } } as unknown as Pick<PrismaClient, "document">;

    await listDocumentVersions(db, shipmentId, "PACKING_LIST");
    expect(findMany).toHaveBeenCalledWith({
      where: { shipmentId, selectedDocType: "PACKING_LIST" },
      orderBy: [{ documentVersion: "desc" }, { createdAt: "desc" }],
    });
  });

  it("retires the current version and creates the next version atomically", async () => {
    const document = {
      findFirst: vi.fn().mockResolvedValue({ documentVersion: 3 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "new-document", documentVersion: 4 }),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: { document: typeof document }) => unknown) => callback({ document })),
    } as unknown as PrismaClient;

    await expect(createDocumentVersion(prisma, {
      shipmentId,
      selectedDocType: "BILL_OF_LADING",
      storageKey: `${shipmentId}/random-file`,
      originalFileName: "bill.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      sha256: "a".repeat(64),
      uploadedById: "22222222-2222-4222-8222-222222222222",
    })).resolves.toEqual({ id: "new-document", documentVersion: 4 });

    expect(document.updateMany).toHaveBeenCalledWith({
      where: { shipmentId, selectedDocType: "BILL_OF_LADING", isCurrent: true },
      data: { isCurrent: false },
    });
    expect(document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shipmentId,
        docType: "BILL_OF_LADING",
        selectedDocType: "BILL_OF_LADING",
        documentVersion: 4,
        isCurrent: true,
        sha256: "a".repeat(64),
      }),
    });
  });
});
