-- Add delta snapshot support columns
ALTER TABLE "DrawingSnapshot" ADD COLUMN "snapshotType" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "DrawingSnapshot" ADD COLUMN "baseSnapshotId" TEXT;
ALTER TABLE "DrawingSnapshot" ADD COLUMN "delta" TEXT;
