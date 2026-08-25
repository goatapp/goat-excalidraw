import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnloadSave } from "./useUnloadSave";

vi.mock("./keepaliveSave", () => ({
  saveDrawingKeepalive: vi.fn(() => true),
}));

import { saveDrawingKeepalive } from "./keepaliveSave";

const mockKeepalive = saveDrawingKeepalive as ReturnType<typeof vi.fn>;

const persistedElement = { id: "el-1", version: 2, versionNonce: 5, updated: 10 };
const editedElement = { id: "el-1", version: 3, versionNonce: 6, updated: 20 };

function createDeps(overrides: Record<string, any> = {}) {
  return {
    drawingId: "drawing-1",
    latestElementsRef: { current: [editedElement] as readonly any[] },
    latestAppStateRef: { current: { viewBackgroundColor: "#fff", gridSize: null, zoom: 3 } },
    lastPersistedElementsRef: { current: [persistedElement] as readonly any[] },
    currentDrawingVersionRef: { current: 7 },
    ...overrides,
  };
}

const dispatchPagehide = () => window.dispatchEvent(new Event("pagehide"));

describe("useUnloadSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeepalive.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes unsaved edits when the page is being discarded", () => {
    const deps = createDeps();
    renderHook(() => useUnloadSave(deps));

    dispatchPagehide();

    expect(mockKeepalive).toHaveBeenCalledTimes(1);
    expect(mockKeepalive.mock.calls[0][0]).toBe("drawing-1");
    expect(mockKeepalive.mock.calls[0][1].elements).toEqual([editedElement]);
  });

  it("sends the persistable app state and the current version", () => {
    const deps = createDeps();
    renderHook(() => useUnloadSave(deps));

    dispatchPagehide();

    const body = mockKeepalive.mock.calls[0][1];
    expect(body.version).toBe(7);
    expect(body.appState).toEqual({ viewBackgroundColor: "#fff", gridSize: null });
  });

  it("does not send files, which would blow the keepalive body limit", () => {
    const deps = createDeps();
    renderHook(() => useUnloadSave(deps));

    dispatchPagehide();

    expect(mockKeepalive.mock.calls[0][1]).not.toHaveProperty("files");
  });

  it("skips the save when the scene is already persisted", () => {
    const deps = createDeps({
      latestElementsRef: { current: [persistedElement] as readonly any[] },
    });
    renderHook(() => useUnloadSave(deps));

    dispatchPagehide();

    expect(mockKeepalive).not.toHaveBeenCalled();
  });

  it("skips the save without a drawing id", () => {
    const deps = createDeps({ drawingId: undefined });
    renderHook(() => useUnloadSave(deps));

    dispatchPagehide();

    expect(mockKeepalive).not.toHaveBeenCalled();
  });

  it("warns when the scene could not be dispatched", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockKeepalive.mockReturnValue(false);
    renderHook(() => useUnloadSave(createDeps()));

    dispatchPagehide();

    expect(warn).toHaveBeenCalled();
  });

  it("stops listening once the editor unmounts", () => {
    const { unmount } = renderHook(() => useUnloadSave(createDeps()));

    unmount();
    dispatchPagehide();

    expect(mockKeepalive).not.toHaveBeenCalled();
  });
});
