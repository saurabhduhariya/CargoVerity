-- Week 5 Step 4: the export record stores the profile version, file checksum, file name and row count.
-- Nullable so export events recorded before this change remain valid.

-- AlterTable
ALTER TABLE "ExportEvent" ADD COLUMN     "checksumSha256" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "profileVersion" TEXT,
ADD COLUMN     "rowCount" INTEGER;
