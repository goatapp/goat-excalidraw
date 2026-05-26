import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:6767",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI ? [
    {
      command: "cd ../backend && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/excalidash_test npm run dev",
      url: "http://localhost:8000/health",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:6767",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ] : undefined,
});
