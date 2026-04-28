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

const BUCKET = process.env.S3_BUCKET_NAME;
const PREFIX = process.env.S3_PREFIX || "excalidraw/";
const SYNC_INTERVAL = parseInt(process.env.S3_SYNC_INTERVAL_MS || "300000", 10);
const DB_PATH = "/app/prisma/dev.db";
const UPLOADS_DIR = "/app/uploads";
const DB_KEY = `${PREFIX}dev.db`;
const UPLOADS_PREFIX = `${PREFIX}uploads/`;
const MANIFEST_PATH = "/app/prisma/.s3-sync-manifest.json";

if (!BUCKET) {
  console.error("[s3-sync] S3_BUCKET_NAME not set, exiting");
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
    console.error("[s3-sync] Failed to save manifest:", err.message);
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
    console.log("[s3-sync] Local database exists, skipping restore");
    return;
  }

  console.log("[s3-sync] Restoring database from S3...");
  try {
    await downloadFile(DB_KEY, DB_PATH);
    console.log("[s3-sync] Database restored");
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      console.log("[s3-sync] No database backup found in S3, starting fresh");
    } else {
      throw err;
    }
  }

  console.log("[s3-sync] Restoring uploads from S3...");
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
    console.log("[s3-sync] Uploads restored");
  } catch (err) {
    console.error("[s3-sync] Error restoring uploads:", err.message);
  }
}

async function syncDatabase() {
  if (!fs.existsSync(DB_PATH)) return;

  const snapshotPath = `${DB_PATH}.s3backup`;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    await db.backup(snapshotPath);
    db.close();

    const hash = fileHash(snapshotPath);
    if (hash === lastDbHash) {
      fs.unlinkSync(snapshotPath);
      return;
    }

    await uploadFile(snapshotPath, DB_KEY);
    fs.unlinkSync(snapshotPath);
    lastDbHash = hash;
    saveManifest();
    console.log("[s3-sync] Database synced to S3");
  } catch (err) {
    console.error("[s3-sync] Database sync error:", err.message);
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
      console.error(`[s3-sync] Upload sync error for ${relativePath}:`, err.message);
    }
  }

  if (uploaded > 0) {
    saveManifest();
    console.log(`[s3-sync] Synced ${uploaded} changed upload(s) to S3`);
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
  console.log("[s3-sync] Shutdown signal received, running final sync...");
  try {
    await fullSync();
    console.log("[s3-sync] Final sync complete");
  } catch (err) {
    console.error("[s3-sync] Final sync error:", err.message);
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
  console.log(`[s3-sync] Starting periodic sync every ${SYNC_INTERVAL / 1000}s`);
  const tick = async () => {
    if (shuttingDown) return;
    try {
      await fullSync();
    } catch (err) {
      console.error("[s3-sync] Sync error:", err.message);
    }
  };

  setInterval(tick, SYNC_INTERVAL);
}

main().catch((err) => {
  console.error("[s3-sync] Fatal error:", err);
  process.exit(1);
});
