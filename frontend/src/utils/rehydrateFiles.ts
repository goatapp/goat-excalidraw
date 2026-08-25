/**
 * S3-mode file rehydration.
 *
 * In S3 storage mode a drawing's `files[fileId].dataURL` is not an inline
 * base64 `data:` URL but a same-origin `/api/files/<drawingId>/<fileId>`
 * reference. Excalidraw can render a raster `<img>` from such a reference, but
 * SVG image elements fail, and `exportToSvg` embeds the bare reference as the
 * `<image href>` — which the backend preview sanitizer drops, so thumbnails
 * lose every image. Each reference is therefore fetched and re-inlined as a
 * base64 `data:` URL before the files reach Excalidraw.
 *
 * Fetches go through the axios `api` client rather than bare `fetch`: the file
 * route requires auth, and the client's response interceptor rotates an expired
 * access token and retries. A bare fetch would 401 and silently drop the image.
 */
import { api } from "../api";

/**
 * A dataURL that must be fetched and re-inlined: a non-empty string that is not
 * already inline and points at our file endpoint.
 */
const isRehydratableRef = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/api/files/");

export const filesNeedRehydration = (
  files: Record<string, any> | null | undefined
): boolean => {
  if (!files || typeof files !== "object") return false;
  return Object.values(files).some((file) => isRehydratableRef(file?.dataURL));
};

/**
 * Excalidraw cannot decode `data:image/svg+xml;utf8,` payloads, which some
 * import paths produce; re-encode them as base64.
 */
export const normalizeSvgDataUrls = (files: Record<string, any>): Record<string, any> => {
  let changed = false;
  const result = { ...files };
  for (const [key, file] of Object.entries(result)) {
    if (
      typeof file?.dataURL === "string" &&
      file.dataURL.startsWith("data:image/svg+xml;utf8,")
    ) {
      try {
        const encoded = file.dataURL.slice(file.dataURL.indexOf(",") + 1);
        const svgContent = decodeURIComponent(encoded);
        const base64 = btoa(unescape(encodeURIComponent(svgContent)));
        result[key] = { ...file, dataURL: `data:image/svg+xml;base64,${base64}` };
        changed = true;
      } catch {
        // leave as-is
      }
    }
  }
  return changed ? result : files;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });

/**
 * Fetch a stored file reference and return it as a base64 `data:` URL, or null
 * on any failure. Best-effort: a failed fetch must leave the original reference
 * in place rather than blank the image.
 */
const fetchAsDataUrl = async (dataURL: string): Promise<string | null> => {
  try {
    // The api client is already based at /api; the stored ref is absolute.
    const path = dataURL.replace(/^\/api\//, "/");
    const response = await api.get(path, { responseType: "blob" });
    return await blobToDataUrl(response.data as Blob);
  } catch {
    return null;
  }
};

/**
 * Bound on concurrent file fetches — matches the ~6 parallel connections a
 * browser opens per origin, so the pipe stays saturated without head-of-line
 * blocking behind a single slow blob.
 */
const REHYDRATE_CONCURRENCY = 6;

const rehydratableEntries = (
  files: Record<string, any> | null | undefined
): Array<[string, any]> => {
  if (!files || typeof files !== "object") return [];
  return Object.entries(files).filter(([, file]) => isRehydratableRef(file?.dataURL));
};

/**
 * Fetch every stored reference with bounded concurrency, invoking
 * `onFileReady(fileId, file)` the moment each one lands. Lets the scene paint
 * immediately and stream images into the canvas one by one instead of blocking
 * the whole editor on the slowest download.
 *
 * - Inline entries are skipped; they already render.
 * - A file whose fetch fails is dropped silently, leaving the original
 *   reference on the canvas rather than blanking the image.
 * - `isCancelled` is polled before dispatching each fetch and again before each
 *   callback, so a load the user has navigated away from cannot write into the
 *   scene that replaced it.
 */
export const rehydrateFilesProgressive = async (
  files: Record<string, any> | null | undefined,
  onFileReady: (fileId: string, file: Record<string, any>) => void,
  isCancelled?: () => boolean
): Promise<void> => {
  const entries = rehydratableEntries(files);
  if (entries.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      if (isCancelled?.()) return;
      const [fileId, file] = entries[cursor++];
      const dataURL = await fetchAsDataUrl(file.dataURL);
      if (isCancelled?.()) return;
      if (dataURL) {
        onFileReady(fileId, { ...file, dataURL });
      }
    }
  };

  const workerCount = Math.min(REHYDRATE_CONCURRENCY, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
};

/**
 * Batch variant: resolves only once every reference has been inlined. Used by
 * callers that need the whole set in hand — socket file receipt, preview
 * export, staleness recovery — where a partially populated map would produce a
 * wrong result rather than a slower one.
 */
export const rehydrateFilesFromRefs = async (
  files: Record<string, any> | null | undefined
): Promise<Record<string, any>> => {
  if (!files || typeof files !== "object") return files ?? {};

  const normalized = normalizeSvgDataUrls(files);
  const entries = rehydratableEntries(normalized);
  if (entries.length === 0) return normalized;

  const result = { ...normalized };
  await Promise.all(
    entries.map(async ([fileId, file]) => {
      const dataURL = await fetchAsDataUrl(file.dataURL);
      if (dataURL) {
        result[fileId] = { ...file, dataURL };
      }
    })
  );
  return result;
};
