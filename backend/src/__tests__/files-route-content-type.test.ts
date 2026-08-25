import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { registerFileRoutes } from "../routes/files.js";

vi.mock("../s3.js", () => ({
  isS3Enabled: vi.fn(() => true),
  downloadObject: vi.fn(),
}));

import { downloadObject } from "../s3.js";

const mockDownloadObject = downloadObject as ReturnType<typeof vi.fn>;

const DRAWING_ID = "drawing-1";
const FILE_ID = "file-1";
const PNG_BYTES = Buffer.from([137, 80, 78, 71]);

function buildApp(fileRecord: Record<string, any> | null) {
  const prisma = {
    s3File: { findUnique: vi.fn().mockResolvedValue(fileRecord) },
  } as any;

  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: "user-1", role: "USER" };
    next();
  });

  registerFileRoutes(app, {
    prisma,
    requireAuth: (_req: any, _res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
      Promise.resolve(fn(req, res, next)).catch(next),
  });

  return app;
}

const storedFile = { drawingId: DRAWING_ID, fileId: FILE_ID, s3Key: "k", mimeType: "image/png" };

describe("GET /files/:drawingId/:fileId content type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the content type reported by S3", async () => {
    mockDownloadObject.mockResolvedValue({
      body: Readable.from([PNG_BYTES]),
      contentType: "image/webp",
    });

    const res = await request(buildApp(storedFile)).get(`/files/${DRAWING_ID}/${FILE_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
  });

  it("falls back to the stored mime type when S3 reports none", async () => {
    // Without this the response has no Content-Type, the browser blob comes back
    // as application/octet-stream, and the re-inlined data: URL is undecodable.
    mockDownloadObject.mockResolvedValue({
      body: Readable.from([PNG_BYTES]),
      contentType: undefined,
    });

    const res = await request(buildApp(storedFile)).get(`/files/${DRAWING_ID}/${FILE_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("ignores a generic content type in favour of the stored image type", async () => {
    mockDownloadObject.mockResolvedValue({
      body: Readable.from([PNG_BYTES]),
      contentType: "application/octet-stream",
    });

    const res = await request(buildApp(storedFile)).get(`/files/${DRAWING_ID}/${FILE_ID}`);

    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("keeps the S3 content type when no mime type was stored", async () => {
    mockDownloadObject.mockResolvedValue({
      body: Readable.from([PNG_BYTES]),
      contentType: "application/octet-stream",
    });

    const res = await request(
      buildApp({ ...storedFile, mimeType: "" })
    ).get(`/files/${DRAWING_ID}/${FILE_ID}`);

    expect(res.headers["content-type"]).toContain("application/octet-stream");
  });
});
