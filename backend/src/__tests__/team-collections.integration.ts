import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { StringValue } from "ms";
import { PrismaClient } from "../generated/client/client.js";
import { config } from "../config.js";
import { getTestPrisma, resetTestDb, setupTestDb } from "./testUtils.js";
import {
  ensureTeamCollections,
  parseTeamsHeader,
  SYSTEM_USER_EMAIL,
  isTeamCollectionId,
  resetCachedSystemUserId,
} from "../services/teamCollections.js";

describe("Team Collections", () => {
  const userAgent = "vitest-team-collections";
  let prisma: PrismaClient;
  let app: any;

  const passwordHash = bcrypt.hashSync("password123", 10);
  const signOptions: SignOptions = { expiresIn: config.jwtAccessExpiresIn as StringValue };

  const createUser = async (email: string, name: string) => {
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: "USER", isActive: true },
      select: { id: true, email: true },
    });
    const token = jwt.sign(
      { userId: user.id, email: user.email, type: "access" },
      config.jwtSecret,
      signOptions,
    );
    return { ...user, token };
  };

  beforeAll(async () => {
    setupTestDb();
    prisma = await getTestPrisma();
    await resetTestDb(prisma);
    ({ app } = await import("../index.js"));

    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });
  });

  beforeEach(async () => {
    resetCachedSystemUserId();
    await prisma.drawingSnapshot.deleteMany({});
    await prisma.drawingLinkShare.deleteMany({});
    await prisma.drawingPermission.deleteMany({});
    await prisma.drawing.deleteMany({});
    await prisma.collectionShare.deleteMany({});
    await prisma.collection.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.passwordResetToken.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.authIdentity.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("parseTeamsHeader", () => {
    it("parses comma-separated team names", () => {
      expect(parseTeamsHeader("platform,buy,sneakers")).toEqual([
        "platform",
        "buy",
        "sneakers",
      ]);
    });

    it("trims whitespace", () => {
      expect(parseTeamsHeader(" platform , buy ")).toEqual(["platform", "buy"]);
    });

    it("deduplicates team names", () => {
      expect(parseTeamsHeader("platform,platform,buy")).toEqual([
        "platform",
        "buy",
      ]);
    });

    it("returns empty array for undefined", () => {
      expect(parseTeamsHeader(undefined)).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(parseTeamsHeader("")).toEqual([]);
    });

    it("handles array input (takes first element)", () => {
      expect(parseTeamsHeader(["platform,buy", "ignored"])).toEqual([
        "platform",
        "buy",
      ]);
    });

    it("filters out empty segments", () => {
      expect(parseTeamsHeader("platform,,buy,")).toEqual(["platform", "buy"]);
    });
  });

  describe("isTeamCollectionId", () => {
    it("returns true for team collection IDs", () => {
      expect(isTeamCollectionId("team_platform")).toBe(true);
      expect(isTeamCollectionId("team_my-team")).toBe(true);
    });

    it("returns false for non-team IDs", () => {
      expect(isTeamCollectionId("some-uuid")).toBe(false);
      expect(isTeamCollectionId("trash:user-id")).toBe(false);
    });
  });

  describe("ensureTeamCollections", () => {
    it("creates team collections and shares for a user", async () => {
      const user = await createUser("user@test.local", "User");

      await ensureTeamCollections(prisma, user.id, ["Platform", "Buy"]);

      const collections = await prisma.collection.findMany({
        where: { id: { startsWith: "team_" } },
      });
      expect(collections).toHaveLength(2);
      expect(collections.map((c) => c.id).sort()).toEqual([
        "team_buy",
        "team_platform",
      ]);

      const shares = await prisma.collectionShare.findMany({
        where: { granteeUserId: user.id, collectionId: { startsWith: "team_" } },
      });
      expect(shares).toHaveLength(2);
      expect(shares.every((s) => s.role === "edit")).toBe(true);
    });

    it("creates a system user as the collection owner", async () => {
      const user = await createUser("user@test.local", "User");

      await ensureTeamCollections(prisma, user.id, ["Engineering"]);

      const systemUser = await prisma.user.findUnique({
        where: { email: SYSTEM_USER_EMAIL },
      });
      expect(systemUser).toBeTruthy();
      expect(systemUser!.isActive).toBe(true);

      const collection = await prisma.collection.findUnique({
        where: { id: "team_engineering" },
      });
      expect(collection?.userId).toBe(systemUser!.id);
    });

    it("is idempotent — calling twice does not duplicate", async () => {
      const user = await createUser("user@test.local", "User");

      await ensureTeamCollections(prisma, user.id, ["Platform"]);
      await ensureTeamCollections(prisma, user.id, ["Platform"]);

      const collections = await prisma.collection.findMany({
        where: { id: "team_platform" },
      });
      expect(collections).toHaveLength(1);

      const shares = await prisma.collectionShare.findMany({
        where: { granteeUserId: user.id, collectionId: "team_platform" },
      });
      expect(shares).toHaveLength(1);
    });

    it("removes stale shares when teams change", async () => {
      const user = await createUser("user@test.local", "User");

      await ensureTeamCollections(prisma, user.id, ["Platform", "Buy"]);

      let shares = await prisma.collectionShare.findMany({
        where: { granteeUserId: user.id, collectionId: { startsWith: "team_" } },
      });
      expect(shares).toHaveLength(2);

      await ensureTeamCollections(prisma, user.id, ["Platform"]);

      shares = await prisma.collectionShare.findMany({
        where: { granteeUserId: user.id, collectionId: { startsWith: "team_" } },
      });
      expect(shares).toHaveLength(1);
      expect(shares[0].collectionId).toBe("team_platform");
    });

    it("does not remove another user's team shares", async () => {
      const userA = await createUser("a@test.local", "A");
      const userB = await createUser("b@test.local", "B");

      await ensureTeamCollections(prisma, userA.id, ["Platform", "Buy"]);
      await ensureTeamCollections(prisma, userB.id, ["Platform", "Buy"]);

      await ensureTeamCollections(prisma, userA.id, ["Platform"]);

      const sharesA = await prisma.collectionShare.findMany({
        where: { granteeUserId: userA.id, collectionId: { startsWith: "team_" } },
      });
      expect(sharesA).toHaveLength(1);

      const sharesB = await prisma.collectionShare.findMany({
        where: { granteeUserId: userB.id, collectionId: { startsWith: "team_" } },
      });
      expect(sharesB).toHaveLength(2);
    });

    it("does nothing for empty team list", async () => {
      const user = await createUser("user@test.local", "User");

      await ensureTeamCollections(prisma, user.id, []);

      const collections = await prisma.collection.findMany({
        where: { id: { startsWith: "team_" } },
      });
      expect(collections).toHaveLength(0);
    });

    it("slugifies team names for deterministic IDs", async () => {
      const user = await createUser("user@test.local", "User");

      await ensureTeamCollections(prisma, user.id, ["My Great Team"]);

      const collection = await prisma.collection.findUnique({
        where: { id: "team_my-great-team" },
      });
      expect(collection).toBeTruthy();
      expect(collection!.name).toBe("My Great Team");
    });
  });

  describe("GET /drawings/:id/share-resolve (system user filtering)", () => {
    it("excludes the system user from drawing share-resolve", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      await prisma.user.create({
        data: { email: SYSTEM_USER_EMAIL, passwordHash, name: "System", isActive: true },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Test",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          version: 1,
        },
      });

      const res = await request(app)
        .get(`/drawings/${drawing.id}/share-resolve?q=system`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const emails = res.body.users.map((u: any) => u.email);
      expect(emails).not.toContain(SYSTEM_USER_EMAIL);
    });
  });
});
