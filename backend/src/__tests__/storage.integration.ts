import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerStorageRoutes } from "../routes/storage.js";

vi.mock("../s3.js", () => ({
  isS3Enabled: vi.fn(() => false),
  deleteS3Object: vi.fn(),
  listS3Objects: vi.fn().mockResolvedValue([]),
}));

const OWNER_ID = "owner-1";
const OTHER_USER_ID = "user-2";
const DRAWING_ID = "drawing-1";

const makeDrawing = (overrides: Record<string, any> = {}) => ({
  id: DRAWING_ID,
  name: "My Drawing",
  userId: OWNER_ID,
  version: 5,
  elements: JSON.stringify([
    { id: "el-1", type: "image", fileId: "file-active", isDeleted: false },
    { id: "el-2", type: "image", fileId: "file-orphan", isDeleted: true },
    { id: "el-3", type: "rectangle", isDeleted: false },
  ]),
  files: JSON.stringify({
    "file-active": { id: "file-active", mimeType: "image/png", dataURL: "data:image/png;base64,abc" },
    "file-orphan": { id: "file-orphan", mimeType: "image/png", dataURL: "data:image/png;base64,def" },
    "file-stale": { id: "file-stale", mimeType: "image/png", dataURL: "data:image/png;base64,ghi" },
  }),
  appState: JSON.stringify({ viewBackgroundColor: "#ffffff" }),
  preview: null,
  user: { name: "Owner" },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function buildApp(options?: { userId?: string; role?: string; adminFullAccess?: boolean }) {
  const userId = options?.userId ?? OWNER_ID;
  const role = options?.role ?? "USER";
  const adminFullAccess = options?.adminFullAccess ?? false;

  const mockIo = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as any;

  const prisma = {
    drawing: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    drawingSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    s3File: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as any;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: userId, role, email: `${userId}@test.local`, name: "Test" };
    next();
  });

  registerStorageRoutes(app, {
    prisma,
    io: mockIo,
    requireAuth: (_req: any, _res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
      Promise.resolve(fn(req, res, next)).catch(next),
    parseJsonField: (val: string | null | undefined, fallback: any) => {
      try { return JSON.parse(val!); } catch { return fallback; }
    },
    getAdminFullAccess: vi.fn().mockResolvedValue(adminFullAccess),
  });

  return { app, prisma, mockIo };
}

describe("Storage routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /drawings/:id/trim", () => {
    it("returns 404 for non-owner", async () => {
      const { app, prisma } = buildApp({ userId: OTHER_USER_ID });
      prisma.drawing.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post(`/drawings/${DRAWING_ID}/trim`)
        .send({ confirmName: "My Drawing" });

      expect(res.status).toBe(404);
    });

    it("returns 403 when confirmName does not match", async () => {
      const { app, prisma } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      const res = await request(app)
        .post(`/drawings/${DRAWING_ID}/trim`)
        .send({ confirmName: "Wrong Name" });

      expect(res.status).toBe(403);
    });

    it("trims deleted elements and increments version", async () => {
      const { app, prisma } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      const res = await request(app)
        .post(`/drawings/${DRAWING_ID}/trim`)
        .send({ confirmName: "My Drawing" });

      expect(res.status).toBe(200);
      expect(res.body.trimmed.elementsRemoved).toBe(1);
      expect(res.body.trimmed.filesRemoved).toBe(2);

      const updateCall = prisma.drawing.update.mock.calls[0][0];
      expect(updateCall.data.version).toEqual({ increment: 1 });

      const savedElements = JSON.parse(updateCall.data.elements);
      expect(savedElements).toHaveLength(2);
      expect(savedElements.every((el: any) => !el.isDeleted)).toBe(true);
    });

    it("emits drawing-server-update socket event", async () => {
      const { app, prisma, mockIo } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      await request(app)
        .post(`/drawings/${DRAWING_ID}/trim`)
        .send({ confirmName: "My Drawing" });

      expect(mockIo.to).toHaveBeenCalledWith(`drawing_${DRAWING_ID}`);
      expect(mockIo.to.mock.results[0].value.emit).toHaveBeenCalledWith(
        "drawing-server-update",
        { drawingId: DRAWING_ID }
      );
    });
  });

  describe("DELETE /drawings/:id/files/orphans", () => {
    it("returns 400 for empty fileIds", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty/);
    });

    it("returns 400 for invalid fileId format", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: ["../../../etc/passwd", "valid-id"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid fileId/);
      expect(res.body.invalidIds).toContain("../../../etc/passwd");
    });

    it("returns 400 for non-string fileId entries", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: [123, null, "valid-id"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid fileId/);
    });

    it("refuses to delete files referenced by active elements", async () => {
      const { app, prisma } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      const res = await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: ["file-active"] });

      expect(res.status).toBe(400);
      expect(res.body.blockedFileIds).toContain("file-active");
    });

    it("deletes orphan files and increments version", async () => {
      const { app, prisma } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      const res = await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: ["file-orphan", "file-stale"] });

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);

      const updateCall = prisma.drawing.update.mock.calls[0][0];
      expect(updateCall.data.version).toEqual({ increment: 1 });

      const savedFiles = JSON.parse(updateCall.data.files);
      expect(savedFiles).not.toHaveProperty("file-orphan");
      expect(savedFiles).not.toHaveProperty("file-stale");
      expect(savedFiles).toHaveProperty("file-active");
    });

    it("strips deleted elements referencing deleted fileIds", async () => {
      const { app, prisma } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: ["file-orphan"] });

      const updateCall = prisma.drawing.update.mock.calls[0][0];
      const savedElements = JSON.parse(updateCall.data.elements);
      expect(savedElements.find((el: any) => el.fileId === "file-orphan")).toBeUndefined();
    });

    it("emits drawing-server-update socket event", async () => {
      const { app, prisma, mockIo } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: ["file-orphan"] });

      expect(mockIo.to).toHaveBeenCalledWith(`drawing_${DRAWING_ID}`);
      expect(mockIo.to.mock.results[0].value.emit).toHaveBeenCalledWith(
        "drawing-server-update",
        { drawingId: DRAWING_ID }
      );
    });

    it("returns 404 for non-owner", async () => {
      const { app, prisma } = buildApp({ userId: OTHER_USER_ID });
      prisma.drawing.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/drawings/${DRAWING_ID}/files/orphans`)
        .send({ confirmName: "My Drawing", fileIds: ["file-orphan"] });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /drawings/:id/files/diff", () => {
    it("returns three-way diff summary", async () => {
      const { app, prisma } = buildApp();
      prisma.drawing.findFirst.mockResolvedValue(makeDrawing());

      const res = await request(app).get(`/drawings/${DRAWING_ID}/files/diff`);

      expect(res.status).toBe(200);
      expect(res.body.ownerName).toBe("Owner");
      expect(res.body.summary.totalCanvasRefs).toBe(2);
      expect(res.body.summary.totalDbFiles).toBe(3);
      expect(res.body.files).toBeInstanceOf(Array);
      expect(res.body.files.length).toBeGreaterThan(0);
    });

    it("returns 404 for non-owner", async () => {
      const { app, prisma } = buildApp({ userId: OTHER_USER_ID });
      prisma.drawing.findFirst.mockResolvedValue(null);

      const res = await request(app).get(`/drawings/${DRAWING_ID}/files/diff`);

      expect(res.status).toBe(404);
    });
  });
});
