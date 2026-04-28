import { PrismaClient } from "../generated/client/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { config } from "../config.js";

declare global {
  // eslint-disable-next-line no-var
  var __excalidashPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const url = config.databaseUrl ?? process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

const prismaClient = globalThis.__excalidashPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__excalidashPrisma = prismaClient;
}

export { prismaClient as prisma };
