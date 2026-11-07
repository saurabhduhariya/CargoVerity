import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import type { StorageAppUser } from "@/lib/documents/storage";
import { storeServerSideDocuments } from "@/lib/documents/upload-service";
import { createSamplePdf, sampleFixtures } from "../../../scripts/generate-sample-docs";

export type SampleScenario = "SHP-24811" | "SHP-24812" | "SHP-24813" | "SHP-24814" | "SHP-24815";

/**
 * Loads synthetic demo documents into an existing authorized shipment (Week 2 Step 5.7).
 * Fixtures go through the same private storage, byte validation, versioning, revision bump and
 * audit path as browser uploads, and the whole load is one shipment revision.
 */
export async function loadSampleDocumentsIntoShipment(
  prisma: PrismaClient,
  params: {
    shipmentId: string;
    appUser: StorageAppUser;
    scenario?: SampleScenario;
    expectedRevision?: number;
  },
) {
  const { shipmentId, appUser, scenario = "SHP-24811" } = params;

  const scenarioFixtures = sampleFixtures.filter((f) => f.config.reference === scenario);
  if (scenarioFixtures.length === 0) {
    throw new Error(`Unknown sample scenario "${scenario}".`);
  }

  const publicDir = join(process.cwd(), "public", "sample-docs");
  const files = await Promise.all(
    scenarioFixtures.map(async (fixture) => {
      const diskPath = join(publicDir, fixture.fileName);
      const bytes = existsSync(diskPath)
        ? new Uint8Array(await readFile(diskPath))
        : await createSamplePdf(fixture.config);
      return { documentType: fixture.config.docType, displayFileName: fixture.fileName, bytes };
    }),
  );

  const result = await storeServerSideDocuments(prisma, {
    shipmentId,
    appUser,
    expectedRevision: params.expectedRevision,
    files,
    extraAudit: {
      action: "SAMPLE_DOCUMENTS_LOADED",
      metadata: { scenario, synthetic: true },
    },
  });

  const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  return { shipment, documents: result.documents, skipped: result.skipped };
}
