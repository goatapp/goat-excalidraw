import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { saveDrawingKeepalive } from "./keepaliveSave";

vi.mock("../../api", () => ({
  API_URL: "/api",
  getCsrfHeader: vi.fn(),
}));

import { getCsrfHeader } from "../../api";

const mockGetCsrfHeader = getCsrfHeader as ReturnType<typeof vi.fn>;

const body = { elements: [{ id: "el-1" }], version: 3 };

describe("saveDrawingKeepalive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCsrfHeader.mockReturnValue({ name: "x-csrf-token", token: "tok-1" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches a keepalive PUT that survives page unload", () => {
    const dispatched = saveDrawingKeepalive("drawing-1", body);

    expect(dispatched).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/drawings/drawing-1");
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("include");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("includes the CSRF header so the write is not rejected", () => {
    saveDrawingKeepalive("drawing-1", body);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["x-csrf-token"]).toBe("tok-1");
  });

  it("still dispatches when no CSRF token has been fetched yet", () => {
    mockGetCsrfHeader.mockReturnValue(null);

    expect(saveDrawingKeepalive("drawing-1", body)).toBe(true);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["x-csrf-token"]).toBeUndefined();
  });

  it("does nothing without a drawing id", () => {
    expect(saveDrawingKeepalive("", body)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports failure when fetch is unavailable", () => {
    vi.stubGlobal("fetch", undefined);

    expect(saveDrawingKeepalive("drawing-1", body)).toBe(false);
  });

  it("reports failure when the dispatch throws", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("unload teardown");
      })
    );

    expect(saveDrawingKeepalive("drawing-1", body)).toBe(false);
  });

  it("refuses payloads above the browser keepalive body limit", () => {
    // Browsers cap in-flight keepalive request bodies at 64 KiB; a larger body
    // is rejected by the fetch itself, so detect it rather than fail silently.
    const oversized = { elements: [{ id: "el-1", text: "x".repeat(70 * 1024) }] };

    expect(saveDrawingKeepalive("drawing-1", oversized)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("swallows a rejected in-flight request", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("connection closed"))));

    expect(saveDrawingKeepalive("drawing-1", body)).toBe(true);
    await Promise.resolve();
  });
});
