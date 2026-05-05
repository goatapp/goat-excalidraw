import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerCollectionRoutes } from "../routes/dashboard/collections.js";

const ADMIN_USER_ID = "admin-1";
const OTHER_USER_ID = "user-2";
const COLLECTION_ID = "col-1";

const mockCollectionOwnedByOther = {
  id: COLLECTION_ID,
  name: "Other User Collection",
  userId: OTHER_USER_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildApp(options?: { role?: "ADMIN" | "USER"; adminFullAccess?: boolean }) {
  const role = options?.role ?? "ADMIN";
  const adminFullAccess = options?.adminFullAccess ?? true;

  const prisma = {
    collection: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    collectionShare: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    drawing: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (ops: any[]) => {
      for (const op of ops) await op;
    }),
  } as any;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: ADMIN_USER_ID, role, email: "admin@test.local", name: "Admin" };
    next();
  });

  registerCollectionRoutes(app, {
    prisma,
    requireAuth: (_req: any, _res: any, next: any) => next(),
    optionalAuth: (_req: any, _res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
      Promise.resolve(fn(req, res, next)).catch(next),
    parseJsonField: (val: string | null | undefined, fallback: any) => {
      try { return JSON.parse(val!); } catch { return fallback; }
    },
    validateImportedDrawing: vi.fn().mockReturnValue(true),
    drawingCreateSchema: { safeParse: vi.fn() } as any,
    drawingUpdateSchema: { safeParse: vi.fn() } as any,
    collectionNameSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: "Renamed" }) } as any,
    sanitizeText: (input: unknown) => String(input ?? ""),
    respondWithValidationErrors: vi.fn(),
    ensureTrashCollection: vi.fn(),
    invalidateDrawingsCache: vi.fn(),
    buildDrawingsCacheKey: vi.fn(),
    getCachedDrawingsBody: vi.fn().mockReturnValue(null),
    cacheDrawingsResponse: vi.fn(),
    MAX_PAGE_SIZE: 100,
    config: { nodeEnv: "test", enableAuditLogging: false, snapshotKeyframeInterval: 10 },
    logAuditEvent: vi.fn(),
    getAdminFullAccess: vi.fn().mockResolvedValue(adminFullAccess),
    processFilesForS3: vi.fn().mockImplementation((files: any) => Promise.resolve(files)),
  });

  return { app, prisma };
}

describe("Admin full access – collection routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /collections", () => {
    it("returns all collections when admin full access is enabled", async () => {
      const { app, prisma } = buildApp({ adminFullAccess: true });
      prisma.collection.findMany.mockResolvedValue([mockCollectionOwnedByOther]);
      prisma.collectionShare.groupBy.mockResolvedValue([]);

      const res = await request(app).get("/collections");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const findManyCall = prisma.collection.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({});
    });

    it("only returns own collections when admin full access is disabled", async () => {
      const { app, prisma } = buildApp({ adminFullAccess: false });
      prisma.collection.findMany.mockResolvedValue([]);
      prisma.collectionShare.groupBy.mockResolvedValue([]);

      const res = await request(app).get("/collections");

      expect(res.status).toBe(200);
      const findManyCall = prisma.collection.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({ userId: ADMIN_USER_ID });
    });

    it("regular user only sees own collections even when toggle is on", async () => {
      const { app, prisma } = buildApp({ role: "USER", adminFullAccess: true });
      prisma.collection.findMany.mockResolvedValue([]);
      prisma.collectionShare.groupBy.mockResolvedValue([]);

      const res = await request(app).get("/collections");

      expect(res.status).toBe(200);
      const findManyCall = prisma.collection.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({ userId: ADMIN_USER_ID });
    });
  });

  describe("PUT /collections/:id", () => {
    it("admin can rename another user's collection when enabled", async () => {
      const { app, prisma } = buildApp({ adminFullAccess: true });
      prisma.collection.findFirst.mockResolvedValue(mockCollectionOwnedByOther);
      prisma.collection.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .put(`/collections/${COLLECTION_ID}`)
        .send({ name: "Renamed" });

      expect(res.status).toBe(200);
      expect(prisma.collection.findFirst).toHaveBeenCalledWith({
        where: { id: COLLECTION_ID },
      });
    });

    it("admin cannot rename another user's collection when disabled", async () => {
      const { app, prisma } = buildApp({ adminFullAccess: false });
      prisma.collection.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .put(`/collections/${COLLECTION_ID}`)
        .send({ name: "Renamed" });

      expect(res.status).toBe(404);
      expect(prisma.collection.findFirst).toHaveBeenCalledWith({
        where: { id: COLLECTION_ID, userId: ADMIN_USER_ID },
      });
    });
  });

  describe("DELETE /collections/:id", () => {
    it("admin can delete another user's collection when enabled", async () => {
      const { app, prisma } = buildApp({ adminFullAccess: true });
      prisma.collection.findFirst.mockResolvedValue(mockCollectionOwnedByOther);

      const res = await request(app).delete(`/collections/${COLLECTION_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.collection.findFirst).toHaveBeenCalledWith({
        where: { id: COLLECTION_ID },
      });
    });

    it("admin cannot delete another user's collection when disabled", async () => {
      const { app, prisma } = buildApp({ adminFullAccess: false });
      prisma.collection.findFirst.mockResolvedValue(null);

      const res = await request(app).delete(`/collections/${COLLECTION_ID}`);

      expect(res.status).toBe(404);
      expect(prisma.collection.findFirst).toHaveBeenCalledWith({
        where: { id: COLLECTION_ID, userId: ADMIN_USER_ID },
      });
    });
  });
});
