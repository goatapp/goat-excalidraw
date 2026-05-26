import { execSync } from "child_process";

export default function setup() {
  const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/excalidash_test";

  const cleanEnv: Record<string, string | undefined> = { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" };
  for (const key of Object.keys(cleanEnv)) {
    if (/^(CLAUDE|AI_AGENT|ANTHROPIC)/i.test(key)) {
      delete cleanEnv[key];
    }
  }
  execSync("npx prisma db push --force-reset", {
    cwd: import.meta.dirname,
    env: cleanEnv,
    stdio: "pipe",
  });
}
