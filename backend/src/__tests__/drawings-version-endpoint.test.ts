import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerDrawingRoutes } from "../routes/dashboard/drawings.js";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const DRAWING_ID = "drawing-1";

function buildApp(options?: { userId?: string; adminFullAccess?: boolean }) {
  const userId = options?.userId ?? USER_ID;

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
    req.user = { id: userId, role: "USER", email: "user@test.local", name: "User" };
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
    getAdminFullAccess: vi.fn().mockResolvedValue(false),
    processFilesForS3: vi.fn().mockImplementation((files: any) => Promise.resolve(files)),
  });

  return { app, prisma };
}

describe("GET /drawings/:id/version", () => {
  let app: express.Express;
  let prisma: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    ({ app, prisma } = buildApp());
  });

  it("returns version and updatedAt for an owned drawing", async () => {
    const updatedAt = new Date("2026-05-01T12:00:00Z");
    // getDrawingAccess calls findUnique with select:{userId}, then the endpoint calls findUnique with select:{version,updatedAt}
    prisma.drawing.findUnique.mockImplementation(({ where, select }: any) => {
      if (select?.userId) return Promise.resolve({ userId: USER_ID });
      if (select?.version) return Promise.resolve({ version: 7, updatedAt });
      return Promise.resolve({ id: DRAWING_ID, userId: USER_ID, version: 7, updatedAt });
    });

    const res = await request(app).get(`/drawings/${DRAWING_ID}/version`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("version", 7);
    expect(res.body).toHaveProperty("updatedAt");
  });

  it("returns 404 for a non-existent drawing", async () => {
    prisma.drawing.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/drawings/nonexistent-id/version");

    expect(res.status).toBe(404);
  });

  it("returns 404 for a drawing the user cannot view", async () => {
    // Drawing exists but owned by another user, no permissions
    prisma.drawing.findUnique.mockImplementation(({ select }: any) => {
      if (select?.userId) return Promise.resolve({ userId: OTHER_USER_ID });
      return Promise.resolve({ id: DRAWING_ID, userId: OTHER_USER_ID, version: 3, updatedAt: new Date() });
    });

    const res = await request(app).get(`/drawings/${DRAWING_ID}/version`);

    expect(res.status).toBe(404);
  });

  it("returns only version and updatedAt fields (minimal payload)", async () => {
    const updatedAt = new Date("2026-03-15T08:30:00Z");
    prisma.drawing.findUnique.mockImplementation(({ select }: any) => {
      if (select?.userId) return Promise.resolve({ userId: USER_ID });
      if (select?.version) return Promise.resolve({ version: 12, updatedAt });
      return Promise.resolve({ id: DRAWING_ID, userId: USER_ID, version: 12, updatedAt });
    });

    const res = await request(app).get(`/drawings/${DRAWING_ID}/version`);

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body);
    expect(keys).toContain("version");
    expect(keys).toContain("updatedAt");
    // Should NOT contain heavy fields
    expect(keys).not.toContain("elements");
    expect(keys).not.toContain("appState");
    expect(keys).not.toContain("files");
    expect(keys).not.toContain("preview");
  });
});
