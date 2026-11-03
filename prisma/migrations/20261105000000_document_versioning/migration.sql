-- Rename the original document metadata to the names used by the versioned model.
ALTER TABLE "Document" RENAME COLUMN "type" TO "docType";
ALTER TABLE "Document" RENAME COLUMN "fileName" TO "originalFileName";
ALTER TABLE "Document" RENAME COLUMN "storagePath" TO "storageKey";
ALTER TABLE "Document" RENAME COLUMN "fileSize" TO "sizeBytes";
ALTER TABLE "Document" RENAME COLUMN "status" TO "extractionStatus";
ALTER INDEX "Document_status_idx" RENAME TO "Document_extractionStatus_idx";

-- Add the selected slot first as nullable so existing rows can be backfilled safely.
ALTER TABLE "Document" ADD COLUMN "selectedDocType" "DocumentType";
UPDATE "Document" SET "selectedDocType" = "docType" WHERE "selectedDocType" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "selectedDocType" SET NOT NULL;

ALTER TABLE "Document" ADD COLUMN "detectedDocType" "DocumentType";
ALTER TABLE "Document" ADD COLUMN "typeMismatch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Document" ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Document" ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Document" ADD COLUMN "sha256" TEXT;

-- Preserve the newest existing upload as the current version for each shipment slot.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "shipmentId", "selectedDocType"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS version_number
  FROM "Document"
)
UPDATE "Document" AS document
SET
  "documentVersion" = ranked.version_number,
  "isCurrent" = ranked.version_number = 1
FROM ranked
WHERE document."id" = ranked."id";

-- Only one source version may be current for a shipment/document slot.
CREATE UNIQUE INDEX "Document_one_current_per_type_key"
  ON "Document" ("shipmentId", "selectedDocType")
  WHERE "isCurrent" = true;

CREATE INDEX "Document_shipmentId_selectedDocType_documentVersion_idx"
  ON "Document" ("shipmentId", "selectedDocType", "documentVersion");

-- Page-level readability and manual-entry state belongs to the exact source version.
CREATE TABLE "DocumentPage" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "isReadable" BOOLEAN NOT NULL DEFAULT true,
    "manualEntryRequired" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key"
  ON "DocumentPage" ("documentId", "pageNumber");
CREATE INDEX "DocumentPage_documentId_idx" ON "DocumentPage" ("documentId");

ALTER TABLE "DocumentPage"
  ADD CONSTRAINT "DocumentPage_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
