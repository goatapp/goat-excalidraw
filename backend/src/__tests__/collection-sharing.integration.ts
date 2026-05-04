import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { StringValue } from "ms";
import { PrismaClient } from "../generated/client/client.js";
import { config } from "../config.js";
import { getTestPrisma, resetTestDb, setupTestDb } from "./testUtils.js";
import { SYSTEM_USER_EMAIL } from "../services/teamCollections.js";

describe("Collection Sharing", () => {
  const userAgent = "vitest-collection-sharing";
  let prisma: PrismaClient;
  let app: any;

  const passwordHash = bcrypt.hashSync("password123", 10);
  const signOptions: SignOptions = { expiresIn: config.jwtAccessExpiresIn as StringValue };

  let agent: any;
  let csrfHeaderName: string;
  let csrfToken: string;

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

    agent = request.agent(app);
    const csrfRes = await agent.get("/csrf-token").set("User-Agent", userAgent);
    csrfHeaderName = csrfRes.body.header;
    csrfToken = csrfRes.body.token;
  });

  beforeEach(async () => {
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

  describe("GET /collections (with shared collections)", () => {
    it("returns shared collections alongside owned collections", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");

      const collection = await prisma.collection.create({
        data: { name: "Shared Collection", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .get("/collections")
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`);

      expect(res.status).toBe(200);
      const shared = res.body.filter((c: any) => c.id === collection.id);
      expect(shared).toHaveLength(1);
      expect(shared[0].isOwner).toBe(false);
      expect(shared[0].sharedRole).toBe("view");
      expect(shared[0].isShared).toBe(true);
    });

    it("marks owned collections with isShared when they have shares", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");

      const collection = await prisma.collection.create({
        data: { name: "My Collection", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .get("/collections")
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const owned = res.body.find((c: any) => c.id === collection.id);
      expect(owned.isOwner).toBe(true);
      expect(owned.isShared).toBe(true);
    });
  });

  describe("POST /collections/:id/shares", () => {
    it("creates a share for an owned collection", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .post(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, role: "edit" });

      expect(res.status).toBe(200);
      expect(res.body.share.granteeUserId).toBe(grantee.id);
      expect(res.body.share.role).toBe("edit");
    });

    it("rejects sharing with yourself", async () => {
      const owner = await createUser("owner@test.local", "Owner");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .post(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: owner.id, role: "edit" });

      expect(res.status).toBe(400);
    });

    it("rejects sharing a collection you do not own", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const other = await createUser("other@test.local", "Other");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .post(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${other.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, role: "edit" });

      expect(res.status).toBe(404);
    });

    it("rejects invalid role", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .post(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, role: "admin" });

      expect(res.status).toBe(400);
    });

    it("upserts share when re-sharing to same user", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      await agent
        .post(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, role: "view" });

      const res = await agent
        .post(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, role: "edit" });

      expect(res.status).toBe(200);
      expect(res.body.share.role).toBe("edit");

      const shares = await prisma.collectionShare.findMany({
        where: { collectionId: collection.id, granteeUserId: grantee.id },
      });
      expect(shares).toHaveLength(1);
    });
  });

  describe("PATCH /collections/:id/shares/:userId", () => {
    it("updates a share role", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: grantee.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .patch(`/collections/${collection.id}/shares/${grantee.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ role: "edit" });

      expect(res.status).toBe(200);

      const updated = await prisma.collectionShare.findFirst({
        where: { collectionId: collection.id, granteeUserId: grantee.id },
      });
      expect(updated?.role).toBe("edit");
    });
  });

  describe("DELETE /collections/:id/shares/:userId", () => {
    it("removes a share", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: grantee.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .delete(`/collections/${collection.id}/shares/${grantee.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`)
        .set(csrfHeaderName, csrfToken);

      expect(res.status).toBe(200);

      const remaining = await prisma.collectionShare.findMany({
        where: { collectionId: collection.id },
      });
      expect(remaining).toHaveLength(0);
    });
  });

  describe("GET /collections/:id/shares", () => {
    it("returns all shares for an owned collection", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const g1 = await createUser("g1@test.local", "Grantee 1");
      const g2 = await createUser("g2@test.local", "Grantee 2");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      await prisma.collectionShare.createMany({
        data: [
          { collectionId: collection.id, granteeUserId: g1.id, role: "view", createdByUserId: owner.id },
          { collectionId: collection.id, granteeUserId: g2.id, role: "edit", createdByUserId: owner.id },
        ],
      });

      const res = await agent
        .get(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.shares).toHaveLength(2);
    });

    it("returns 404 for a collection you do not own", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const other = await createUser("other@test.local", "Other");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .get(`/collections/${collection.id}/shares`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${other.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /collections/:id/share-resolve", () => {
    it("filters out the system user from results", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      await createUser("alice@test.local", "Alice");
      await prisma.user.create({
        data: { email: SYSTEM_USER_EMAIL, passwordHash, name: "System", isActive: true },
      });

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .get(`/collections/${collection.id}/share-resolve?q=sys`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const emails = res.body.users.map((u: any) => u.email);
      expect(emails).not.toContain(SYSTEM_USER_EMAIL);
    });

    it("returns matching users for a valid query", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      await createUser("alice@test.local", "Alice");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      const res = await agent
        .get(`/collections/${collection.id}/share-resolve?q=alice`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
      expect(res.body.users[0].email).toBe("alice@test.local");
    });

    it("excludes users who already have a share", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const alice = await createUser("alice@test.local", "Alice");

      const collection = await prisma.collection.create({
        data: { name: "Test", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: alice.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .get(`/collections/${collection.id}/share-resolve?q=alice`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(0);
    });
  });

  describe("Drawing access through collection shares", () => {
    it("allows viewing drawings in a collection shared with view role", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");

      const collection = await prisma.collection.create({
        data: { name: "Shared", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "In Shared Collection",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .get(`/drawings/${drawing.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("In Shared Collection");
      expect(res.body.accessLevel).toBe("view");
    });

    it("allows editing drawings in a collection shared with edit role", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const editor = await createUser("editor@test.local", "Editor");

      const collection = await prisma.collection.create({
        data: { name: "Shared", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: editor.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Editable",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .put(`/drawings/${drawing.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${editor.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ name: "Updated Name", version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
    });

    it("rejects editing drawings in a view-only shared collection", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");

      const collection = await prisma.collection.create({
        data: { name: "Shared", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Read Only",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .put(`/drawings/${drawing.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ name: "Should Fail", version: 1 });

      expect(res.status).toBe(404);
    });

    it("denies access to drawings not in any shared collection", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const other = await createUser("other@test.local", "Other");

      const drawing = await prisma.drawing.create({
        data: {
          name: "Private",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: null,
          version: 1,
        },
      });

      const res = await agent
        .get(`/drawings/${drawing.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${other.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /drawings with shared collection filter", () => {
    it("lists drawings in a shared collection", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");

      const collection = await prisma.collection.create({
        data: { name: "Shared", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      await prisma.drawing.create({
        data: {
          name: "Drawing 1",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .get(`/drawings?collectionId=${collection.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`);

      expect(res.status).toBe(200);
      expect(res.body.drawings).toHaveLength(1);
      expect(res.body.drawings[0].name).toBe("Drawing 1");
    });

    it("returns 404 for a collection without share access", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const other = await createUser("other@test.local", "Other");

      const collection = await prisma.collection.create({
        data: { name: "Private", userId: owner.id },
      });

      const res = await agent
        .get(`/drawings?collectionId=${collection.id}`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${other.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /drawings (creating in shared collections)", () => {
    it("allows creating a drawing in a shared collection with edit role", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const editor = await createUser("editor@test.local", "Editor");

      const collection = await prisma.collection.create({
        data: { name: "Shared", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: editor.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .post("/drawings")
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${editor.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({
          name: "New Drawing",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff" },
          collectionId: collection.id,
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Drawing");
    });

    it("rejects creating a drawing in a shared collection with view role", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");

      const collection = await prisma.collection.create({
        data: { name: "Shared", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const res = await agent
        .post("/drawings")
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({
          name: "Should Fail",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff" },
          collectionId: collection.id,
        });

      expect(res.status).toBe(403);
    });
  });

  describe("Drawing sharing management by collection editors", () => {
    it("allows a collection editor to view drawing sharing info", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const editor = await createUser("editor@test.local", "Editor");

      const collection = await prisma.collection.create({
        data: { name: "Team", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: editor.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Team Drawing",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .get(`/drawings/${drawing.id}/sharing`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${editor.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("permissions");
      expect(res.body).toHaveProperty("linkShares");
    });

    it("allows a collection editor to share a drawing with another user", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const editor = await createUser("editor@test.local", "Editor");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Team", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: editor.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Team Drawing",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .post(`/drawings/${drawing.id}/permissions`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${editor.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, permission: "view" });

      expect(res.status).toBe(200);
      expect(res.body.permission.granteeUserId).toBe(grantee.id);
    });

    it("allows a collection editor to use share-resolve", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const editor = await createUser("editor@test.local", "Editor");
      await createUser("alice@test.local", "Alice");

      const collection = await prisma.collection.create({
        data: { name: "Team", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: editor.id,
          role: "edit",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Team Drawing",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const res = await agent
        .get(`/drawings/${drawing.id}/share-resolve?q=alice`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${editor.token}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
    });

    it("denies sharing management for view-only collection members", async () => {
      const owner = await createUser("owner@test.local", "Owner");
      const viewer = await createUser("viewer@test.local", "Viewer");
      const grantee = await createUser("grantee@test.local", "Grantee");

      const collection = await prisma.collection.create({
        data: { name: "Team", userId: owner.id },
      });

      await prisma.collectionShare.create({
        data: {
          collectionId: collection.id,
          granteeUserId: viewer.id,
          role: "view",
          createdByUserId: owner.id,
        },
      });

      const drawing = await prisma.drawing.create({
        data: {
          name: "Team Drawing",
          elements: "[]",
          appState: "{}",
          files: "{}",
          userId: owner.id,
          collectionId: collection.id,
          version: 1,
        },
      });

      const sharingRes = await agent
        .get(`/drawings/${drawing.id}/sharing`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`);

      expect(sharingRes.status).toBe(404);

      const permRes = await agent
        .post(`/drawings/${drawing.id}/permissions`)
        .set("User-Agent", userAgent)
        .set("Authorization", `Bearer ${viewer.token}`)
        .set(csrfHeaderName, csrfToken)
        .send({ granteeUserId: grantee.id, permission: "view" });

      expect(permRes.status).toBe(404);
    });
  });
});
