#!/usr/bin/env node

/**
 * One-time migration script: reads a SQLite database file and inserts all data
 * into PostgreSQL via the Prisma client.
 *
 * Uses Node's built-in node:sqlite (Node 22+) to read the source database.
 * Writes to PostgreSQL using DATABASE_URL from the environment.
 */

import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "../dist/generated/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const SOURCE_DB = process.env.SQLITE_SOURCE_PATH || "/tmp/migrate-source.db";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });
const sqlite = new DatabaseSync(SOURCE_DB, { readOnly: true });

function getAllRows(table) {
  try {
    const stmt = sqlite.prepare(`SELECT * FROM "${table}"`);
    return stmt.all();
  } catch (err) {
    console.warn(`  Skipping table "${table}": ${err.message}`);
    return [];
  }
}

function convertBooleans(row, fields) {
  for (const field of fields) {
    if (field in row && row[field] !== null) {
      row[field] = Boolean(row[field]);
    }
  }
  return row;
}

function convertDates(row, fields) {
  for (const field of fields) {
    if (field in row && row[field] !== null) {
      row[field] = new Date(row[field]);
    }
  }
  return row;
}

const DATE_FIELDS = ["createdAt", "updatedAt", "trashedAt", "expiresAt", "revokedAt",
  "lastLoginAt", "lastUsedAt", "lockedUntil", "bootstrapSetupCodeIssuedAt",
  "bootstrapSetupCodeExpiresAt"];

async function migrateTable(name, modelName, booleanFields = []) {
  const rows = getAllRows(name);
  if (rows.length === 0) {
    console.log(`  ${name}: 0 rows (skipped)`);
    return 0;
  }

  const model = prisma[modelName];
  if (!model) {
    console.error(`  ERROR: Prisma model "${modelName}" not found`);
    return 0;
  }

  let inserted = 0;
  const batchSize = 100;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const processed = batch.map((row) => {
      convertBooleans(row, booleanFields);
      convertDates(row, DATE_FIELDS);
      return row;
    });

    for (const row of processed) {
      try {
        await model.create({ data: row });
        inserted++;
      } catch (err) {
        if (err.code === "P2002") {
          // Duplicate key - skip (idempotent re-run)
          continue;
        }
        console.error(`  ERROR inserting into ${name}:`, err.message);
        console.error(`  Row:`, JSON.stringify(row).slice(0, 200));
        throw err;
      }
    }
  }

  console.log(`  ${name}: ${inserted} rows migrated`);
  return inserted;
}

async function main() {
  console.log(`Migrating from: ${SOURCE_DB}`);
  console.log(`Migrating to: PostgreSQL (DATABASE_URL)`);
  console.log("");

  // Migrate in foreign-key dependency order
  const migrations = [
    ["User", "user", ["mustResetPassword", "isActive"]],
    ["SystemConfig", "systemConfig", ["authEnabled", "authOnboardingCompleted", "registrationEnabled", "oidcJitProvisioningEnabled", "authLoginRateLimitEnabled", "adminFullAccess"]],
    ["Collection", "collection", []],
    ["Drawing", "drawing", []],
    ["DrawingPermission", "drawingPermission", []],
    ["DrawingLinkShare", "drawingLinkShare", []],
    ["DrawingSnapshot", "drawingSnapshot", []],
    ["Library", "library", []],
    ["PasswordResetToken", "passwordResetToken", ["used"]],
    ["RefreshToken", "refreshToken", ["revoked"]],
    ["AuditLog", "auditLog", []],
    ["AuthIdentity", "authIdentity", []],
    ["Comment", "comment", ["resolved"]],
    ["CommentReaction", "commentReaction", []],
    ["CollectionShare", "collectionShare", []],
    ["S3File", "s3File", []],
  ];

  let totalRows = 0;

  for (const [table, model, boolFields] of migrations) {
    totalRows += await migrateTable(table, model, boolFields);
  }

  console.log("");
  console.log(`Migration complete. Total rows: ${totalRows}`);
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    sqlite.close();
  });
