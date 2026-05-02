#!/usr/bin/env node

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import Database from "better-sqlite3";
import pino from "pino";

const isProduction = (process.env.NODE_ENV || "development") === "production";
const logger = pino({
  level: isProduction ? "info" : "debug",
  ...(isProduction
    ? {
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
}).child({ component: "s3-sync" });

const BUCKET = process.env.S3_BUCKET_NAME;
const PREFIX = process.env.S3_PREFIX || "excalidraw/";
const SYNC_INTERVAL = parseInt(process.env.S3_SYNC_INTERVAL_MS || "300000", 10);
const DB_PATH = "/app/prisma/dev.db";
const UPLOADS_DIR = "/app/uploads";
const DB_KEY = `${PREFIX}dev.db`;
const UPLOADS_PREFIX = `${PREFIX}uploads/`;
const MANIFEST_PATH = "/app/prisma/.s3-sync-manifest.json";

if (!BUCKET) {
  logger.fatal("S3_BUCKET_NAME not set, exiting");
  process.exit(1);
}

const s3 = new S3Client({
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

let lastDbHash = null;
let uploadManifest = {};

function loadManifest() {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      lastDbHash = data.lastDbHash || null;
      uploadManifest = data.uploads || {};
    }
  } catch {
    lastDbHash = null;
    uploadManifest = {};
  }
}

function saveManifest() {
  try {
    fs.writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({ lastDbHash, uploads: uploadManifest }, null, 2)
    );
  } catch (err) {
    logger.error({ err }, "Failed to save manifest");
  }
}

function fileHash(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function downloadFile(key, destPath) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(resp.Body, fs.createWriteStream(destPath));
}

async function uploadFile(filePath, key) {
  const body = fs.createReadStream(filePath);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
}

async function restore() {
  if (fs.existsSync(DB_PATH)) {
    logger.info("Local database exists, skipping restore");
    return;
  }

  logger.info("Restoring database from S3...");
  try {
    await downloadFile(DB_KEY, DB_PATH);
    logger.info("Database restored");
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      logger.info("No database backup found in S3, starting fresh");
    } else {
      throw err;
    }
  }

  logger.info("Restoring uploads from S3...");
  try {
    let continuationToken;
    do {
      const resp = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: UPLOADS_PREFIX,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of resp.Contents || []) {
        const relativePath = obj.Key.slice(UPLOADS_PREFIX.length);
        if (!relativePath) continue;
        const destPath = path.join(UPLOADS_DIR, relativePath);
        await downloadFile(obj.Key, destPath);
      }
      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);
    logger.info("Uploads restored");
  } catch (err) {
    logger.error({ err }, "Error restoring uploads");
  }
}

async function syncDatabase() {
  if (!fs.existsSync(DB_PATH)) return;

  const snapshotPath = `${DB_PATH}.s3backup`;
  try {
    const db = new Database(DB_PATH, { readonly: true, timeout: 5000 });
    db.pragma("journal_mode=WAL");
    await db.backup(snapshotPath);
    db.close();

    if (!fs.existsSync(snapshotPath)) {
      logger.error("Backup file was not created");
      return;
    }

    const hash = fileHash(snapshotPath);
    if (hash === lastDbHash) {
      fs.unlinkSync(snapshotPath);
      return;
    }

    await uploadFile(snapshotPath, DB_KEY);
    fs.unlinkSync(snapshotPath);
    lastDbHash = hash;
    saveManifest();
    logger.info("Database synced to S3");
  } catch (err) {
    logger.error({ err }, "Database sync error");
    try { fs.unlinkSync(snapshotPath); } catch {}
  }
}

async function syncUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) return;

  const walk = (dir) => {
    const entries = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) entries.push(...walk(full));
      else entries.push(full);
    }
    return entries;
  };

  const files = walk(UPLOADS_DIR);
  let uploaded = 0;

  for (const filePath of files) {
    const relativePath = path.relative(UPLOADS_DIR, filePath);
    const stat = fs.statSync(filePath);
    const mtimeMs = stat.mtimeMs;
    const size = stat.size;

    const cached = uploadManifest[relativePath];
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      continue;
    }

    const key = `${UPLOADS_PREFIX}${relativePath}`;
    try {
      await uploadFile(filePath, key);
      uploadManifest[relativePath] = { mtimeMs, size };
      uploaded++;
    } catch (err) {
      logger.error({ err, file: relativePath }, "Upload sync error");
    }
  }

  if (uploaded > 0) {
    saveManifest();
    logger.info({ count: uploaded }, "Synced changed uploads to S3");
  }
}

async function fullSync() {
  await syncDatabase();
  await syncUploads();
}

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutdown signal received, running final sync...");
  try {
    await fullSync();
    logger.info("Final sync complete");
  } catch (err) {
    logger.error({ err }, "Final sync error");
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function main() {
  const mode = process.argv[2];

  if (mode === "--restore") {
    await restore();
    return;
  }

  loadManifest();
  logger.info({ intervalSeconds: SYNC_INTERVAL / 1000 }, "Starting periodic sync");
  const tick = async () => {
    if (shuttingDown) return;
    try {
      await fullSync();
    } catch (err) {
      logger.error({ err }, "Sync error");
    }
  };

  setInterval(tick, SYNC_INTERVAL);
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
