-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DrawingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawingId" TEXT NOT NULL,
    "userId" TEXT,
    "version" INTEGER NOT NULL,
    "elements" TEXT NOT NULL,
    "appState" TEXT NOT NULL,
    "files" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrawingSnapshot_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrawingSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DrawingSnapshot" ("appState", "createdAt", "drawingId", "elements", "files", "id", "version") SELECT "appState", "createdAt", "drawingId", "elements", "files", "id", "version" FROM "DrawingSnapshot";
DROP TABLE "DrawingSnapshot";
ALTER TABLE "new_DrawingSnapshot" RENAME TO "DrawingSnapshot";
CREATE INDEX "DrawingSnapshot_drawingId_createdAt_idx" ON "DrawingSnapshot"("drawingId", "createdAt");
CREATE INDEX "DrawingSnapshot_createdAt_idx" ON "DrawingSnapshot"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
