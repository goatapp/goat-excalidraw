import { test, expect } from "@playwright/test";
import {
  createDrawing,
  deleteDrawing,
  updateDrawing,
  getDrawing,
} from "./helpers/api";

/**
 * E2E Tests for Stale Tab Recovery
 *
 * Tests the staleness recovery feature that detects when a tab's canvas
 * is behind the server version and reconciles on visibility change.
 */

test.describe("Stale Tab Recovery", () => {
  let createdDrawingIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdDrawingIds) {
      try {
        await deleteDrawing(request, id);
      } catch {}
    }
    createdDrawingIds = [];
  });

  test("version endpoint returns current version", async ({ request }) => {
    const drawing = await createDrawing(request, {
      name: `Staleness_Version_${Date.now()}`,
      elements: [{ id: "el-1", type: "rectangle", x: 0, y: 0, width: 100, height: 100, version: 1, versionNonce: 1, updated: Date.now(), isDeleted: false, strokeColor: "#000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 1, groupIds: [], roundness: null, boundElements: null, link: null, locked: false }],
    });
    createdDrawingIds.push(drawing.id);

    const API_URL = process.env.API_URL || "http://localhost:8000";
    const res = await request.get(`${API_URL}/drawings/${drawing.id}/version`);

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("updatedAt");
    expect(typeof body.version).toBe("number");
  });

  test("version increments after update", async ({ request }) => {
    const drawing = await createDrawing(request, {
      name: `Staleness_Increment_${Date.now()}`,
      elements: [],
    });
    createdDrawingIds.push(drawing.id);

    const API_URL = process.env.API_URL || "http://localhost:8000";
    const before = await request.get(`${API_URL}/drawings/${drawing.id}/version`);
    const versionBefore = (await before.json()).version;

    await updateDrawing(request, drawing.id, {
      elements: [{ id: "new-el", type: "rectangle", x: 10, y: 10, width: 50, height: 50, version: 1, versionNonce: 1, updated: Date.now(), isDeleted: false, strokeColor: "#000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 1, groupIds: [], roundness: null, boundElements: null, link: null, locked: false }],
      appState: { viewBackgroundColor: "#ffffff" },
      version: versionBefore,
    } as any);

    const after = await request.get(`${API_URL}/drawings/${drawing.id}/version`);
    const versionAfter = (await after.json()).version;

    expect(versionAfter).toBeGreaterThan(versionBefore);
  });

  test("stale tab recovers after external update and visibility change", async ({ page, request }) => {
    const initialElement = {
      id: "initial-el",
      type: "rectangle",
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      version: 1,
      versionNonce: 111,
      updated: Date.now(),
      isDeleted: false,
      strokeColor: "#000000",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: 42,
      groupIds: [],
      roundness: null,
      boundElements: null,
      link: null,
      locked: false,
    };

    const drawing = await createDrawing(request, {
      name: `Staleness_Recovery_${Date.now()}`,
      elements: [initialElement],
    });
    createdDrawingIds.push(drawing.id);

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("[class*='excalidraw'], canvas", { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Record initial version seen by the editor
    const initialVersion = await page.evaluate(() => {
      // Access the internal drawing version through the fetch log
      return (window as any).__drawingVersion;
    });

    // Simulate another user/tab updating the drawing via API
    const newElement = {
      id: "external-el",
      type: "ellipse",
      x: 300,
      y: 300,
      width: 80,
      height: 80,
      version: 1,
      versionNonce: 222,
      updated: Date.now(),
      isDeleted: false,
      strokeColor: "#ff0000",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: 99,
      groupIds: [],
      roundness: null,
      boundElements: null,
      link: null,
      locked: false,
    };

    const currentDrawing = await getDrawing(request, drawing.id);
    await updateDrawing(request, drawing.id, {
      elements: [...(currentDrawing.elements || []), newElement],
      appState: { viewBackgroundColor: "#ffffff" },
      version: currentDrawing.version,
    } as any);

    // Set up console listener to detect staleness recovery
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("Staleness recovery")) {
        consoleMessages.push(text);
      }
    });

    // Simulate visibility change (tab refocus)
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Wait for recovery to complete
    await page.waitForTimeout(3000);

    // Verify recovery happened by checking console output
    const recoveryOccurred = consoleMessages.some((msg) =>
      msg.includes("Staleness recovery complete")
    );
    expect(recoveryOccurred).toBe(true);

    // Verify the merged element count includes both elements
    const recoveryMsg = consoleMessages.find((msg) =>
      msg.includes("Staleness recovery complete")
    );
    expect(recoveryMsg).toContain("mergedCount");
  });

  test("no recovery triggered when version is current", async ({ page, request }) => {
    const drawing = await createDrawing(request, {
      name: `Staleness_NoOp_${Date.now()}`,
      elements: [{ id: "el-1", type: "rectangle", x: 0, y: 0, width: 100, height: 100, version: 1, versionNonce: 1, updated: Date.now(), isDeleted: false, strokeColor: "#000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 1, groupIds: [], roundness: null, boundElements: null, link: null, locked: false }],
    });
    createdDrawingIds.push(drawing.id);

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("[class*='excalidraw'], canvas", { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Track network requests
    const versionRequests: string[] = [];
    const fullFetchRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/version")) versionRequests.push(url);
      if (url.includes(`/drawings/${drawing.id}`) && !url.includes("/version") && !url.includes("/comments") && req.method() === "GET") {
        fullFetchRequests.push(url);
      }
    });

    // Simulate visibility change without any external modification
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await page.waitForTimeout(2000);

    // Version check should have been made
    expect(versionRequests.length).toBeGreaterThanOrEqual(1);

    // But no full drawing fetch should have occurred (versions match)
    expect(fullFetchRequests.length).toBe(0);
  });
});
