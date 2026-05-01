import crypto from "crypto";
import type { PrismaClient } from "../generated/client/client.js";

export const SYSTEM_USER_EMAIL = "system@excalidash.local";
const TEAM_COLLECTION_ID_PREFIX = "team_";

let cachedSystemUserId: string | null = null;

export const resetCachedSystemUserId = (): void => {
  cachedSystemUserId = null;
};

const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const teamCollectionId = (teamName: string): string =>
  `${TEAM_COLLECTION_ID_PREFIX}${slugify(teamName)}`;

export const isTeamCollectionId = (id: string): boolean =>
  id.startsWith(TEAM_COLLECTION_ID_PREFIX);

const ensureSystemUser = async (prisma: PrismaClient): Promise<string> => {
  if (cachedSystemUserId) return cachedSystemUserId;

  const user = await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      name: "System",
      passwordHash: crypto.randomBytes(32).toString("hex"),
      isActive: true,
    },
    select: { id: true },
  });

  cachedSystemUserId = user.id;
  return user.id;
};

export const ensureTeamCollections = async (
  prisma: PrismaClient,
  userId: string,
  teamNames: string[],
): Promise<void> => {
  if (teamNames.length === 0) return;

  const systemUserId = await ensureSystemUser(prisma);

  const expectedCollectionIds = new Set<string>();

  for (const teamName of teamNames) {
    const collId = teamCollectionId(teamName);
    expectedCollectionIds.add(collId);

    await prisma.collection.upsert({
      where: { id: collId },
      update: {},
      create: { id: collId, name: teamName, userId: systemUserId },
    });

    await prisma.collectionShare.upsert({
      where: { collectionId_granteeUserId: { collectionId: collId, granteeUserId: userId } },
      update: { role: "edit" },
      create: { collectionId: collId, granteeUserId: userId, role: "edit", createdByUserId: systemUserId },
    });
  }

  const staleShares = await prisma.collectionShare.findMany({
    where: {
      granteeUserId: userId,
      collectionId: { startsWith: TEAM_COLLECTION_ID_PREFIX },
    },
    select: { id: true, collectionId: true },
  });

  const toDelete = staleShares
    .filter(s => !expectedCollectionIds.has(s.collectionId))
    .map(s => s.id);

  if (toDelete.length > 0) {
    await prisma.collectionShare.deleteMany({
      where: { id: { in: toDelete } },
    });
  }
};

export const parseTeamsHeader = (raw: string | string[] | undefined): string[] => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  return [...new Set(
    value.split(",").map(t => t.trim()).filter(t => t.length > 0)
  )];
};
