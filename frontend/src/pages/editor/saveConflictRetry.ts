export class DrawingSaveConflictError extends Error {
  constructor(message = "Drawing version conflict") {
    super(message);
    this.name = "DrawingSaveConflictError";
  }
}

/**
 * Recognises the backend's optimistic-concurrency rejection (HTTP 409 on
 * PUT /drawings/:id). Checked structurally rather than through
 * `api.isAxiosError` so this module stays free of the axios client and its
 * interceptors, and can be unit tested without stubbing the API layer.
 */
export const isVersionConflictError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { isAxiosError?: unknown; response?: { status?: unknown } };
  if (candidate.isAxiosError !== true) return false;
  return candidate.response?.status === 409;
};

interface SaveWithConflictRetryDeps<T> {
  /** Persists a scene; must reject with the raw error so 409s stay detectable. */
  save: (elements: readonly any[], files: Record<string, any>) => Promise<T>;
  /**
   * Re-reads the authoritative server scene and merges it with the local edits.
   * Called at most once, only after a version conflict.
   */
  reconcile: () => Promise<{ elements: readonly any[]; files: Record<string, any> }>;
  elements: readonly any[];
  files: Record<string, any>;
}

/**
 * Saves a scene, and on a version conflict reconciles against the server
 * before retrying — never re-sends the stale local scene under a newer version
 * number, which would silently discard another client's concurrent edits.
 *
 * At most one retry: if the reconciled save conflicts too, the caller is told
 * to surface the conflict rather than looping against a hot drawing.
 */
export const saveWithConflictRetry = async <T>({
  save,
  reconcile,
  elements,
  files,
}: SaveWithConflictRetryDeps<T>): Promise<T> => {
  try {
    return await save(elements, files);
  } catch (err) {
    if (!isVersionConflictError(err)) throw err;

    let merged: { elements: readonly any[]; files: Record<string, any> };
    try {
      merged = await reconcile();
    } catch (reconcileErr) {
      console.warn("[Editor] Failed to reconcile after version conflict", reconcileErr);
      throw new DrawingSaveConflictError();
    }

    try {
      return await save(merged.elements, merged.files);
    } catch (retryErr) {
      if (isVersionConflictError(retryErr)) throw new DrawingSaveConflictError();
      throw retryErr;
    }
  }
};
