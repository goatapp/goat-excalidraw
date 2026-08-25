import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  filesNeedRehydration,
  normalizeSvgDataUrls,
  rehydrateFilesFromRefs,
  rehydrateFilesProgressive,
} from "./rehydrateFiles";

vi.mock("../api", () => ({
  api: { get: vi.fn() },
}));

import { api } from "../api";

const mockGet = api.get as ReturnType<typeof vi.fn>;

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

const ref = (fileId: string) => ({
  id: fileId,
  mimeType: "image/png",
  dataURL: `/api/files/drawing-1/${fileId}`,
});

const inline = (fileId: string) => ({
  id: fileId,
  mimeType: "image/png",
  dataURL: "data:image/png;base64,AAAA",
});

const pngBlob = () => new Blob([PNG_BYTES], { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: pngBlob() });
});

describe("filesNeedRehydration", () => {
  it("detects a stored file reference", () => {
    expect(filesNeedRehydration({ a: ref("a") })).toBe(true);
  });

  it("ignores files that are already inline", () => {
    expect(filesNeedRehydration({ a: inline("a") })).toBe(false);
  });

  it("handles empty and missing input", () => {
    expect(filesNeedRehydration({})).toBe(false);
    expect(filesNeedRehydration(null)).toBe(false);
    expect(filesNeedRehydration(undefined)).toBe(false);
  });
});

describe("normalizeSvgDataUrls", () => {
  it("re-encodes utf8 svg data urls as base64", () => {
    const files = {
      a: { id: "a", dataURL: "data:image/svg+xml;utf8,%3Csvg%2F%3E" },
    };

    const result = normalizeSvgDataUrls(files);

    expect(result.a.dataURL).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
  });

  it("returns the same object when nothing needs re-encoding", () => {
    const files = { a: inline("a") };

    expect(normalizeSvgDataUrls(files)).toBe(files);
  });
});

describe("rehydrateFilesProgressive", () => {
  it("reports each file as soon as it is inlined", async () => {
    const onFileReady = vi.fn();

    await rehydrateFilesProgressive({ a: ref("a"), b: ref("b") }, onFileReady);

    expect(onFileReady).toHaveBeenCalledTimes(2);
    const reported = Object.fromEntries(
      onFileReady.mock.calls.map(([fileId, file]) => [fileId, file])
    );
    expect(Object.keys(reported).sort()).toEqual(["a", "b"]);
    expect(reported.a.dataURL).toMatch(/^data:image\/png;base64,/);
    expect(reported.a.id).toBe("a");
  });

  it("requests the file through the api client so auth refresh applies", async () => {
    await rehydrateFilesProgressive({ a: ref("a") }, vi.fn());

    expect(mockGet).toHaveBeenCalledWith("/files/drawing-1/a", {
      responseType: "blob",
    });
  });

  it("skips files that are already inline", async () => {
    const onFileReady = vi.fn();

    await rehydrateFilesProgressive({ a: inline("a") }, onFileReady);

    expect(mockGet).not.toHaveBeenCalled();
    expect(onFileReady).not.toHaveBeenCalled();
  });

  it("drops a file whose fetch fails, leaving the original reference alone", async () => {
    mockGet.mockRejectedValue(new Error("404"));
    const onFileReady = vi.fn();

    await rehydrateFilesProgressive({ a: ref("a") }, onFileReady);

    expect(onFileReady).not.toHaveBeenCalled();
  });

  it("keeps one slow file from blocking the others", async () => {
    let releaseSlow: (value: any) => void = () => undefined;
    mockGet.mockImplementation((path: string) => {
      if (path.endsWith("/slow")) {
        return new Promise((resolve) => {
          releaseSlow = resolve;
        });
      }
      return Promise.resolve({ data: pngBlob() });
    });
    const onFileReady = vi.fn();

    const pending = rehydrateFilesProgressive(
      { slow: ref("slow"), fast: ref("fast") },
      onFileReady
    );

    await vi.waitFor(() => {
      expect(onFileReady).toHaveBeenCalledWith("fast", expect.anything());
    });

    releaseSlow({ data: pngBlob() });
    await pending;
    expect(onFileReady).toHaveBeenCalledTimes(2);
  });

  it("bounds how many files are fetched at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve({ data: pngBlob() });
          });
        })
    );

    const files = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`f${i}`, ref(`f${i}`)])
    );
    const pending = rehydrateFilesProgressive(files, vi.fn());

    // Release one fetch at a time, waiting for the pool to dispatch the next.
    for (let i = 0; i < 20; i++) {
      await vi.waitFor(() => {
        expect(releases.length).toBeGreaterThan(0);
      });
      releases.shift()!();
    }
    await pending;

    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(mockGet).toHaveBeenCalledTimes(20);
  });

  it("stops fetching once the load is cancelled", async () => {
    const onFileReady = vi.fn();
    const files = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`f${i}`, ref(`f${i}`)])
    );

    await rehydrateFilesProgressive(files, onFileReady, () => true);

    expect(mockGet).not.toHaveBeenCalled();
    expect(onFileReady).not.toHaveBeenCalled();
  });

  it("does not write into a scene that was replaced mid-fetch", async () => {
    const onFileReady = vi.fn();
    let cancelled = false;
    mockGet.mockImplementation(() => {
      cancelled = true;
      return Promise.resolve({ data: pngBlob() });
    });

    await rehydrateFilesProgressive({ a: ref("a") }, onFileReady, () => cancelled);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(onFileReady).not.toHaveBeenCalled();
  });

  it("does nothing when there is nothing to rehydrate", async () => {
    const onFileReady = vi.fn();

    await rehydrateFilesProgressive({}, onFileReady);
    await rehydrateFilesProgressive(null, onFileReady);

    expect(onFileReady).not.toHaveBeenCalled();
  });
});

describe("rehydrateFilesFromRefs", () => {
  it("inlines every stored reference", async () => {
    const result = await rehydrateFilesFromRefs({ a: ref("a"), b: ref("b") });

    expect(result.a.dataURL).toMatch(/^data:image\/png;base64,/);
    expect(result.b.dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it("returns the input untouched when nothing needs fetching", async () => {
    const files = { a: inline("a") };

    expect(await rehydrateFilesFromRefs(files)).toBe(files);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("keeps a failed file at its original reference", async () => {
    mockGet.mockRejectedValue(new Error("boom"));

    const result = await rehydrateFilesFromRefs({ a: ref("a") });

    expect(result.a.dataURL).toBe("/api/files/drawing-1/a");
  });

  it("normalizes utf8 svg data urls on the way through", async () => {
    const result = await rehydrateFilesFromRefs({
      a: { id: "a", dataURL: "data:image/svg+xml;utf8,%3Csvg%2F%3E" },
    });

    expect(result.a.dataURL).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
  });
});
