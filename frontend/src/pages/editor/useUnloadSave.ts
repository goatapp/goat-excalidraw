import { useEffect, type MutableRefObject } from "react";
import { saveDrawingKeepalive } from "./keepaliveSave";
import { getPersistedAppState, haveSameElements } from "./shared";

export interface UnloadSaveDeps {
  drawingId: string | undefined;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestAppStateRef: MutableRefObject<any>;
  lastPersistedElementsRef: MutableRefObject<readonly any[]>;
  currentDrawingVersionRef: MutableRefObject<number | null>;
}

/**
 * Flush the scene one last time when the document is being discarded.
 *
 * The autosave is debounced, so closing a tab (or navigating away) within the
 * debounce window used to drop the last edits entirely. `pagehide` covers tab
 * close, navigation and the mobile app-switch path that never fires `unload`.
 *
 * Files are deliberately omitted from the payload: image bytes would exceed the
 * keepalive body limit, and they are persisted by their own upload path anyway.
 */
export function useUnloadSave({
  drawingId,
  latestElementsRef,
  latestAppStateRef,
  lastPersistedElementsRef,
  currentDrawingVersionRef,
}: UnloadSaveDeps): void {
  useEffect(() => {
    if (!drawingId) return;

    const flush = () => {
      const elements = latestElementsRef.current ?? [];
      if (haveSameElements(elements, lastPersistedElementsRef.current ?? [])) return;

      const dispatched = saveDrawingKeepalive(drawingId, {
        elements: Array.from(elements),
        appState: getPersistedAppState(latestAppStateRef.current),
        ...(currentDrawingVersionRef.current != null
          ? { version: currentDrawingVersionRef.current }
          : {}),
      });

      if (!dispatched) {
        console.warn("[Editor] Could not flush unsaved changes on unload", {
          drawingId,
          elementCount: elements.length,
        });
      }
    };

    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [
    drawingId,
    latestElementsRef,
    latestAppStateRef,
    lastPersistedElementsRef,
    currentDrawingVersionRef,
  ]);
}
