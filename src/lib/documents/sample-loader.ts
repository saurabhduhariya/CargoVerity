import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

import { authorizeShipmentAccess, buildStorageKey, uploadDocumentBuffer, type StorageAppUser } from "@/lib/documents/storage";
import { createDocumentVersion } from "@/lib/documents/service";
import { validateStoredDocumentBuffer } from "@/lib/documents/validation";
import { createSamplePdf, sampleFixtures } from "../../../scripts/generate-sample-docs";

export type SampleScenario = "SHP-24811" | "SHP-24812" | "SHP-24813" | "SHP-24814" | "SHP-24815";

/**
 * Loads synthetic demo documents into an existing authorized shipment.
 * Exercises the identical private storage upload and server validation path
 * as normal browser uploads, as mandated by Week 2 Step 5.
 */
export async function loadSampleDocumentsIntoShipment(
  prisma: PrismaClient,
  params: {
    shipmentId: string;
    appUser: StorageAppUser;
    scenario?: SampleScenario;
  },
) {
  const { shipmentId, appUser, scenario = "SHP-24811" } = params;
  const shipment = await authorizeShipmentAccess(prisma, shipmentId, appUser);

  const scenarioFixtures = sampleFixtures.filter((f) => f.config.reference === scenario);
  if (scenarioFixtures.length === 0) {
    throw new Error(`Unknown sample scenario "${scenario}".`);
  }

  const createdDocuments = [];
  const publicDir = join(process.cwd(), "public", "sample-docs");

  for (const fixture of scenarioFixtures) {
    let pdfBytes: Uint8Array;
    const diskPath = join(publicDir, fixture.fileName);

    if (existsSync(diskPath)) {
      pdfBytes = await readFile(diskPath);
    } else {
      pdfBytes = await createSamplePdf(fixture.config);
    }

    // 1. Run real server validation on the synthetic file
    const inspection = await validateStoredDocumentBuffer(pdfBytes, "application/pdf");

    // 2. Generate random document UUID and safe storage key without customer filename
    const documentId = randomUUID();
    const storageKey = buildStorageKey({
      shipmentId: shipment.id,
      documentId,
      originalFileName: fixture.fileName,
      extension: "pdf",
    });

    // 3. Upload to private Supabase Storage bucket
    await uploadDocumentBuffer({
      storageKey,
      fileBuffer: pdfBytes,
      mimeType: "application/pdf",
    });

    // 4. Create document version record atomically
    const document = await createDocumentVersion(prisma, {
      id: documentId,
      shipmentId: shipment.id,
      selectedDocType: fixture.config.docType,
      storageKey,
      originalFileName: fixture.fileName,
      mimeType: inspection.mimeType,
      sizeBytes: inspection.sizeBytes,
      sha256: inspection.sha256,
      pageCount: inspection.pageCount,
      uploadedById: appUser.id,
    });

    createdDocuments.push(document);
  }

  // 5. Increment shipment revision, set IN_REVIEW, invalidate approvals
  const updatedShipment = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: "IN_REVIEW",
      currentRevision: { increment: 1 },
    },
  });

  // 6. Record audit event
  await prisma.auditEvent.create({
    data: {
      shipmentId: shipment.id,
      actorId: appUser.id,
      action: "SAMPLE_DOCUMENTS_LOADED",
      entityType: "Shipment",
      entityId: shipment.id,
      metadata: {
        scenario,
        documentCount: createdDocuments.length,
        revision: updatedShipment.currentRevision,
        documents: createdDocuments.map((d) => ({
          id: d.id,
          docType: d.docType,
          version: d.documentVersion,
        })),
      },
    },
  });

  return {
    shipment: updatedShipment,
    documents: createdDocuments,
  };
}

