-- Week 6 Step 5: token counters (no content, no PII) used for the monthly AI budget.
ALTER TABLE "ExtractionRun" ADD COLUMN "promptTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "completionTokens" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ExtractionRun_createdAt_idx" ON "ExtractionRun"("createdAt");
