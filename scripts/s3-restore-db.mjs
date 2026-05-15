#!/usr/bin/env node

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

const BUCKET = process.env.S3_BUCKET_NAME;
const PREFIX = process.env.S3_PREFIX || "excalidraw/";
const DB_KEY = `${PREFIX}dev.db`;
const DEST_PATH = "/tmp/migrate-source.db";

if (!BUCKET) {
  console.error("S3_BUCKET_NAME not set");
  process.exit(1);
}

const s3 = new S3Client({
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

try {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: DB_KEY }));
  const dir = path.dirname(DEST_PATH);
  fs.mkdirSync(dir, { recursive: true });
  await pipeline(resp.Body, fs.createWriteStream(DEST_PATH));
  console.log(`Downloaded ${DB_KEY} to ${DEST_PATH}`);
} catch (err) {
  if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
    console.error(`No database backup found at s3://${BUCKET}/${DB_KEY}`);
    process.exit(1);
  }
  throw err;
}
