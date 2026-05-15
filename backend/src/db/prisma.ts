import { PrismaClient } from "../generated/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var __excalidashPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/excalidash";
  const adapter = new PrismaPg(url);
  return new PrismaClient({ adapter });
}

const prismaClient = globalThis.__excalidashPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__excalidashPrisma = prismaClient;
}

export { prismaClient as prisma };
