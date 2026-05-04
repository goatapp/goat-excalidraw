import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdminRoutes } from "./adminRoutes.js";

const buildApp = (options?: {
  authMode?: "local" | "hybrid" | "oidc_enforced" | "proxy";
  userRole?: "ADMIN" | "USER";
}) => {
  const router = express.Router();
  router.use(express.json());

  const prisma = {
    systemConfig: {
      upsert: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  } as any;

  const userRole = options?.userRole ?? "ADMIN";

  registerAdminRoutes({
    router,
    prisma,
    requireAuth: ((req: any, _res: any, next: any) => {
      req.user = {
        id: "admin-id",
        email: "admin@test.local",
        name: "Admin",
        role: userRole,
      };
      next();
    }) as any,
    accountActionRateLimiter: ((_req: any, _res: any, next: any) => next()) as any,
    ensureAuthEnabled: vi.fn().mockResolvedValue(true),
    ensureSystemConfig: vi.fn().mockResolvedValue({
      id: "default",
      oidcJitProvisioningEnabled: null,
      authLoginRateLimitEnabled: true,
      authLoginRateLimitWindowMs: 900000,
      authLoginRateLimitMax: 20,
      adminFullAccess: false,
    }),
    parseLoginRateLimitConfig: vi.fn().mockReturnValue({ enabled: true, windowMs: 900000, max: 20 }),
    applyLoginRateLimitConfig: vi.fn().mockReturnValue({ enabled: true, windowMs: 900000, max: 20 }),
    resetLoginAttemptKey: vi.fn(),
    requireAdmin: ((req: any, res: any) => {
      if (req.user && req.user.role === "ADMIN") return true;
      res.status(403).json({ error: "Forbidden" });
      return false;
    }) as any,
    findUserByIdentifier: vi.fn(),
    countActiveAdmins: vi.fn().mockResolvedValue(1),
    sanitizeText: (input: unknown) => String(input ?? "").trim(),
    generateTempPassword: vi.fn().mockReturnValue("TempPass123!"),
    generateTokens: vi.fn().mockReturnValue({ accessToken: "a", refreshToken: "r" }),
    getRefreshTokenExpiresAt: vi.fn().mockReturnValue(new Date()),
    config: {
      authMode: options?.authMode ?? "local",
      enableAuditLogging: false,
      enableRefreshTokenRotation: false,
      oidc: {
        enabled: true,
        providerName: "Auth0",
        jitProvisioning: true,
      },
    },
    defaultSystemConfigId: "default",
    setAuthCookies: vi.fn(),
    requireCsrf: vi.fn().mockReturnValue(true),
  });

  const app = express();
  app.use(router);
  return { app, prisma };
};

describe("POST /admin-full-access", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("enables admin full access", async () => {
    const { app, prisma } = buildApp();
    prisma.systemConfig.upsert.mockResolvedValue({
      id: "default",
      adminFullAccess: true,
    });

    const response = await request(app)
      .post("/admin-full-access")
      .send({ enabled: true });

    expect(response.status).toBe(200);
    expect(response.body.adminFullAccess).toBe(true);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { adminFullAccess: true },
      })
    );
  });

  it("disables admin full access", async () => {
    const { app, prisma } = buildApp();
    prisma.systemConfig.upsert.mockResolvedValue({
      id: "default",
      adminFullAccess: false,
    });

    const response = await request(app)
      .post("/admin-full-access")
      .send({ enabled: false });

    expect(response.status).toBe(200);
    expect(response.body.adminFullAccess).toBe(false);
  });

  it("rejects invalid payload", async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post("/admin-full-access")
      .send({ enabled: "not-a-boolean" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Bad request");
  });

  it("rejects non-admin users", async () => {
    const { app } = buildApp({ userRole: "USER" });

    const response = await request(app)
      .post("/admin-full-access")
      .send({ enabled: true });

    expect(response.status).toBe(403);
  });
});
