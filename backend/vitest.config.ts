import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: "./vitest.globalSetup.ts",
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/excalidash_test",
      NODE_ENV: "test",
      AUTH_MODE: "local",
      ENABLE_AUDIT_LOGGING: "true",
    },
    pool: "forks",
    fileParallelism: false,
  },
});
