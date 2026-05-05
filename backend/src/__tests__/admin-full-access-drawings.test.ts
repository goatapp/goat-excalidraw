import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerDrawingRoutes } from "../routes/dashboard/drawings.js";

const ADMIN_USER_ID = "admin-1";
const OTHER_USER_ID = "user-2";
const DRAWING_ID = "drawing-1";

const mockDrawingOwnedByOther = {
  id: DRAWING_ID,
  name: "Other User Drawing",
  elements: JSON.stringify([{ id: "el-1", type: "rectangle" }]),
  appState: JSON.stringify({ viewBackgroundColor: "#ffffff" }),
  files: "{}",
  version: 3,
  userId: OTHER_USER_ID,
  collectionId: null,
  preview: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildApp(options?: { role?: "ADMIN" | "USER"; adminFullAccess?: boolean }) {
  const role = options?.role ?? "ADMIN";
  const adminFullAccess = options?.adminFullAccess ?? true;

  const prisma = {
    drawing: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    drawingSnapshot: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    drawingPermission: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    drawingLinkShare: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    collection: { findFirst: vi.fn() },
    collectionShare: { findUnique: vi.fn().mockResolvedValue(null) },
  } as any;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: ADMIN_USER_ID, role, email: "admin@test.local", name: "Admin" };
    next();
  });

  registerDrawingRoutes(app, {
    prisma,
    requireAuth: (_req: any, _res: any, next: any) => next(),
    optionalAuth: (_req: any, _res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
      Promise.resolve(fn(req, res, next)).catch(next),
    parseJsonField: (val: string | null | undefined, fallback: any) => {
      try { return JSON.parse(val!); } catch { return fallback; }
    },
    validateImportedDrawing: vi.fn().mockReturnValue(true),
    drawingCreateSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) } as any,
    drawingUpdateSchema: { safeParse: vi.fn() } as any,
    collectionNameSchema: { safeParse: vi.fn() } as any,
    sanitizeText: (input: unknown) => String(input ?? ""),
    respondWithValidationErrors: vi.fn(),
    ensureTrashCollection: vi.fn(),
    invalidateDrawingsCache: vi.fn(),
    buildDrawingsCacheKey: vi.fn(),
    getCachedDrawingsBody: vi.fn().mockReturnValue(null),
    cacheDrawingsResponse: vi.fn().mockImplementation((_key: string, payload: any) => Buffer.from(JSON.stringify(payload))),
    MAX_PAGE_SIZE: 100,
    config: { nodeEnv: "test", enableAuditLogging: false, snapshotKeyframeInterval: 10 },
    logAuditEvent: vi.fn(),
    getAdminFullAccess: vi.fn().mockResolvedValue(adminFullAccess),
    processFilesForS3: vi.fn().mockImplementation((files: any) => Promise.resolve(files)),
  });

  return { app, prisma };
}

describe("Admin full access – drawing routes", () => {
  let app: express.Express;
  let prisma: any;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /drawings (list)", () => {
    it("returns all drawings when admin full access is enabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: true }));
      prisma.drawing.findMany.mockResolvedValue([
        { id: DRAWING_ID, name: "Other User Drawing", collectionId: null, preview: null, version: 3, createdAt: new Date(), updatedAt: new Date(), _count: { comments: 0 } },
      ]);
      prisma.drawing.count.mockResolvedValue(1);

      const res = await request(app).get("/drawings");

      expect(res.status).toBe(200);
      expect(res.body.drawings).toHaveLength(1);
      const findManyCall = prisma.drawing.findMany.mock.calls[0][0];
      expect(findManyCall.where).not.toHaveProperty("userId");
    });

    it("only returns own drawings when admin full access is disabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: false }));
      prisma.drawing.findMany.mockResolvedValue([]);
      prisma.drawing.count.mockResolvedValue(0);

      const res = await request(app).get("/drawings");

      expect(res.status).toBe(200);
      const findManyCall = prisma.drawing.findMany.mock.calls[0][0];
      expect(findManyCall.where).toHaveProperty("userId", ADMIN_USER_ID);
    });

    it("regular user sees only own drawings even when toggle is on", async () => {
      ({ app, prisma } = buildApp({ role: "USER", adminFullAccess: true }));
      prisma.drawing.findMany.mockResolvedValue([]);
      prisma.drawing.count.mockResolvedValue(0);

      const res = await request(app).get("/drawings");

      expect(res.status).toBe(200);
      const findManyCall = prisma.drawing.findMany.mock.calls[0][0];
      expect(findManyCall.where).toHaveProperty("userId", ADMIN_USER_ID);
    });
  });

  describe("GET /drawings/:id", () => {
    it("admin can view another user's drawing when enabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: true }));
      prisma.drawing.findUnique.mockResolvedValue(mockDrawingOwnedByOther);

      const res = await request(app).get(`/drawings/${DRAWING_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.accessLevel).toBe("owner");
    });

    it("admin cannot view another user's drawing when disabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: false }));
      prisma.drawing.findUnique.mockResolvedValue(mockDrawingOwnedByOther);
      prisma.drawingPermission.findMany.mockResolvedValue([]);
      prisma.drawingLinkShare.findMany.mockResolvedValue([]);

      const res = await request(app).get(`/drawings/${DRAWING_ID}`);

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /drawings/:id", () => {
    it("admin can delete another user's drawing when enabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: true }));
      prisma.drawing.findFirst.mockResolvedValue(mockDrawingOwnedByOther);
      prisma.drawing.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app).delete(`/drawings/${DRAWING_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.drawing.findFirst).toHaveBeenCalledWith({
        where: { id: DRAWING_ID },
      });
    });

    it("admin cannot delete another user's drawing when disabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: false }));
      prisma.drawing.findFirst.mockResolvedValue(null);

      const res = await request(app).delete(`/drawings/${DRAWING_ID}`);

      expect(res.status).toBe(404);
      expect(prisma.drawing.findFirst).toHaveBeenCalledWith({
        where: { id: DRAWING_ID, userId: ADMIN_USER_ID },
      });
    });
  });

  describe("POST /drawings/:id/duplicate", () => {
    it("admin can duplicate another user's drawing when enabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: true }));
      prisma.drawing.findFirst.mockResolvedValue(mockDrawingOwnedByOther);
      prisma.drawing.create.mockResolvedValue({
        ...mockDrawingOwnedByOther,
        id: "drawing-copy",
        name: "Other User Drawing (Copy)",
        userId: ADMIN_USER_ID,
      });

      const res = await request(app).post(`/drawings/${DRAWING_ID}/duplicate`);

      expect(res.status).toBe(200);
      expect(prisma.drawing.findFirst).toHaveBeenCalledWith({
        where: { id: DRAWING_ID },
      });
      expect(prisma.drawing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: ADMIN_USER_ID }),
        })
      );
    });
  });

  describe("GET /drawings/:id/history", () => {
    it("admin can view history of another user's drawing when enabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: true }));
      prisma.drawing.findUnique.mockResolvedValue(mockDrawingOwnedByOther);
      prisma.drawing.findFirst.mockResolvedValue(mockDrawingOwnedByOther);
      prisma.drawingSnapshot.findMany.mockResolvedValue([
        { id: "snap-1", version: 2, createdAt: new Date() },
      ]);
      prisma.drawingSnapshot.count.mockResolvedValue(1);

      const res = await request(app).get(`/drawings/${DRAWING_ID}/history`);

      expect(res.status).toBe(200);
      expect(res.body.snapshots).toHaveLength(1);
    });
  });

  describe("Sharing management", () => {
    it("admin can manage sharing on another user's drawing when enabled", async () => {
      ({ app, prisma } = buildApp({ adminFullAccess: true }));
      prisma.drawing.findUnique.mockResolvedValue({
        userId: OTHER_USER_ID,
        collectionId: null,
      });
      prisma.drawingPermission.findMany.mockResolvedValue([]);
      prisma.drawingLinkShare.findMany.mockResolvedValue([]);

      const res = await request(app).get(`/drawings/${DRAWING_ID}/sharing`);

      expect(res.status).toBe(200);
    });
  });
});
