-- AlterTable
ALTER TABLE "Drawing" ADD COLUMN "trashedAt" DATETIME;

-- Backfill: give existing trashed drawings a fresh 30-day window
UPDATE "Drawing" SET "trashedAt" = CURRENT_TIMESTAMP WHERE "collectionId" LIKE 'trash:%';

-- CreateIndex
CREATE INDEX "Drawing_trashedAt_idx" ON "Drawing"("trashedAt");
