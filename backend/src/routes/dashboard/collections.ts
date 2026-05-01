import express from "express";
import { DashboardRouteDeps } from "./types.js";
import { getUserTrashCollectionId, isTrashCollectionId } from "./trash.js";
import { ensureTeamCollections, parseTeamsHeader, SYSTEM_USER_EMAIL } from "../../services/teamCollections.js";
import { config as appConfig } from "../../config.js";

export const registerCollectionRoutes = (
  app: express.Express,
  deps: DashboardRouteDeps
) => {
  const {
    prisma,
    requireAuth,
    asyncHandler,
    collectionNameSchema,
    sanitizeText,
    ensureTrashCollection,
    invalidateDrawingsCache,
    config,
    logAuditEvent,
  } = deps;

  const normalizeCollectionShareRole = (input: unknown): "view" | "edit" | null => {
    if (input === "view" || input === "edit") return input;
    return null;
  };

  app.get("/collections", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const trashCollectionId = getUserTrashCollectionId(req.user.id);
    await ensureTrashCollection(prisma, req.user.id);

    if (appConfig.authMode === "proxy") {
      const teams = parseTeamsHeader(req.headers["x-goat-teams"]);
      if (teams.length > 0) {
        await ensureTeamCollections(prisma, req.user.id, teams);
      }
    }

    const rawCollections = await prisma.collection.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    const sharedWithMe = await prisma.collectionShare.findMany({
      where: { granteeUserId: req.user.id },
      include: {
        collection: true,
      },
    });

    const collectionsWithShares = await prisma.collectionShare.groupBy({
      by: ["collectionId"],
      where: { collectionId: { in: rawCollections.map(c => c.id) } },
    });
    const sharedCollectionIds = new Set(collectionsWithShares.map(s => s.collectionId));

    const hasInternalTrash = rawCollections.some((collection) => collection.id === trashCollectionId);
    const ownedCollections = rawCollections
      .filter((collection) => !(hasInternalTrash && collection.id === "trash"))
      .map((collection) => {
        const hasShares = sharedCollectionIds.has(collection.id);
        return collection.id === trashCollectionId
          ? { ...collection, id: "trash", name: "Trash", isOwner: true, sharedRole: null, isShared: false }
          : { ...collection, isOwner: true, sharedRole: null, isShared: hasShares };
      });

    const ownedIds = new Set(rawCollections.map(c => c.id));
    const sharedCollections = sharedWithMe
      .filter(s => !ownedIds.has(s.collectionId))
      .map(s => ({
        ...s.collection,
        isOwner: false,
        sharedRole: s.role as "view" | "edit",
        isShared: true,
      }));

    return res.json([...ownedCollections, ...sharedCollections]);
  }));

  app.post("/collections", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const parsed = collectionNameSchema.safeParse(req.body.name);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation error",
        message: "Collection name must be between 1 and 100 characters",
      });
    }

    const sanitizedName = sanitizeText(parsed.data, 100);
    const newCollection = await prisma.collection.create({
      data: { name: sanitizedName, userId: req.user.id },
    });
    return res.json(newCollection);
  }));

  app.put("/collections/:id", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const id = req.params.id as string;
    if (isTrashCollectionId(id, req.user.id)) {
      return res.status(400).json({
        error: "Validation error",
        message: "Trash collection cannot be renamed",
      });
    }
    const existingCollection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existingCollection) return res.status(404).json({ error: "Collection not found" });

    const parsed = collectionNameSchema.safeParse(req.body.name);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation error",
        message: "Collection name must be between 1 and 100 characters",
      });
    }

    const sanitizedName = sanitizeText(parsed.data, 100);
    const updateResult = await prisma.collection.updateMany({
      where: { id, userId: req.user.id },
      data: { name: sanitizedName },
    });
    if (updateResult.count === 0) {
      return res.status(404).json({ error: "Collection not found" });
    }
    const updatedCollection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!updatedCollection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    return res.json(updatedCollection);
  }));

  app.delete("/collections/:id", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const id = req.params.id as string;
    if (isTrashCollectionId(id, req.user.id)) {
      return res.status(400).json({
        error: "Validation error",
        message: "Trash collection cannot be deleted",
      });
    }
    const collection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    await prisma.$transaction([
      prisma.drawing.updateMany({
        where: { collectionId: id, userId: req.user.id },
        data: { collectionId: null },
      }),
      prisma.collection.deleteMany({ where: { id, userId: req.user.id } }),
    ]);
    invalidateDrawingsCache();

    if (config.enableAuditLogging) {
      await logAuditEvent({
        userId: req.user.id,
        action: "collection_deleted",
        resource: `collection:${id}`,
        ipAddress: req.ip || req.connection.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
        details: { collectionId: id, collectionName: collection.name },
      });
    }

    return res.json({ success: true });
  }));

  // Collection Sharing Endpoints

  app.get("/collections/:id/share-resolve", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const id = req.params.id as string;
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const q = qRaw.toLowerCase();
    if (q.length < 3) return res.json({ users: [] });

    const collection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    const existingShares = await prisma.collectionShare.findMany({
      where: { collectionId: id },
      select: { granteeUserId: true },
    });
    const alreadySharedIds = new Set(existingShares.map(s => s.granteeUserId));

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: req.user.id },
        email: { not: SYSTEM_USER_EMAIL },
        OR: [
          { email: { contains: q } },
          { name: { contains: q } },
          { username: { contains: q } },
        ],
      },
      select: { id: true, name: true, email: true },
      take: 10,
    });

    return res.json({ users: users.filter(u => !alreadySharedIds.has(u.id)) });
  }));

  app.get("/collections/:id/shares", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id as string;

    const collection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    const shares = await prisma.collectionShare.findMany({
      where: { collectionId: id },
      select: {
        id: true,
        collectionId: true,
        granteeUserId: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        granteeUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ shares });
  }));

  app.post("/collections/:id/shares", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id as string;

    const collection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    if (isTrashCollectionId(id, req.user.id)) {
      return res.status(400).json({ error: "Validation error", message: "Cannot share trash collection" });
    }

    const granteeUserId = typeof req.body?.granteeUserId === "string" ? req.body.granteeUserId : null;
    const role = normalizeCollectionShareRole(req.body?.role);
    if (!granteeUserId || !role) {
      return res.status(400).json({ error: "Validation error", message: "Invalid grantee or role" });
    }
    if (granteeUserId === req.user.id) {
      return res.status(400).json({ error: "Validation error", message: "Cannot share with yourself" });
    }

    const user = await prisma.user.findUnique({
      where: { id: granteeUserId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return res.status(404).json({ error: "User not found" });
    }

    const saved = await prisma.collectionShare.upsert({
      where: {
        collectionId_granteeUserId: { collectionId: id, granteeUserId },
      },
      update: { role, createdByUserId: req.user.id },
      create: { collectionId: id, granteeUserId, role, createdByUserId: req.user.id },
      select: {
        id: true,
        collectionId: true,
        granteeUserId: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        granteeUser: { select: { id: true, name: true, email: true } },
      },
    });

    invalidateDrawingsCache();

    if (config.enableAuditLogging) {
      await logAuditEvent({
        userId: req.user.id,
        action: "collection_shared_user_upsert",
        resource: `collection:${id}`,
        ipAddress: req.ip || req.connection.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
        details: { collectionId: id, granteeUserId, role },
      });
    }

    return res.json({ share: saved });
  }));

  app.patch("/collections/:id/shares/:userId", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id as string;
    const targetUserId = req.params.userId as string;

    const collection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    const role = normalizeCollectionShareRole(req.body?.role);
    if (!role) {
      return res.status(400).json({ error: "Validation error", message: "Invalid role" });
    }

    const existing = await prisma.collectionShare.findUnique({
      where: { collectionId_granteeUserId: { collectionId: id, granteeUserId: targetUserId } },
    });
    if (!existing) return res.status(404).json({ error: "Share not found" });

    await prisma.collectionShare.update({
      where: { collectionId_granteeUserId: { collectionId: id, granteeUserId: targetUserId } },
      data: { role },
    });

    invalidateDrawingsCache();

    if (config.enableAuditLogging) {
      await logAuditEvent({
        userId: req.user.id,
        action: "collection_share_role_updated",
        resource: `collection:${id}`,
        ipAddress: req.ip || req.connection.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
        details: { collectionId: id, granteeUserId: targetUserId, role },
      });
    }

    return res.json({ success: true });
  }));

  app.delete("/collections/:id/shares/:userId", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id as string;
    const targetUserId = req.params.userId as string;

    const collection = await prisma.collection.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    await prisma.collectionShare.deleteMany({
      where: { collectionId: id, granteeUserId: targetUserId },
    });
    invalidateDrawingsCache();

    if (config.enableAuditLogging) {
      await logAuditEvent({
        userId: req.user.id,
        action: "collection_shared_user_revoke",
        resource: `collection:${id}`,
        ipAddress: req.ip || req.connection.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
        details: { collectionId: id, granteeUserId: targetUserId },
      });
    }

    return res.json({ success: true });
  }));
};
