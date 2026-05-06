-- Migrate S3File from single id PK to composite (drawingId, fileId) PK.
-- Extracts drawingId from s3Key (format: prefix/userId/drawingId/fileId.ext).

CREATE TABLE "S3File_new" (
    "drawingId" TEXT NOT NULL,
    "fileId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "s3Key"     TEXT NOT NULL,
    "mimeType"  TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("drawingId", "fileId")
);

-- Extract drawingId as the 3rd path segment of s3Key
INSERT INTO "S3File_new" ("drawingId", "fileId", "userId", "s3Key", "mimeType", "createdAt")
SELECT
  SUBSTR(
    SUBSTR("s3Key", INSTR(SUBSTR("s3Key", INSTR("s3Key", '/') + 1), '/') + INSTR("s3Key", '/') + 1),
    1,
    INSTR(SUBSTR("s3Key", INSTR(SUBSTR("s3Key", INSTR("s3Key", '/') + 1), '/') + INSTR("s3Key", '/') + 1), '/') - 1
  ),
  "id",
  "userId",
  "s3Key",
  "mimeType",
  "createdAt"
FROM "S3File"
WHERE INSTR(SUBSTR("s3Key", INSTR(SUBSTR("s3Key", INSTR("s3Key", '/') + 1), '/') + INSTR("s3Key", '/') + 1), '/') > 0;

DROP TABLE "S3File";
ALTER TABLE "S3File_new" RENAME TO "S3File";
CREATE INDEX "S3File_userId_idx" ON "S3File"("userId");
