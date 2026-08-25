import type { MutableRefObject } from "react";
import * as api from "../../api";
import { reconcileElements } from "../../utils/sync";
import { buildRemoteSceneUpdate } from "./shared";

export interface ReconcileRemoteSceneDeps {
  drawingId: string;
  getAPI: () => any | null;
  currentDrawingVersionRef: MutableRefObject<number | null>;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestFilesRef: MutableRefObject<Record<string, any>>;
  lastSyncedFilesRef: MutableRefObject<Record<string, any>>;
  lastSyncedElementOrderSigRef: MutableRefObject<string>;
  recordElementVersion: (element: any) => void;
  computeElementOrderSig: (elements: readonly any[]) => string;
  resolveS3Files: (files: Record<string, any>) => Promise<Record<string, any>>;
}

/**
 * Re-reads the authoritative server scene, merges it into the local scene, and
 * pushes the result into the live editor so what the user sees matches what
 * will be saved next.
 *
 * Shared by the visibility/heartbeat staleness recovery and the save
 * version-conflict path. Deliberately does *not* touch
 * `lastPersistedFilesRef`: local files may still be unsaved, and marking them
 * persisted here would drop them from the next save payload. Callers that know
 * the merged files are already on the server update that ref themselves.
 */
export const reconcileRemoteScene = async ({
  drawingId,
  getAPI,
  currentDrawingVersionRef,
  latestElementsRef,
  latestFilesRef,
  lastSyncedFilesRef,
  lastSyncedElementOrderSigRef,
  recordElementVersion,
  computeElementOrderSig,
  resolveS3Files,
}: ReconcileRemoteSceneDeps): Promise<{
  elements: readonly any[];
  files: Record<string, any>;
  version: number | null;
}> => {
  const remoteDrawing = await api.getDrawing(drawingId);
  const remoteElements = Array.isArray(remoteDrawing.elements) ? remoteDrawing.elements : [];
  const remoteFiles = await resolveS3Files(remoteDrawing.files || {});

  const localElements = latestElementsRef.current;
  const { sceneUpdate, mergedElements, nextFiles } = buildRemoteSceneUpdate({
    localElements,
    pendingElements: remoteElements,
    lastSyncedFiles: lastSyncedFilesRef.current,
    incomingFiles: remoteFiles,
  });

  const merged = mergedElements ?? reconcileElements(localElements, remoteElements);

  const excalidraw = getAPI();
  if (excalidraw && sceneUpdate) {
    excalidraw.updateScene(sceneUpdate);
  }

  const version =
    typeof remoteDrawing.version === "number" ? remoteDrawing.version : null;
  if (version !== null) {
    currentDrawingVersionRef.current = version;
  }

  latestElementsRef.current = merged;
  latestFilesRef.current = nextFiles;
  lastSyncedFilesRef.current = nextFiles;
  lastSyncedElementOrderSigRef.current = computeElementOrderSig(merged);
  merged.forEach(recordElementVersion);

  return { elements: merged, files: nextFiles, version };
};
