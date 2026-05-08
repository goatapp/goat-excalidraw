import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStalenessRecovery } from "./useStalenessRecovery";

vi.mock("../../api", () => ({
  getDrawingVersion: vi.fn(),
  getDrawing: vi.fn(),
}));

vi.mock("../../utils/sync", () => ({
  reconcileElements: vi.fn((local, remote) => [...local, ...remote]),
}));

vi.mock("./shared", () => ({
  buildRemoteSceneUpdate: vi.fn(() => ({
    sceneUpdate: { elements: [], captureUpdate: "NEVER" },
    mergedElements: null,
    nextFiles: {},
    shouldUpdateFiles: false,
  })),
}));

import * as api from "../../api";
import { reconcileElements } from "../../utils/sync";
import { buildRemoteSceneUpdate } from "./shared";

const mockGetDrawingVersion = api.getDrawingVersion as ReturnType<typeof vi.fn>;
const mockGetDrawing = api.getDrawing as ReturnType<typeof vi.fn>;
const mockReconcileElements = reconcileElements as ReturnType<typeof vi.fn>;
const mockBuildRemoteSceneUpdate = buildRemoteSceneUpdate as ReturnType<typeof vi.fn>;

function createDeps(overrides: Partial<Parameters<typeof useStalenessRecovery>[0]> = {}) {
  return {
    drawingId: "drawing-1",
    currentDrawingVersionRef: { current: 5 },
    getAPI: vi.fn(() => ({ updateScene: vi.fn(), isDestroyed: false })),
    latestElementsRef: { current: [{ id: "el-1", version: 2 }] as readonly any[] },
    latestFilesRef: { current: {} as any },
    lastSyncedFilesRef: { current: {} as Record<string, any> },
    lastPersistedFilesRef: { current: {} as Record<string, any> },
    lastSyncedElementOrderSigRef: { current: "" },
    recordElementVersion: vi.fn(),
    computeElementOrderSig: vi.fn(() => "sig"),
    resolveS3Files: vi.fn(async (f: any) => f),
    hasHydratedInitialScene: { current: true },
    ...overrides,
  };
}

function dispatchVisible() {
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useStalenessRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing if versions match (no-op fast path)", async () => {
    mockGetDrawingVersion.mockResolvedValue({ version: 5, updatedAt: "2026-01-01" });
    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await waitFor(() => {
      expect(mockGetDrawingVersion).toHaveBeenCalledWith("drawing-1");
    });
    expect(mockGetDrawing).not.toHaveBeenCalled();
  });

  it("fetches and reconciles when server version is ahead", async () => {
    mockGetDrawingVersion.mockResolvedValue({ version: 8, updatedAt: "2026-01-01" });
    mockGetDrawing.mockResolvedValue({
      elements: [{ id: "el-2", version: 3 }],
      files: {},
      version: 8,
    });
    const merged = [{ id: "el-1", version: 2 }, { id: "el-2", version: 3 }];
    mockBuildRemoteSceneUpdate.mockReturnValue({
      sceneUpdate: { elements: merged, captureUpdate: "NEVER" },
      mergedElements: merged,
      nextFiles: {},
      shouldUpdateFiles: false,
    });

    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await waitFor(() => {
      expect(mockGetDrawing).toHaveBeenCalledWith("drawing-1");
    });

    expect(deps.currentDrawingVersionRef.current).toBe(8);
    expect(deps.latestElementsRef.current).toEqual(merged);
    expect(deps.recordElementVersion).toHaveBeenCalledTimes(merged.length);
    expect(deps.computeElementOrderSig).toHaveBeenCalledWith(merged);
  });

  it("updates the excalidraw scene when API is available", async () => {
    mockGetDrawingVersion.mockResolvedValue({ version: 6, updatedAt: "2026-01-01" });
    mockGetDrawing.mockResolvedValue({ elements: [], files: {}, version: 6 });
    const sceneUpdate = { elements: [], captureUpdate: "NEVER" };
    mockBuildRemoteSceneUpdate.mockReturnValue({
      sceneUpdate,
      mergedElements: [],
      nextFiles: {},
      shouldUpdateFiles: false,
    });

    const mockUpdateScene = vi.fn();
    const deps = createDeps({
      getAPI: vi.fn(() => ({ updateScene: mockUpdateScene, isDestroyed: false })),
    });

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await waitFor(() => {
      expect(mockUpdateScene).toHaveBeenCalledWith(sceneUpdate);
    });
  });

  it("does nothing when tab is not visible", async () => {
    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Give it a tick to ensure nothing fires
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetDrawingVersion).not.toHaveBeenCalled();
  });

  it("does nothing before initial hydration", async () => {
    const deps = createDeps({ hasHydratedInitialScene: { current: false } });

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetDrawingVersion).not.toHaveBeenCalled();
  });

  it("does nothing when drawingId is undefined", async () => {
    const deps = createDeps({ drawingId: undefined });

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetDrawingVersion).not.toHaveBeenCalled();
  });

  it("respects cooldown between rapid visibility changes", async () => {
    mockGetDrawingVersion.mockResolvedValue({ version: 5, updatedAt: "2026-01-01" });
    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await waitFor(() => {
      expect(mockGetDrawingVersion).toHaveBeenCalledTimes(1);
    });

    mockGetDrawingVersion.mockClear();

    // Immediately dispatch again — should be blocked by cooldown
    await act(async () => {
      dispatchVisible();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetDrawingVersion).not.toHaveBeenCalled();
  });

  it("gracefully handles network errors without crashing", async () => {
    mockGetDrawingVersion.mockRejectedValue(new Error("Network error"));
    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await new Promise((r) => setTimeout(r, 50));
    // Should not throw, just log a warning
    expect(mockGetDrawing).not.toHaveBeenCalled();
  });

  it("returns triggerStalenessRecovery for manual invocation", async () => {
    mockGetDrawingVersion.mockResolvedValue({ version: 5, updatedAt: "2026-01-01" });
    const deps = createDeps();

    const { result } = renderHook(() => useStalenessRecovery(deps));

    expect(result.current.triggerStalenessRecovery).toBeInstanceOf(Function);

    await act(async () => {
      await result.current.triggerStalenessRecovery();
    });

    expect(mockGetDrawingVersion).toHaveBeenCalledWith("drawing-1");
  });

  it("updates file refs after successful recovery", async () => {
    const remoteFiles = { "file-1": { dataURL: "data:image/png;base64,abc", mimeType: "image/png" } };
    mockGetDrawingVersion.mockResolvedValue({ version: 7, updatedAt: "2026-01-01" });
    mockGetDrawing.mockResolvedValue({ elements: [], files: remoteFiles, version: 7 });
    mockBuildRemoteSceneUpdate.mockReturnValue({
      sceneUpdate: null,
      mergedElements: null,
      nextFiles: remoteFiles,
      shouldUpdateFiles: true,
    });
    mockReconcileElements.mockReturnValue([]);

    const deps = createDeps();
    deps.resolveS3Files.mockResolvedValue(remoteFiles);

    renderHook(() => useStalenessRecovery(deps));

    await act(async () => {
      dispatchVisible();
    });

    await waitFor(() => {
      expect(deps.latestFilesRef.current).toEqual(remoteFiles);
    });

    expect(deps.lastSyncedFilesRef.current).toEqual(remoteFiles);
    expect(deps.lastPersistedFilesRef.current).toEqual(remoteFiles);
  });

  it("fires on heartbeat interval when tab is visible", async () => {
    vi.useFakeTimers();
    mockGetDrawingVersion.mockResolvedValue({ version: 5, updatedAt: "2026-01-01" });
    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));

    // Clear calls from any initial setup
    mockGetDrawingVersion.mockClear();

    // Advance past the heartbeat interval
    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });

    expect(mockGetDrawingVersion).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not fire heartbeat when tab is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    mockGetDrawingVersion.mockResolvedValue({ version: 5, updatedAt: "2026-01-01" });
    const deps = createDeps();

    renderHook(() => useStalenessRecovery(deps));
    mockGetDrawingVersion.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });

    expect(mockGetDrawingVersion).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
