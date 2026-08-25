import { describe, expect, it, vi, beforeEach } from "vitest";
import { reconcileRemoteScene } from "./reconcileRemoteScene";

vi.mock("../../api", () => ({
  getDrawing: vi.fn(),
}));

import * as api from "../../api";

const mockGetDrawing = api.getDrawing as ReturnType<typeof vi.fn>;

const localElement = { id: "local-1", version: 4, versionNonce: 1, updated: 10 };
const remoteElement = { id: "remote-1", version: 2, versionNonce: 2, updated: 20 };

function createDeps(overrides: Record<string, any> = {}) {
  const updateScene = vi.fn();
  const addFiles = vi.fn();
  return {
    drawingId: "drawing-1",
    getAPI: vi.fn(() => ({ updateScene, addFiles })),
    currentDrawingVersionRef: { current: 5 },
    latestElementsRef: { current: [localElement] as readonly any[] },
    latestFilesRef: { current: {} as Record<string, any> },
    lastSyncedFilesRef: { current: {} as Record<string, any> },
    lastPersistedFilesRef: { current: {} as Record<string, any> },
    lastSyncedElementOrderSigRef: { current: "" },
    recordElementVersion: vi.fn(),
    computeElementOrderSig: vi.fn(() => "order-sig"),
    resolveS3Files: vi.fn(async (files: Record<string, any>) => files),
    // exposed for assertions
    _updateScene: updateScene,
    ...overrides,
  };
}

describe("reconcileRemoteScene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges the server scene with the local scene", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [remoteElement],
      files: {},
      version: 9,
    });
    const deps = createDeps();

    const result = await reconcileRemoteScene(deps);

    expect(mockGetDrawing).toHaveBeenCalledWith("drawing-1");
    expect(result.elements.map((el: any) => el.id)).toEqual(["local-1", "remote-1"]);
  });

  it("keeps the local edit when it is newer than the server element", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [{ id: "local-1", version: 2, versionNonce: 9, updated: 5 }],
      files: {},
      version: 9,
    });
    const deps = createDeps();

    const result = await reconcileRemoteScene(deps);

    expect(result.elements).toEqual([localElement]);
  });

  it("takes the server edit when it is newer than the local element", async () => {
    const newerRemote = { id: "local-1", version: 7, versionNonce: 9, updated: 30 };
    mockGetDrawing.mockResolvedValue({
      elements: [newerRemote],
      files: {},
      version: 9,
    });
    const deps = createDeps();

    const result = await reconcileRemoteScene(deps);

    expect(result.elements).toEqual([newerRemote]);
  });

  it("pushes the merged scene into the live editor", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [remoteElement],
      files: {},
      version: 9,
    });
    const deps = createDeps();

    await reconcileRemoteScene(deps);

    expect(deps._updateScene).toHaveBeenCalledTimes(1);
    const sceneUpdate = deps._updateScene.mock.calls[0][0];
    expect(sceneUpdate.elements.map((el: any) => el.id)).toEqual(["local-1", "remote-1"]);
    expect(sceneUpdate.captureUpdate).toBe("NEVER");
  });

  it("adopts the authoritative server version", async () => {
    mockGetDrawing.mockResolvedValue({ elements: [], files: {}, version: 42 });
    const deps = createDeps();

    await reconcileRemoteScene(deps);

    expect(deps.currentDrawingVersionRef.current).toBe(42);
  });

  it("resolves S3 file references before merging files", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [],
      files: { remoteFile: { id: "remoteFile", dataURL: "s3://key" } },
      version: 9,
    });
    const deps = createDeps({
      latestFilesRef: { current: { localFile: { id: "localFile" } } },
      lastSyncedFilesRef: { current: { localFile: { id: "localFile" } } },
      resolveS3Files: vi.fn(async () => ({
        remoteFile: { id: "remoteFile", dataURL: "https://cdn/remote.png" },
      })),
    });

    const result = await reconcileRemoteScene(deps);

    expect(deps.resolveS3Files).toHaveBeenCalledWith({
      remoteFile: { id: "remoteFile", dataURL: "s3://key" },
    });
    expect(result.files).toEqual({
      localFile: { id: "localFile" },
      remoteFile: { id: "remoteFile", dataURL: "https://cdn/remote.png" },
    });
  });

  it("records the merged scene in the editor refs", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [remoteElement],
      files: { remoteFile: { id: "remoteFile" } },
      version: 9,
    });
    const deps = createDeps();

    const result = await reconcileRemoteScene(deps);

    expect(deps.latestElementsRef.current).toBe(result.elements);
    expect(deps.latestFilesRef.current).toEqual(result.files);
    expect(deps.lastSyncedFilesRef.current).toEqual(result.files);
    expect(deps.lastSyncedElementOrderSigRef.current).toBe("order-sig");
    expect(deps.recordElementVersion).toHaveBeenCalledTimes(result.elements.length);
  });

  it("does not mark merged files as already persisted", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [],
      files: { remoteFile: { id: "remoteFile" } },
      version: 9,
    });
    const deps = createDeps();

    await reconcileRemoteScene(deps);

    expect(deps.lastPersistedFilesRef.current).toEqual({});
  });

  it("survives a missing editor instance", async () => {
    mockGetDrawing.mockResolvedValue({
      elements: [remoteElement],
      files: {},
      version: 9,
    });
    const deps = createDeps({ getAPI: vi.fn(() => null) });

    const result = await reconcileRemoteScene(deps);

    expect(result.elements.map((el: any) => el.id)).toEqual(["local-1", "remote-1"]);
  });
});
