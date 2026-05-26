import express from "express";
import type { Server as SocketIOServer } from "socket.io";
import { PrismaClient } from "../generated/client/client.js";
import { isS3Enabled, deleteS3Object, listS3Objects } from "../s3.js";
import { logger } from "../utils/logger.js";

const FILE_KEY_PREFIX =
  process.env.S3_KEY_PREFIX?.replace(/\/+$/, "") || "images";

export type StorageRouteDeps = {
  prisma: PrismaClient;
  io: SocketIOServer;
  requireAuth: express.RequestHandler;
  asyncHandler: <T = void>(
    fn: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => Promise<T>
  ) => express.RequestHandler;
  parseJsonField: <T>(rawValue: string | null | undefined, fallback: T) => T;
  getAdminFullAccess: () => Promise<boolean>;
};

const collectReferencedFileIds = (
  elements: any[],
  includeDeleted: boolean
): Set<string> => {
  const ids = new Set<string>();
  for (const el of elements) {
    if (!includeDeleted && el.isDeleted) continue;
    if (el.type === "image" && typeof el.fileId === "string" && el.fileId) {
      ids.add(el.fileId);
    }
  }
  return ids;
};

const fileIdFromS3Key = (key: string): string | null => {
  const lastSegment = key.split("/").pop();
  if (!lastSegment) return null;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return lastSegment;
  return lastSegment.substring(0, dotIndex);
};

export const registerStorageRoutes = (
  app: express.Express,
  deps: StorageRouteDeps
): void => {
  const { prisma, io, requireAuth, asyncHandler, parseJsonField, getAdminFullAccess } = deps;

  const resolveAdminOverride = async (req: express.Request) => {
    if (!req.user || req.user.role !== "ADMIN") return false;
    return getAdminFullAccess();
  };

  app.post(
    "/drawings/:id/trim",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const adminOverride = await resolveAdminOverride(req);
      const id = req.params.id as string;
      const { confirmName } = req.body ?? {};

      const findWhere = adminOverride ? { id } : { id, userId };
      const drawing = await prisma.drawing.findFirst({
        where: findWhere,
      });
      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      if (typeof confirmName !== "string" || confirmName !== drawing.name) {
        return res
          .status(403)
          .json({ error: "confirmName does not match drawing name" });
      }

      const elements: any[] = parseJsonField(drawing.elements, []);
      const files: Record<string, any> = parseJsonField(drawing.files, {});

      const activeElements = elements.filter((el) => !el.isDeleted);
      const elementsRemoved = elements.length - activeElements.length;

      const survivingFileIds = collectReferencedFileIds(activeElements, false);

      const originalFileCount = Object.keys(files).length;
      const cleanedFiles: Record<string, any> = {};
      for (const [fileId, value] of Object.entries(files)) {
        if (survivingFileIds.has(fileId)) {
          cleanedFiles[fileId] = value;
        }
      }
      const filesRemoved = originalFileCount - Object.keys(cleanedFiles).length;

      let s3ObjectsDeleted = 0;
      let s3DeleteErrors = 0;

      if (isS3Enabled()) {
        const s3Prefix = `${FILE_KEY_PREFIX}/${drawing.userId}/${id}/`;

        const s3FileRecords = await prisma.s3File.findMany({
          where: { s3Key: { startsWith: s3Prefix } },
        });

        const s3Objects = await listS3Objects(s3Prefix);

        const orphanedKeys = new Set<string>();

        for (const record of s3FileRecords) {
          if (!survivingFileIds.has(record.fileId)) {
            orphanedKeys.add(record.s3Key);
          }
        }

        for (const obj of s3Objects) {
          const fileId = fileIdFromS3Key(obj.key);
          if (fileId && !survivingFileIds.has(fileId)) {
            orphanedKeys.add(obj.key);
          }
        }

        for (const key of orphanedKeys) {
          try {
            await deleteS3Object(key);
            s3ObjectsDeleted++;
          } catch (err) {
            logger.error({ err, s3Key: key }, "Failed to delete S3 object during trim");
            s3DeleteErrors++;
          }
        }

        const orphanedFileIds = s3FileRecords
          .filter((r) => !survivingFileIds.has(r.fileId))
          .map((r) => r.fileId);

        if (orphanedFileIds.length > 0) {
          await prisma.s3File.deleteMany({
            where: { drawingId: id, fileId: { in: orphanedFileIds } },
          });
        }
      }

      await prisma.drawing.update({
        where: { id },
        data: {
          elements: JSON.stringify(activeElements),
          files: JSON.stringify(cleanedFiles),
          version: { increment: 1 },
        },
      });

      io.to(`drawing_${id}`).emit("drawing-server-update", { drawingId: id });

      return res.json({
        trimmed: {
          elementsRemoved,
          filesRemoved,
          s3ObjectsDeleted,
          s3DeleteErrors,
        },
      });
    })
  );

  app.get(
    "/drawings/:id/files/diff",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const adminOverride = await resolveAdminOverride(req);
      const id = req.params.id as string;

      const findWhere = adminOverride ? { id } : { id, userId };
      const drawing = await prisma.drawing.findFirst({
        where: findWhere,
        include: { user: { select: { name: true } } },
      });
      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const elements: any[] = parseJsonField(drawing.elements, []);
      const files: Record<string, any> = parseJsonField(drawing.files, {});

      const allCanvasRefs = collectReferencedFileIds(elements, true);
      const activeCanvasRefs = collectReferencedFileIds(elements, false);

      const dbFileIds = new Set(Object.keys(files));

      const s3Prefix = `${FILE_KEY_PREFIX}/${drawing.userId}/${id}/`;
      let s3FileRecords: Array<{
        fileId: string;
        s3Key: string;
        mimeType: string;
      }> = [];
      let s3Objects: Array<{ key: string; size: number }> = [];

      if (isS3Enabled()) {
        s3FileRecords = await prisma.s3File.findMany({
          where: { drawingId: id },
          select: { fileId: true, s3Key: true, mimeType: true },
        });
        s3Objects = await listS3Objects(s3Prefix);
      }

      const s3RecordMap = new Map(
        s3FileRecords.map((r) => [r.fileId, r])
      );
      const s3ObjectMap = new Map(
        s3Objects.map((o) => {
          const fid = fileIdFromS3Key(o.key);
          return [fid, o] as const;
        })
      );

      const allFileIds = new Set<string>();
      for (const fid of allCanvasRefs) allFileIds.add(fid);
      for (const fid of dbFileIds) allFileIds.add(fid);
      for (const r of s3FileRecords) allFileIds.add(r.fileId);
      for (const o of s3Objects) {
        const fid = fileIdFromS3Key(o.key);
        if (fid) allFileIds.add(fid);
      }

      const filesList = Array.from(allFileIds).map((fileId) => {
        const s3Record = s3RecordMap.get(fileId);
        const s3Obj = s3ObjectMap.get(fileId);

        return {
          fileId,
          inCanvas: allCanvasRefs.has(fileId),
          inCanvasActive: activeCanvasRefs.has(fileId),
          inDb: dbFileIds.has(fileId),
          inS3: !!s3Obj,
          inS3Record: !!s3Record,
          s3Key: s3Record?.s3Key ?? s3Obj?.key ?? null,
          mimeType: s3Record?.mimeType ?? null,
          s3SizeBytes: s3Obj?.size ?? null,
        };
      });

      const elementsBytes = Buffer.byteLength(drawing.elements ?? "", "utf8");
      const appStateBytes = Buffer.byteLength(drawing.appState ?? "", "utf8");
      const filesBytes = Buffer.byteLength(drawing.files ?? "", "utf8");
      const previewBytes = drawing.preview
        ? Buffer.byteLength(drawing.preview, "utf8")
        : 0;
      const dbTotal = elementsBytes + appStateBytes + filesBytes + previewBytes;
      const s3Total = s3Objects.reduce((sum, o) => sum + o.size, 0);

      const snapshotRows = await prisma.drawingSnapshot.findMany({
        where: { drawingId: id },
        select: { elements: true, appState: true, files: true },
      });
      const snapshotCount = snapshotRows.length;
      const snapshotBytes = snapshotRows.reduce((sum, snap) => {
        return sum
          + Buffer.byteLength(snap.elements ?? "", "utf8")
          + Buffer.byteLength(snap.appState ?? "", "utf8")
          + Buffer.byteLength(snap.files ?? "", "utf8");
      }, 0);

      return res.json({
        ownerName: drawing.user.name,
        summary: {
          totalCanvasRefs: allCanvasRefs.size,
          totalDbFiles: dbFileIds.size,
          totalS3Files: s3Objects.length,
        },
        size: {
          elementsBytes,
          appStateBytes,
          filesBytes,
          previewBytes,
          dbTotal,
          s3Total,
          total: dbTotal + s3Total,
        },
        snapshots: {
          count: snapshotCount,
          totalBytes: snapshotBytes,
        },
        files: filesList,
      });
    })
  );

  app.delete(
    "/drawings/:id/snapshots",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const adminOverride = await resolveAdminOverride(req);
      const id = req.params.id as string;
      const { confirmName } = req.body ?? {};

      const findWhere = adminOverride ? { id } : { id, userId };
      const drawing = await prisma.drawing.findFirst({ where: findWhere });
      if (!drawing) return res.status(404).json({ error: "Drawing not found" });

      if (typeof confirmName !== "string" || confirmName !== drawing.name) {
        return res.status(403).json({ error: "confirmName does not match drawing name" });
      }

      const result = await prisma.drawingSnapshot.deleteMany({
        where: { drawingId: id },
      });

      return res.json({ deletedCount: result.count });
    })
  );

  app.delete(
    "/drawings/:id/files/orphans",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const adminOverride = await resolveAdminOverride(req);
      const id = req.params.id as string;
      const { confirmName, fileIds } = req.body ?? {};

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: "fileIds must be a non-empty array" });
      }

      const FILEID_PATTERN = /^[\w-]{1,200}$/;
      const invalidIds = (fileIds as unknown[]).filter(
        (fid) => typeof fid !== "string" || !FILEID_PATTERN.test(fid)
      );
      if (invalidIds.length > 0) {
        return res.status(400).json({ error: "Invalid fileId format", invalidIds });
      }

      const findWhere = adminOverride ? { id } : { id, userId };
      const drawing = await prisma.drawing.findFirst({
        where: findWhere,
      });
      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      if (typeof confirmName !== "string" || confirmName !== drawing.name) {
        return res
          .status(403)
          .json({ error: "confirmName does not match drawing name" });
      }

      const elements: any[] = parseJsonField(drawing.elements, []);
      const files: Record<string, any> = parseJsonField(drawing.files, {});

      const activeRefs = collectReferencedFileIds(elements, false);
      const blockedIds = (fileIds as string[]).filter((fid) =>
        activeRefs.has(fid)
      );
      if (blockedIds.length > 0) {
        return res.status(400).json({
          error: "Cannot delete files referenced by active elements",
          blockedFileIds: blockedIds,
        });
      }

      let deletedCount = 0;
      let errorCount = 0;

      const validFileIds = fileIds as string[];

      if (isS3Enabled()) {
        const s3Records = await prisma.s3File.findMany({
          where: { drawingId: id, fileId: { in: validFileIds } },
        });

        const S3_CONCURRENCY = 8;
        for (let i = 0; i < s3Records.length; i += S3_CONCURRENCY) {
          const batch = s3Records.slice(i, i + S3_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((r) => deleteS3Object(r.s3Key))
          );
          for (const [idx, result] of results.entries()) {
            if (result.status === "rejected") {
              logger.error(
                { err: result.reason, s3Key: batch[idx].s3Key },
                "Failed to delete orphan S3 object"
              );
              errorCount++;
            }
          }
        }

        if (s3Records.length > 0) {
          await prisma.s3File.deleteMany({
            where: { drawingId: id, fileId: { in: s3Records.map((r) => r.fileId) } },
          });
        }
      }

      for (const fileId of validFileIds) {
        delete files[fileId];
        deletedCount++;
      }

      const deletedFileIdSet = new Set(fileIds as string[]);
      const cleanedElements = elements.filter((el: any) => {
        if (
          el.isDeleted &&
          el.type === "image" &&
          typeof el.fileId === "string" &&
          deletedFileIdSet.has(el.fileId)
        ) {
          return false;
        }
        return true;
      });

      await prisma.drawing.update({
        where: { id },
        data: {
          files: JSON.stringify(files),
          elements: JSON.stringify(cleanedElements),
          version: { increment: 1 },
        },
      });

      io.to(`drawing_${id}`).emit("drawing-server-update", { drawingId: id });

      return res.json({ deleted: deletedCount, errors: errorCount });
    })
  );
};
