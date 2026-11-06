-- AlterTable ExtractionRun
ALTER TABLE "ExtractionRun" ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ExtractionRun" ADD COLUMN "requestedById" UUID;
ALTER TABLE "ExtractionRun" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "ExtractionRun" ADD COLUMN "retryOfRunId" UUID;
ALTER TABLE "ExtractionRun" ADD COLUMN "inputSizeBytes" INTEGER;
ALTER TABLE "ExtractionRun" ADD COLUMN "latencyMs" INTEGER;
ALTER TABLE "ExtractionRun" ADD COLUMN "rawResponse" JSONB;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ExtractionRun_idempotencyKey_key" ON "ExtractionRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ExtractionRun_documentId_documentVersion_idx" ON "ExtractionRun"("documentId", "documentVersion");
CREATE INDEX "ExtractionRun_requestedById_idx" ON "ExtractionRun"("requestedById");

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable ExtractedField
ALTER TABLE "ExtractedField" ADD COLUMN "reviewReason" TEXT;

-- AlterTable LineItem
ALTER TABLE "LineItem" ADD COLUMN "reviewReason" TEXT;

