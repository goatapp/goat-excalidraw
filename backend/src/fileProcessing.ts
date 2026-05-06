import type { PrismaClient } from "./generated/client/client.js";
import { isS3Enabled, getS3Config, uploadBuffer, getPublicUrl, deleteS3Object, copyS3Object } from "./s3.js";
import { logger } from "./utils/logger.js";

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const S3_UPLOAD_CONCURRENCY = 8;

const FILE_KEY_PREFIX =
  process.env.S3_KEY_PREFIX?.replace(/\/+$/, "") || "images";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export const decodeDataURL = (
  dataURL: string,
): { buffer: Buffer; mimeType: string } | null => {
  const match = dataURL.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;

  const mimeType = match[1];
  const base64 = match[2];

  try {
    const buffer = Buffer.from(base64, "base64");
    return { buffer, mimeType };
  } catch {
    return null;
  }
};

const enforceFileSizeLimit = (
  files: Record<string, any>,
): Record<string, any> => {
  const result: Record<string, any> = {};
  for (const [fileId, file] of Object.entries(files)) {
    const dataURL: unknown = file?.dataURL;
    if (typeof dataURL !== "string" || !dataURL.startsWith("data:")) {
      result[fileId] = file;
      continue;
    }
    const decoded = decodeDataURL(dataURL);
    if (!decoded) {
      result[fileId] = file;
      continue;
    }
    if (decoded.buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn(
        { fileId, size: decoded.buffer.length, limit: MAX_FILE_SIZE_BYTES },
        "File exceeds maximum size, rejecting",
      );
      continue;
    }
    result[fileId] = file;
  }
  return result;
};

export const processFilesForS3 = async (
  files: Record<string, any>,
  userId: string,
  drawingId: string,
  prisma: Pick<PrismaClient, "s3File">,
): Promise<Record<string, any>> => {
  const filtered = enforceFileSizeLimit(files);
  if (!isS3Enabled()) {
    return filtered;
  }

  const cfg = getS3Config()!;
  const result: Record<string, any> = { ...filtered };

  const OLD_API_FILES_RE = /^\/api\/files\/[\w-]+$/;

  const entries = Object.entries(filtered);
  for (let i = 0; i < entries.length; i += S3_UPLOAD_CONCURRENCY) {
    const batch = entries.slice(i, i + S3_UPLOAD_CONCURRENCY);
    await Promise.all(
      batch.map(async ([fileId, file]) => {
        const dataURL: unknown = file?.dataURL;

        // Re-register files with legacy /api/files/{fileId} URLs (missing S3File record after migration)
        if (typeof dataURL === "string" && OLD_API_FILES_RE.test(dataURL) && !dataURL.includes(`/files/${drawingId}/`)) {
          const mimeType = typeof file?.mimeType === "string" ? file.mimeType : "application/octet-stream";
          const ext = MIME_TO_EXT[mimeType] ?? "bin";
          const s3Key = `${FILE_KEY_PREFIX}/${userId}/${drawingId}/${fileId}.${ext}`;
          const newUrl = cfg.publicUrl ? getPublicUrl(s3Key) : `/api/files/${drawingId}/${fileId}`;

          await prisma.s3File.upsert({
            where: { drawingId_fileId: { drawingId, fileId } },
            create: { drawingId, fileId, userId, s3Key, mimeType },
            update: { s3Key, mimeType },
          });

          result[fileId] = { ...file, dataURL: newUrl };
          return;
        }

        if (typeof dataURL !== "string" || !dataURL.startsWith("data:")) {
          return;
        }

        const decoded = decodeDataURL(dataURL);
        if (!decoded) return;

        const ext = MIME_TO_EXT[decoded.mimeType] ?? "bin";
        const s3Key = `${FILE_KEY_PREFIX}/${userId}/${drawingId}/${fileId}.${ext}`;

        await uploadBuffer(s3Key, decoded.buffer, decoded.mimeType);

        const accessUrl = cfg.publicUrl
          ? getPublicUrl(s3Key)
          : `/api/files/${drawingId}/${fileId}`;

        await prisma.s3File.upsert({
          where: { drawingId_fileId: { drawingId, fileId } },
          create: { drawingId, fileId, userId, s3Key, mimeType: decoded.mimeType },
          update: { s3Key, mimeType: decoded.mimeType },
        });

        result[fileId] = { ...file, dataURL: accessUrl };
      }),
    );
  }

  return result;
};

export const copyFilesForDuplicate = async (
  files: Record<string, any>,
  userId: string,
  sourceDrawingId: string,
  newDrawingId: string,
  prisma: Pick<PrismaClient, "s3File">,
): Promise<Record<string, any>> => {
  if (!isS3Enabled()) return files;

  const cfg = getS3Config()!;
  const result: Record<string, any> = { ...files };
  const copiedKeys: string[] = [];

  try {
    for (const [fileId, file] of Object.entries(files)) {
      const record = await prisma.s3File.findUnique({
        where: { drawingId_fileId: { drawingId: sourceDrawingId, fileId } },
      });
      if (!record) continue;

      const ext = record.s3Key.split(".").pop() ?? "bin";
      const newKey = `${FILE_KEY_PREFIX}/${userId}/${newDrawingId}/${fileId}.${ext}`;

      await copyS3Object(record.s3Key, newKey);
      copiedKeys.push(newKey);

      await prisma.s3File.create({
        data: { drawingId: newDrawingId, fileId, userId, s3Key: newKey, mimeType: record.mimeType },
      });

      const accessUrl = cfg.publicUrl ? getPublicUrl(newKey) : `/api/files/${newDrawingId}/${fileId}`;
      result[fileId] = { ...file, dataURL: accessUrl };
    }
  } catch (err) {
    logger.error({ err, newDrawingId }, "S3 copy failed during duplicate, rolling back");
    for (const key of copiedKeys) {
      try { await deleteS3Object(key); } catch {}
    }
    return files;
  }

  return result;
};

export const cleanupRemovedS3Files = async (
  previousFiles: Record<string, any>,
  currentFiles: Record<string, any>,
  drawingId: string,
  prisma: Pick<PrismaClient, "s3File">,
): Promise<void> => {
  if (!isS3Enabled()) return;

  const prevIds = new Set(Object.keys(previousFiles));
  const currIds = new Set(Object.keys(currentFiles));
  const removedIds = [...prevIds].filter((id) => !currIds.has(id));
  if (removedIds.length === 0) return;

  await Promise.all(
    removedIds.map(async (fileId) => {
      try {
        const record = await prisma.s3File.findUnique({
          where: { drawingId_fileId: { drawingId, fileId } },
        });
        if (!record) return;
        await deleteS3Object(record.s3Key);
        await prisma.s3File.delete({ where: { drawingId_fileId: { drawingId, fileId } } });
        logger.info({ fileId, s3Key: record.s3Key }, "Cleaned up removed S3 file");
      } catch (err) {
        logger.error({ err, fileId }, "Failed to clean up removed S3 file");
      }
    }),
  );
};
