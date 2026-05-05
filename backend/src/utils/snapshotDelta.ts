export interface ElementPatch {
  id: string;
  changes: Record<string, unknown>;
}

export interface SnapshotDelta {
  elements: {
    added: Record<string, unknown>[];
    removed: string[];
    modified: ElementPatch[];
  };
  appState: Record<string, unknown>;
  files: {
    added: Record<string, unknown>;
    removed: string[];
  };
}

type Element = Record<string, unknown> & { id: string };

export function computeDelta(
  prevElements: Element[],
  prevAppState: Record<string, unknown>,
  prevFiles: Record<string, unknown>,
  currElements: Element[],
  currAppState: Record<string, unknown>,
  currFiles: Record<string, unknown>,
): SnapshotDelta {
  const prevMap = new Map(prevElements.map((el) => [el.id, el]));
  const currMap = new Map(currElements.map((el) => [el.id, el]));

  const added: Element[] = [];
  const removed: string[] = [];
  const modified: ElementPatch[] = [];

  for (const [id, el] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      added.push(el);
    } else {
      const changes = shallowDiff(prev, el);
      if (changes) {
        modified.push({ id, changes });
      }
    }
  }

  for (const id of prevMap.keys()) {
    if (!currMap.has(id)) {
      removed.push(id);
    }
  }

  const addedFiles: Record<string, unknown> = {};
  const removedFiles: string[] = [];

  for (const key of Object.keys(currFiles)) {
    if (!(key in prevFiles)) {
      addedFiles[key] = currFiles[key];
    }
  }
  for (const key of Object.keys(prevFiles)) {
    if (!(key in currFiles)) {
      removedFiles.push(key);
    }
  }

  return {
    elements: { added, removed, modified },
    appState: currAppState,
    files: { added: addedFiles, removed: removedFiles },
  };
}

export function applyDelta(
  baseElements: Element[],
  _baseAppState: Record<string, unknown>,
  baseFiles: Record<string, unknown>,
  delta: SnapshotDelta,
): { elements: Element[]; appState: Record<string, unknown>; files: Record<string, unknown> } {
  const elementMap = new Map(baseElements.map((el) => [el.id, { ...el }]));

  for (const id of delta.elements.removed) {
    elementMap.delete(id);
  }

  for (const patch of delta.elements.modified) {
    const el = elementMap.get(patch.id);
    if (el) {
      Object.assign(el, patch.changes);
    }
  }

  for (const el of delta.elements.added) {
    elementMap.set((el as Element).id, el as Element);
  }

  const files = { ...baseFiles };
  for (const key of delta.files.removed) {
    delete files[key];
  }
  Object.assign(files, delta.files.added);

  return {
    elements: Array.from(elementMap.values()),
    appState: delta.appState,
    files,
  };
}

function shallowDiff(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): Record<string, unknown> | null {
  const changes: Record<string, unknown> = {};
  let hasChanges = false;

  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const key of allKeys) {
    if (key === "id") continue;
    const prevVal = prev[key];
    const currVal = curr[key];
    if (!deepEqual(prevVal, currVal)) {
      changes[key] = currVal;
      hasChanges = true;
    }
  }

  return hasChanges ? changes : null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}
