import { test, expect } from "@playwright/test";

/**
 * E2E Tests for Theme Toggle functionality
 * 
 * Tests the dark/light theme feature:
 * - Toggle theme via Settings page
 * - Theme persists across page reloads
 * - Theme applies to all pages
 */

test.describe("Theme Toggle", () => {
  test("should toggle theme from Settings page", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const themeButton = page.getByRole("button", { name: /Dark Mode|Light Mode/i });
    await expect(themeButton).toBeVisible();

    const html = page.locator("html");
    const initialDark = await html.evaluate((el) => el.classList.contains("dark"));

    await themeButton.click();
    await page.waitForTimeout(500);

    const newDark = await html.evaluate((el) => el.classList.contains("dark"));
    expect(newDark).toBe(!initialDark);

    if (initialDark) {
      await expect(themeButton).toContainText("Dark Mode");
    } else {
      await expect(themeButton).toContainText("Light Mode");
    }
  });

  test("should persist theme across page navigation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    const themeButton = page.getByRole("button", { name: /Dark Mode|Light Mode/i });
    await expect(themeButton).toBeVisible({ timeout: 15000 });

    const isDark = await html.evaluate((el) => el.classList.contains("dark"));
    if (!isDark) {
      await themeButton.click();
      await page.waitForTimeout(500);
    }

    await expect(html).toHaveClass(/dark/);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(html).toHaveClass(/dark/);

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(html).toHaveClass(/dark/);

    const lightButton = page.getByRole("button", { name: /Light Mode/i });
    if (await lightButton.isVisible()) {
      await lightButton.click();
    }
  });

  test("should persist theme across page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    const themeButton = page.getByRole("button", { name: /Dark Mode|Light Mode/i });
    await expect(themeButton).toBeVisible({ timeout: 15000 });

    const initialDark = await html.evaluate((el) => el.classList.contains("dark"));
    if (!initialDark) {
      await themeButton.click();
      await page.waitForTimeout(500);
    }

    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(html).toHaveClass(/dark/);
  });
});
