import { PrismaClient } from "../generated/client/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { config } from "../config.js";

declare global {
  // eslint-disable-next-line no-var
  var __excalidashPrisma: PrismaClient | undefined;
}

function configureSqlitePragmas(url: string): void {
  const filePath = url.replace(/^file:/, "");
  const db = new Database(filePath);
  db.pragma("journal_mode=WAL");
  db.pragma("synchronous=NORMAL");
  db.pragma("journal_size_limit=67108864");
  db.close();
}

function createPrismaClient(): PrismaClient {
  const url = config.databaseUrl ?? process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  configureSqlitePragmas(url);
  const adapter = new PrismaBetterSqlite3({ url, timeout: 5000 });
  return new PrismaClient({ adapter });
}

const prismaClient = globalThis.__excalidashPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__excalidashPrisma = prismaClient;
}

export { prismaClient as prisma };
