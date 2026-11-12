import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MINIMAP_STORAGE_KEY,
  getStoredMinimapEnabled,
  setStoredMinimapEnabled,
} from "./shared";

describe("minimap preference", () => {
  let originalLocalStorage: any;

  beforeEach(() => {
    originalLocalStorage = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => {
          store.set(key, String(value));
        },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("defaults to off when nothing is stored", () => {
    expect(getStoredMinimapEnabled()).toBe(false);
  });

  it("round-trips the stored value", () => {
    setStoredMinimapEnabled(true);
    expect(localStorage.getItem(MINIMAP_STORAGE_KEY)).toBe("true");
    expect(getStoredMinimapEnabled()).toBe(true);

    setStoredMinimapEnabled(false);
    expect(getStoredMinimapEnabled()).toBe(false);
  });

  it("treats unexpected stored values as off", () => {
    localStorage.setItem(MINIMAP_STORAGE_KEY, "yes");
    expect(getStoredMinimapEnabled()).toBe(false);
  });

  it("falls back to off when localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    expect(getStoredMinimapEnabled()).toBe(false);
    expect(() => setStoredMinimapEnabled(true)).not.toThrow();
  });
});
