import express from "express";
import { PrismaClient } from "../generated/client/client.js";
import {
  isS3Enabled,
  downloadObject,
} from "../s3.js";

const isValidFileId = (fileId: unknown): fileId is string =>
  typeof fileId === "string" && /^[\w-]{1,200}$/.test(fileId);

export type FileRouteDeps = {
  prisma: PrismaClient;
  requireAuth: express.RequestHandler;
  asyncHandler: <T = void>(
    fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<T>
  ) => express.RequestHandler;
};

export const registerFileRoutes = (
  app: express.Express,
  deps: FileRouteDeps
): void => {
  const { prisma, requireAuth, asyncHandler } = deps;

  app.get(
    "/files/config",
    requireAuth,
    asyncHandler(async (_req, res) => {
      return res.json({ s3Enabled: isS3Enabled() });
    })
  );

  app.get(
    "/files/:drawingId/:fileId",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!isS3Enabled()) {
        return res.status(501).json({ error: "S3 storage is not configured" });
      }

      const { drawingId, fileId } = req.params;
      if (!isValidFileId(drawingId) || !isValidFileId(fileId)) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const fileRecord = await prisma.s3File.findUnique({
        where: { drawingId_fileId: { drawingId, fileId } },
      });

      if (!fileRecord) {
        return res.status(404).json({ error: "File not found" });
      }

      const { body, contentType } = await downloadObject(fileRecord.s3Key);
      // An object stored without (or with a generic) Content-Type would reach
      // the client as application/octet-stream, which makes the re-inlined
      // data: URL undecodable as an image. The stored mimeType is authoritative.
      const isImageContentType = /^image\//i.test(contentType || "");
      const resolvedContentType =
        !isImageContentType && /^image\//i.test(fileRecord.mimeType || "")
          ? fileRecord.mimeType
          : contentType;
      if (resolvedContentType) {
        res.setHeader("Content-Type", resolvedContentType);
      }
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return body.pipe(res);
    })
  );
};
