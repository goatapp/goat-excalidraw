import { API_URL, getCsrfHeader } from "../../api";

/**
 * Fire a best-effort scene save that survives page unload.
 *
 * The normal axios save pipeline cannot run reliably from a `pagehide`
 * handler — its async CSRF interceptor and the debounced save queue both need
 * ticks the browser will not give a document being discarded. `fetch` with
 * `keepalive: true` is guaranteed to be flushed even as the page goes away.
 * `navigator.sendBeacon` is not an option: it cannot set the CSRF header nor
 * issue a PUT.
 *
 * Returns whether the request was dispatched; the response is never observed.
 */
/**
 * Browsers cap the combined body size of in-flight keepalive requests at
 * 64 KiB and reject anything larger, so an oversized scene is reported as
 * undispatchable instead of failing silently in the unload path.
 */
export const KEEPALIVE_BODY_LIMIT_BYTES = 64 * 1024;

export const saveDrawingKeepalive = (
  drawingId: string,
  body: Record<string, unknown>
): boolean => {
  if (!drawingId || typeof fetch !== "function") return false;

  try {
    const serialized = JSON.stringify(body);
    if (new Blob([serialized]).size > KEEPALIVE_BODY_LIMIT_BYTES) return false;

    const csrf = getCsrfHeader();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (csrf) headers[csrf.name] = csrf.token;

    void fetch(`${API_URL}/drawings/${drawingId}`, {
      method: "PUT",
      credentials: "include",
      keepalive: true,
      headers,
      body: serialized,
    })?.catch(() => undefined);

    return true;
  } catch {
    return false;
  }
};
