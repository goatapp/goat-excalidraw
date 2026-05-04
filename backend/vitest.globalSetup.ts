import { execSync } from "child_process";
import { unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function setup() {
  const dbPath = path.resolve(__dirname, "prisma/test.db");
  const databaseUrl = `file:${dbPath}`;

  try { unlinkSync(dbPath); } catch {}

  const cleanEnv: Record<string, string | undefined> = { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" };
  for (const key of Object.keys(cleanEnv)) {
    if (/^(CLAUDE|AI_AGENT|ANTHROPIC)/i.test(key)) {
      delete cleanEnv[key];
    }
  }
  execSync("npx prisma db push --force-reset", {
    cwd: __dirname,
    env: cleanEnv,
    stdio: "pipe",
  });
}
