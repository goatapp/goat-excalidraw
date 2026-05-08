import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import * as api from "../../api";
import { reconcileElements } from "../../utils/sync";
import { buildRemoteSceneUpdate } from "./shared";

const HEARTBEAT_INTERVAL_MS = 45_000;
const VISIBILITY_COOLDOWN_MS = 2_000;

interface StalenessRecoveryDeps {
  drawingId: string | undefined;
  currentDrawingVersionRef: MutableRefObject<number | null>;
  getAPI: () => any | null;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestFilesRef: MutableRefObject<any>;
  lastSyncedFilesRef: MutableRefObject<Record<string, any>>;
  lastPersistedFilesRef: MutableRefObject<Record<string, any>>;
  lastSyncedElementOrderSigRef: MutableRefObject<string>;
  recordElementVersion: (element: any) => void;
  computeElementOrderSig: (elements: readonly any[]) => string;
  resolveS3Files: (files: Record<string, any>) => Promise<Record<string, any>>;
  hasHydratedInitialScene: MutableRefObject<boolean>;
}

export function useStalenessRecovery({
  drawingId,
  currentDrawingVersionRef,
  getAPI,
  latestElementsRef,
  latestFilesRef,
  lastSyncedFilesRef,
  lastPersistedFilesRef,
  lastSyncedElementOrderSigRef,
  recordElementVersion,
  computeElementOrderSig,
  resolveS3Files,
  hasHydratedInitialScene,
}: StalenessRecoveryDeps) {
  const isReconciling = useRef(false);
  const lastRecoveryAtRef = useRef(0);

  const recover = useCallback(async () => {
    if (!drawingId || isReconciling.current) return;
    if (!hasHydratedInitialScene.current) return;

    const now = Date.now();
    if (now - lastRecoveryAtRef.current < VISIBILITY_COOLDOWN_MS) return;

    try {
      isReconciling.current = true;

      const { version: serverVersion } = await api.getDrawingVersion(drawingId);
      const localVersion = currentDrawingVersionRef.current;

      if (localVersion !== null && serverVersion <= localVersion) {
        lastRecoveryAtRef.current = Date.now();
        return;
      }

      const freshDrawing = await api.getDrawing(drawingId);
      const remoteElements = freshDrawing.elements || [];
      const remoteFiles = await resolveS3Files(freshDrawing.files || {});

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

      currentDrawingVersionRef.current =
        typeof freshDrawing.version === "number" ? freshDrawing.version : serverVersion;
      latestElementsRef.current = merged;
      latestFilesRef.current = nextFiles;
      lastSyncedFilesRef.current = nextFiles;
      lastPersistedFilesRef.current = nextFiles;
      lastSyncedElementOrderSigRef.current = computeElementOrderSig(merged);

      merged.forEach(recordElementVersion);
      lastRecoveryAtRef.current = Date.now();

      console.log("[Editor] Staleness recovery complete", {
        drawingId,
        localVersion,
        serverVersion,
        mergedCount: merged.length,
      });
    } catch (err) {
      console.warn("[Editor] Staleness recovery failed", err);
    } finally {
      isReconciling.current = false;
    }
  }, [
    drawingId,
    currentDrawingVersionRef,
    getAPI,
    latestElementsRef,
    latestFilesRef,
    lastSyncedFilesRef,
    lastPersistedFilesRef,
    lastSyncedElementOrderSigRef,
    recordElementVersion,
    computeElementOrderSig,
    resolveS3Files,
    hasHydratedInitialScene,
  ]);

  useEffect(() => {
    if (!drawingId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recover();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [drawingId, recover]);

  useEffect(() => {
    if (!drawingId) return;

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (isReconciling.current) return;
      recover();
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [drawingId, recover]);

  return { triggerStalenessRecovery: recover };
}
