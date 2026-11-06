-- CreateEnum
CREATE TYPE "CrossCheckSeverity" AS ENUM ('BLOCKING', 'WARNING');

-- CreateTable
CREATE TABLE "CrossCheckRun" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "triggeredBy" TEXT DEFAULT 'MANUAL',
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossCheckRun_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CrossCheckResult" ADD COLUMN "runId" UUID;
ALTER TABLE "CrossCheckResult" ADD COLUMN "ruleCode" TEXT;
ALTER TABLE "CrossCheckResult" ADD COLUMN "severity" "CrossCheckSeverity" NOT NULL DEFAULT 'BLOCKING';

-- CreateIndex
CREATE INDEX "CrossCheckRun_shipmentId_revision_createdAt_idx" ON "CrossCheckRun"("shipmentId", "revision", "createdAt");
CREATE INDEX "CrossCheckRun_shipmentId_inputHash_idx" ON "CrossCheckRun"("shipmentId", "inputHash");
CREATE INDEX "CrossCheckResult_runId_idx" ON "CrossCheckResult"("runId");

-- AddForeignKey
ALTER TABLE "CrossCheckRun" ADD CONSTRAINT "CrossCheckRun_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrossCheckRun" ADD CONSTRAINT "CrossCheckRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrossCheckResult" ADD CONSTRAINT "CrossCheckResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrossCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

