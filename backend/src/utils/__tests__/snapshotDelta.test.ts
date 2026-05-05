import { describe, expect, it } from "vitest";
import { computeDelta, applyDelta } from "../snapshotDelta.js";

describe("snapshotDelta", () => {
  const baseElements = [
    { id: "el-1", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    { id: "el-2", type: "ellipse", x: 200, y: 100, width: 80, height: 80 },
    { id: "el-3", type: "text", x: 50, y: 50, text: "hello" },
  ];
  const baseAppState = { viewBackgroundColor: "#ffffff", zoom: 1 };
  const baseFiles = { "file-1": { mimeType: "image/png", dataURL: "data:..." } };

  describe("computeDelta", () => {
    it("detects added elements", () => {
      const newElements = [
        ...baseElements,
        { id: "el-4", type: "arrow", x: 10, y: 10 },
      ];
      const delta = computeDelta(baseElements, baseAppState, baseFiles, newElements, baseAppState, baseFiles);
      expect(delta.elements.added).toHaveLength(1);
      expect(delta.elements.added[0]).toMatchObject({ id: "el-4" });
      expect(delta.elements.removed).toHaveLength(0);
      expect(delta.elements.modified).toHaveLength(0);
    });

    it("detects removed elements", () => {
      const newElements = baseElements.slice(0, 2);
      const delta = computeDelta(baseElements, baseAppState, baseFiles, newElements, baseAppState, baseFiles);
      expect(delta.elements.removed).toEqual(["el-3"]);
      expect(delta.elements.added).toHaveLength(0);
    });

    it("detects modified elements", () => {
      const newElements = baseElements.map((el) =>
        el.id === "el-1" ? { ...el, x: 50, width: 200 } : el
      );
      const delta = computeDelta(baseElements, baseAppState, baseFiles, newElements, baseAppState, baseFiles);
      expect(delta.elements.modified).toHaveLength(1);
      expect(delta.elements.modified[0]).toEqual({ id: "el-1", changes: { x: 50, width: 200 } });
    });

    it("detects file changes", () => {
      const newFiles = { "file-2": { mimeType: "image/jpeg", dataURL: "data:new" } };
      const delta = computeDelta(baseElements, baseAppState, baseFiles, baseElements, baseAppState, newFiles);
      expect(delta.files.added).toEqual({ "file-2": { mimeType: "image/jpeg", dataURL: "data:new" } });
      expect(delta.files.removed).toEqual(["file-1"]);
    });

    it("returns empty delta when nothing changed", () => {
      const delta = computeDelta(baseElements, baseAppState, baseFiles, baseElements, baseAppState, baseFiles);
      expect(delta.elements.added).toHaveLength(0);
      expect(delta.elements.removed).toHaveLength(0);
      expect(delta.elements.modified).toHaveLength(0);
      expect(delta.files.added).toEqual({});
      expect(delta.files.removed).toHaveLength(0);
    });
  });

  describe("applyDelta", () => {
    it("applies added elements", () => {
      const delta = computeDelta(baseElements, baseAppState, baseFiles,
        [...baseElements, { id: "el-4", type: "arrow", x: 10, y: 10 }], baseAppState, baseFiles);
      const result = applyDelta(baseElements as any, baseAppState, baseFiles, delta);
      expect(result.elements).toHaveLength(4);
      expect(result.elements.find((el) => el.id === "el-4")).toBeDefined();
    });

    it("applies removed elements", () => {
      const delta = computeDelta(baseElements, baseAppState, baseFiles,
        baseElements.slice(0, 1), baseAppState, baseFiles);
      const result = applyDelta(baseElements as any, baseAppState, baseFiles, delta);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].id).toBe("el-1");
    });

    it("applies modified elements", () => {
      const modified = baseElements.map((el) =>
        el.id === "el-2" ? { ...el, x: 999 } : el
      );
      const delta = computeDelta(baseElements, baseAppState, baseFiles, modified, baseAppState, baseFiles);
      const result = applyDelta(baseElements as any, baseAppState, baseFiles, delta);
      expect(result.elements.find((el) => el.id === "el-2")!.x).toBe(999);
    });

    it("applies file changes", () => {
      const newFiles = { "file-1": baseFiles["file-1"], "file-2": { mimeType: "image/gif" } };
      const delta = computeDelta(baseElements, baseAppState, baseFiles, baseElements, baseAppState, newFiles);
      const result = applyDelta(baseElements as any, baseAppState, baseFiles, delta);
      expect(result.files["file-1"]).toBeDefined();
      expect(result.files["file-2"]).toBeDefined();
    });

    it("roundtrips through compute and apply", () => {
      const newElements = [
        { id: "el-1", type: "rectangle", x: 50, y: 10, width: 100, height: 50 },
        { id: "el-4", type: "line", x: 0, y: 0, points: [[0, 0], [100, 100]] },
      ];
      const newAppState = { viewBackgroundColor: "#000000", zoom: 2 };
      const newFiles = { "file-2": { mimeType: "image/svg" } };

      const delta = computeDelta(baseElements, baseAppState, baseFiles, newElements, newAppState, newFiles);
      const result = applyDelta(baseElements as any, baseAppState, baseFiles, delta);

      expect(result.elements).toHaveLength(2);
      expect(result.elements.find((el) => el.id === "el-1")!.x).toBe(50);
      expect(result.elements.find((el) => el.id === "el-4")).toBeDefined();
      expect(result.appState).toEqual(newAppState);
      expect(result.files).toEqual(newFiles);
    });

    it("chains multiple deltas correctly", () => {
      const step1 = [...baseElements, { id: "el-4", type: "arrow", x: 0, y: 0 }];
      const step2 = step1.map((el) => el.id === "el-4" ? { ...el, x: 100 } : el);

      const delta1 = computeDelta(baseElements, baseAppState, baseFiles, step1, baseAppState, baseFiles);
      const delta2 = computeDelta(step1, baseAppState, baseFiles, step2, baseAppState, baseFiles);

      const after1 = applyDelta(baseElements as any, baseAppState, baseFiles, delta1);
      const after2 = applyDelta(after1.elements, after1.appState, after1.files, delta2);

      expect(after2.elements).toHaveLength(4);
      expect(after2.elements.find((el) => el.id === "el-4")!.x).toBe(100);
    });
  });
});
