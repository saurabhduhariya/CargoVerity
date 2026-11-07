import "dotenv/config";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { getAuthorizedDocumentDownloadUrl } from "@/lib/documents/storage";
import { listDocumentVersions } from "@/lib/documents/service";
import { loadSampleDocumentsIntoShipment } from "@/lib/documents/sample-loader";
import { completeDocumentUpload, issueUploadCapability } from "@/lib/documents/upload-service";

/**
 * Week 2 end-to-end service tests against the real PostgreSQL database and the real private
 * Supabase Storage bucket. Every shipment, document row and storage object is synthetic and is
 * removed in afterAll.
 */

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "shipment-documents";
const enabled =
  process.env.RUN_INTEGRATION_TESTS === "1" &&
  Boolean(connectionString && supabaseUrl && publishableKey && secretKey);

const pdf = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "public", "sample-docs", name)));

describe.skipIf(!enabled)("Week 2 private upload flow (PostgreSQL + Supabase Storage)", { timeout: 60_000 }, () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const admin = createClient(supabaseUrl!, secretKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const anonymous = createClient(supabaseUrl!, publishableKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const deps = { supabaseAdmin: admin, bucket };

  const tag = randomUUID().slice(0, 8).toUpperCase();
  const owner = { id: randomUUID(), role: "EXECUTIVE" as const };
  const otherExecutive = { id: randomUUID(), role: "EXECUTIVE" as const };
  const manager = { id: randomUUID(), role: "MANAGER" as const };
  const shipmentIds: string[] = [];

  async function newShipment(createdById: string) {
    const shipment = await prisma.shipment.create({
      data: { reference: `IT-W2-${tag}-${shipmentIds.length}`, createdById },
    });
    shipmentIds.push(shipment.id);
    return shipment;
  }

  async function revisionOf(shipmentId: string) {
    return (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).currentRevision;
  }

  /** Browser-equivalent upload: a plain PUT of the raw bytes to the signed URL. */
  async function putToSignedUrl(url: string, bytes: Uint8Array, contentType: string) {
    return fetch(url, {
      method: "PUT",
      headers: { "content-type": contentType, "x-upsert": "false" },
      body: bytes as BodyInit,
    });
  }

  async function uploadAndComplete(
    shipmentId: string,
    bytes: Uint8Array,
    options: { allowReplacement?: boolean; user?: typeof owner; fileName?: string } = {},
  ) {
    const user = options.user ?? owner;
    const expectedRevision = await revisionOf(shipmentId);
    const capability = await issueUploadCapability(prisma, {
      ...deps,
      shipmentId,
      appUser: user,
      body: { documentType: "INVOICE", declaredMimeType: "application/pdf", fileSizeBytes: bytes.byteLength, expectedRevision, fileName: options.fileName ?? "invoice.pdf" },
    });
    const put = await putToSignedUrl(capability.signedUploadUrl, bytes, "application/pdf");
    expect(put.status, await put.clone().text()).toBe(200);

    const body = {
      documentId: capability.documentId,
      storageKey: capability.storageKey,
      documentType: "INVOICE",
      originalFileName: options.fileName ?? "invoice.pdf",
      declaredMimeType: "application/pdf",
      expectedRevision,
      allowReplacement: options.allowReplacement ?? false,
    };
    return { capability, body, complete: () => completeDocumentUpload(prisma, { ...deps, shipmentId, appUser: user, body }) };
  }

  async function objectExists(key: string) {
    const { data } = await admin.storage.from(bucket).download(key);
    return Boolean(data);
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [owner, otherExecutive, manager].map((u) => ({ id: u.id, email: `${u.id}@example.test`, role: u.role })),
    });
  });

  afterAll(async () => {
    try {
      for (const shipmentId of shipmentIds) {
        const documents = await prisma.document.findMany({ where: { shipmentId }, select: { storageKey: true } });
        const listed = await admin.storage.from(bucket).list(`shipments/${shipmentId}/documents`, { limit: 1000 });
        const keys = new Set(documents.map((d) => d.storageKey));
        for (const folder of listed.data ?? []) {
          const files = await admin.storage.from(bucket).list(`shipments/${shipmentId}/documents/${folder.name}`);
          for (const file of files.data ?? []) keys.add(`shipments/${shipmentId}/documents/${folder.name}/${file.name}`);
        }
        if (keys.size > 0) await admin.storage.from(bucket).remove([...keys]);
      }
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, otherExecutive.id, manager.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("uploads directly to private storage, validates server-side and records version 1", async () => {
    const shipment = await newShipment(owner.id);
    const { capability, complete } = await uploadAndComplete(shipment.id, pdf("shp-24811-invoice.pdf"), {
      fileName: "Acme Confidential Invoice.pdf",
    });

    const result = await complete();

    expect(result.status).toBe(201);
    expect(result.document).toMatchObject({ documentVersion: 1, isCurrent: true, mimeType: "application/pdf" });
    expect(result.document.pageCount).toBeGreaterThanOrEqual(1);
    expect(capability.storageKey.toLowerCase()).not.toContain("acme");
    expect(await revisionOf(shipment.id)).toBe(2);
    expect(await objectExists(capability.storageKey)).toBe(true);

    const audit = await prisma.auditEvent.findMany({ where: { shipmentId: shipment.id, action: "DOCUMENT_UPLOADED" } });
    expect(audit).toHaveLength(1);

    // Completing the same upload again is an idempotent replay.
    const replay = await completeDocumentUpload(prisma, {
      ...deps,
      shipmentId: shipment.id,
      appUser: owner,
      body: { ...(await prisma.document.findUniqueOrThrow({ where: { id: result.document.id } })), documentId: result.document.id, documentType: "INVOICE", declaredMimeType: "application/pdf", expectedRevision: 1 },
    });
    expect(replay).toMatchObject({ status: 200, replayed: true });
    expect(await revisionOf(shipment.id)).toBe(2);
  });

  it("replaces a document as version 2 and keeps version 1 and its object as history", async () => {
    const shipment = await newShipment(owner.id);
    const first = await uploadAndComplete(shipment.id, pdf("shp-24811-invoice.pdf"));
    await first.complete();

    const unconfirmed = await uploadAndComplete(shipment.id, pdf("shp-24812-invoice.pdf"));
    await expect(unconfirmed.complete()).rejects.toMatchObject({ code: "REPLACEMENT_REQUIRED" });
    expect(await objectExists(unconfirmed.capability.storageKey)).toBe(false);

    const identical = await uploadAndComplete(shipment.id, pdf("shp-24811-invoice.pdf"), { allowReplacement: true });
    await expect(identical.complete()).rejects.toMatchObject({ code: "DUPLICATE_CONTENT" });

    const second = await uploadAndComplete(shipment.id, pdf("shp-24812-invoice.pdf"), { allowReplacement: true });
    const result = await second.complete();

    expect(result.document.documentVersion).toBe(2);
    const versions = await listDocumentVersions(prisma, shipment.id, "INVOICE");
    expect(versions.map((v) => [v.documentVersion, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(await objectExists(first.capability.storageKey)).toBe(true);
    expect(await revisionOf(shipment.id)).toBe(3);
    expect(
      await prisma.auditEvent.count({ where: { shipmentId: shipment.id, action: "DOCUMENT_REPLACED" } }),
    ).toBe(1);
  });

  it("rejects fake PDFs server-side and removes the stored object", async () => {
    const shipment = await newShipment(owner.id);
    const fake = new TextEncoder().encode("This is plain text pretending to be a PDF.");
    const { capability, complete } = await uploadAndComplete(shipment.id, fake);

    await expect(complete()).rejects.toMatchObject({ code: "INVALID_MAGIC_BYTES", status: 415 });
    expect(await objectExists(capability.storageKey)).toBe(false);
    expect(await prisma.document.count({ where: { shipmentId: shipment.id } })).toBe(0);
    expect(await revisionOf(shipment.id)).toBe(1);
  });

  it("refuses to attach another shipment's object, and leaves that object intact", async () => {
    const victim = await newShipment(otherExecutive.id);
    const victimUpload = await uploadAndComplete(victim.id, pdf("shp-24813-invoice.pdf"), { user: otherExecutive });
    await victimUpload.complete();

    const attackerShipment = await newShipment(owner.id);
    await expect(
      completeDocumentUpload(prisma, {
        ...deps,
        shipmentId: attackerShipment.id,
        appUser: owner,
        body: {
          documentId: victimUpload.capability.documentId,
          storageKey: victimUpload.capability.storageKey,
          documentType: "INVOICE",
          originalFileName: "stolen.pdf",
          declaredMimeType: "application/pdf",
          expectedRevision: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_STORAGE_KEY" });

    // The owner also cannot request an upload into the other executive's shipment.
    await expect(
      issueUploadCapability(prisma, {
        ...deps,
        shipmentId: victim.id,
        appUser: owner,
        body: { documentType: "INVOICE", declaredMimeType: "application/pdf", expectedRevision: 2 },
      }),
    ).rejects.toThrow(/not found or inaccessible/);

    expect(await objectExists(victimUpload.capability.storageKey)).toBe(true);
    expect(await prisma.document.count({ where: { shipmentId: attackerShipment.id } })).toBe(0);
  });

  it("lets exactly one of two concurrent completions win and cleans up the loser", async () => {
    const shipment = await newShipment(owner.id);
    const a = await uploadAndComplete(shipment.id, pdf("shp-24811-invoice.pdf"));
    const b = await uploadAndComplete(shipment.id, pdf("shp-24812-invoice.pdf"));

    const outcomes = await Promise.allSettled([a.complete(), b.complete()]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(["STALE_REVISION", "REPLACEMENT_REQUIRED"]).toContain(rejected[0].reason.code);
    expect(await prisma.document.count({ where: { shipmentId: shipment.id, isCurrent: true } })).toBe(1);
    expect(await revisionOf(shipment.id)).toBe(2);

    const loserKey = outcomes[0].status === "rejected" ? a.capability.storageKey : b.capability.storageKey;
    expect(await objectExists(loserKey)).toBe(false);
  });

  it("enforces the bucket's MIME and size limits at the Storage layer", async () => {
    const shipment = await newShipment(owner.id);
    const capability = await issueUploadCapability(prisma, {
      ...deps,
      shipmentId: shipment.id,
      appUser: owner,
      body: { documentType: "INVOICE", declaredMimeType: "application/pdf", expectedRevision: 1 },
    });

    const html = await putToSignedUrl(capability.signedUploadUrl, new TextEncoder().encode("<script>x</script>"), "text/html");
    expect(html.status).toBeGreaterThanOrEqual(400);

    const oversized = new Uint8Array(10_485_760 + 1024);
    oversized.set(new TextEncoder().encode("%PDF-1.4\n"));
    const big = await putToSignedUrl(capability.signedUploadUrl, oversized, "application/pdf");
    expect(big.status).toBeGreaterThanOrEqual(400);

    expect(await objectExists(capability.storageKey)).toBe(false);
  });

  it("serves files only through authorized short-lived signed URLs", async () => {
    const shipment = await newShipment(owner.id);
    const upload = await uploadAndComplete(shipment.id, pdf("shp-24811-packing-list.pdf"));
    const { document } = await upload.complete();

    const ownerUrl = await getAuthorizedDocumentDownloadUrl(prisma, { ...deps, documentId: document.id, appUser: owner });
    expect(ownerUrl).not.toBeNull();
    const download = await fetch(ownerUrl!.signedUrl);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const managerUrl = await getAuthorizedDocumentDownloadUrl(prisma, { ...deps, documentId: document.id, appUser: manager });
    expect(managerUrl).not.toBeNull();

    // Another Executive gets nothing: authorization happens before any URL is signed.
    expect(
      await getAuthorizedDocumentDownloadUrl(prisma, { ...deps, documentId: document.id, appUser: otherExecutive }),
    ).toBeNull();

    // Logged-out / anonymous access to the object fails both through the public URL and the API.
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${upload.capability.storageKey}`;
    expect((await fetch(publicUrl)).status).toBeGreaterThanOrEqual(400);
    const anon = await anonymous.storage.from(bucket).download(upload.capability.storageKey);
    expect(anon.data).toBeNull();
    expect(anon.error).not.toBeNull();
  });

  it("loads a synthetic scenario through the same storage and validation path in one revision", async () => {
    const shipment = await newShipment(owner.id);

    const loaded = await loadSampleDocumentsIntoShipment(prisma, {
      shipmentId: shipment.id,
      appUser: owner,
      scenario: "SHP-24811",
      expectedRevision: 1,
    });

    expect(loaded.documents).toHaveLength(3);
    expect(loaded.shipment.currentRevision).toBe(2);
    for (const document of loaded.documents) {
      expect(await objectExists(document.storageKey)).toBe(true);
      expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    await expect(
      loadSampleDocumentsIntoShipment(prisma, { shipmentId: shipment.id, appUser: owner, scenario: "SHP-24811" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_CONTENT" });
    expect(await revisionOf(shipment.id)).toBe(2);
  });
});
