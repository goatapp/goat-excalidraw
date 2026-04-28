/**
 * Test utilities for backend integration tests
 */
import { PrismaClient } from "../generated/client/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_PATH = path.resolve(__dirname, "../../prisma", "test.db");
const DB_PUSH_LOCK_PATH = path.resolve(__dirname, "../../prisma/.test-db-push.lock");
let dbPushed = false;

const sleepSync = (ms: number) => {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
};

const withDbPushLock = (fn: () => void) => {
  const start = Date.now();
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = fs.openSync(DB_PUSH_LOCK_PATH, "wx");
      fs.writeFileSync(fd, String(process.pid));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw error;
      if (Date.now() - start > 30_000) {
        throw new Error("Timed out waiting for Prisma db push lock");
      }
      sleepSync(50);
    }
  }

  try {
    fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
    }
    try {
      fs.unlinkSync(DB_PUSH_LOCK_PATH);
    } catch {
    }
  }
};

/**
 * Get a test Prisma client pointing to the test database
 */
export const getTestPrisma = () => {
  const databaseUrl = `file:${TEST_DB_PATH}`;
  process.env.DATABASE_URL = databaseUrl;
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
};

/**
 * Setup the test database by running migrations
 */
export const setupTestDb = () => {
  const databaseUrl = `file:${TEST_DB_PATH}`;
  process.env.DATABASE_URL = databaseUrl;

  if (dbPushed) return;

  try {
    withDbPushLock(() => {
      const cleanEnv = { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" };
      delete cleanEnv.CLAUDECODE;
      delete cleanEnv.AI_AGENT;
      delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
      execSync("npx prisma db push --force-reset", {
        cwd: path.resolve(__dirname, "../../"),
        env: cleanEnv,
        stdio: "pipe",
      });
    });
    dbPushed = true;
  } catch (error) {
    console.error("Failed to setup test database:", error);
    throw error;
  }
};

export const resetTestDb = async (prisma: PrismaClient) => {
  await prisma.drawingSnapshot.deleteMany({});
  await prisma.drawingLinkShare.deleteMany({});
  await prisma.drawingPermission.deleteMany({});
  await prisma.drawing.deleteMany({});
  await prisma.collection.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.authIdentity.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.library.deleteMany({});
  await prisma.systemConfig.deleteMany({});
};

/**
 * Clean up the test database between tests
 */
export const cleanupTestDb = async (prisma: PrismaClient) => {
  await prisma.drawing.deleteMany({});
  await prisma.collection.deleteMany({});
};

/**
 * Create a test user for testing
 */
export const createTestUser = async (prisma: PrismaClient, email: string = "test@example.com") => {
  const passwordHash = await bcrypt.hash("testpassword", 10);

  return await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: "Test User",
    },
  });
};

/**
 * Initialize test database with required data
 */
export const initTestDb = async (prisma: PrismaClient) => {
  const testUser = await createTestUser(prisma);
  const trashCollectionId = `trash:${testUser.id}`;

  const trash = await prisma.collection.findFirst({
    where: { id: trashCollectionId, userId: testUser.id },
  });
  if (!trash) {
    await prisma.collection.create({
      data: { id: trashCollectionId, name: "Trash", userId: testUser.id },
    });
  }

  return testUser;
};

/**
 * Generate a sample base64 PNG image data URL
 * This creates a small but valid PNG for testing
 */
export const generateSampleImageDataUrl = (size: "small" | "medium" | "large" = "small"): string => {
  const smallPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

  if (size === "small") {
    return `data:image/png;base64,${smallPng}`;
  }

  const repetitions = size === "medium" ? 1000 : 10000;
  const paddedBase64 = smallPng.repeat(repetitions);

  return `data:image/png;base64,${paddedBase64}`;
};

/**
 * Generate a large image data URL that exceeds the 10000 char limit
 */
export const generateLargeImageDataUrl = (): string => {
  const baseImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const largeBase64 = baseImage.repeat(500);
  return `data:image/png;base64,${largeBase64}`;
};

/**
 * Create a sample Excalidraw files object with embedded images
 */
export const createSampleFilesObject = (imageCount: number = 1, size: "small" | "large" = "small") => {
  const files: Record<string, any> = {};

  for (let i = 0; i < imageCount; i++) {
    const fileId = `file-${i}-${Date.now()}`;
    files[fileId] = {
      id: fileId,
      mimeType: "image/png",
      dataURL: size === "large" ? generateLargeImageDataUrl() : generateSampleImageDataUrl("small"),
      created: Date.now(),
      lastRetrieved: Date.now(),
    };
  }

  return files;
};

/**
 * Create a minimal valid Excalidraw drawing payload
 */
export const createTestDrawingPayload = (options: {
  name?: string;
  files?: Record<string, any> | null;
  elements?: any[];
  appState?: any;
} = {}) => {
  return {
    name: options.name ?? "Test Drawing",
    elements: options.elements ?? [
      {
        id: "element-1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        angle: 0,
        strokeColor: "#000000",
        backgroundColor: "transparent",
        fillStyle: "hachure",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 12345,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      },
    ],
    appState: options.appState ?? {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
    files: options.files ?? null,
    preview: null,
    collectionId: null,
  };
};

/**
 * Compare two files objects to check if image data was preserved
 */
export const compareFilesObjects = (original: Record<string, any>, received: Record<string, any>): {
  isEqual: boolean;
  differences: string[];
} => {
  const differences: string[] = [];

  const originalKeys = Object.keys(original);
  const receivedKeys = Object.keys(received);

  if (originalKeys.length !== receivedKeys.length) {
    differences.push(`Key count mismatch: original=${originalKeys.length}, received=${receivedKeys.length}`);
  }

  for (const key of originalKeys) {
    if (!(key in received)) {
      differences.push(`Missing key: ${key}`);
      continue;
    }

    const origFile = original[key];
    const recvFile = received[key];

    if (origFile.dataURL !== recvFile.dataURL) {
      differences.push(
        `DataURL mismatch for ${key}: ` +
        `original length=${origFile.dataURL?.length ?? 0}, ` +
        `received length=${recvFile.dataURL?.length ?? 0}`
      );

      if (recvFile.dataURL && origFile.dataURL?.startsWith(recvFile.dataURL.substring(0, 100))) {
        differences.push(`TRUNCATION DETECTED: dataURL was cut short`);
      }
    }
  }

  return {
    isEqual: differences.length === 0,
    differences,
  };
};
