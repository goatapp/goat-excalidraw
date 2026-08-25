import { describe, expect, it, vi } from "vitest";
import {
  DrawingSaveConflictError,
  isVersionConflictError,
  saveWithConflictRetry,
} from "./saveConflictRetry";

const conflictError = () => ({
  isAxiosError: true,
  response: { status: 409, data: { currentVersion: 7 } },
});

const localElements = [{ id: "local", version: 1 }];
const localFiles = { localFile: { id: "localFile" } };
const mergedElements = [
  { id: "local", version: 1 },
  { id: "remote", version: 4 },
];
const mergedFiles = { localFile: { id: "localFile" }, remoteFile: { id: "remoteFile" } };

describe("isVersionConflictError", () => {
  it("identifies an axios 409 response", () => {
    expect(isVersionConflictError(conflictError())).toBe(true);
  });

  it("rejects other axios statuses", () => {
    expect(
      isVersionConflictError({ isAxiosError: true, response: { status: 500 } })
    ).toBe(false);
  });

  it("rejects non-axios errors that happen to carry a 409", () => {
    expect(isVersionConflictError({ response: { status: 409 } })).toBe(false);
  });

  it("rejects plain errors", () => {
    expect(isVersionConflictError(new Error("boom"))).toBe(false);
  });
});

describe("saveWithConflictRetry", () => {
  it("saves the local scene once when there is no conflict", async () => {
    const save = vi.fn().mockResolvedValue({ version: 3 });
    const reconcile = vi.fn();

    const result = await saveWithConflictRetry({
      save,
      reconcile,
      elements: localElements,
      files: localFiles,
    });

    expect(result).toEqual({ version: 3 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(localElements, localFiles);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("retries with the reconciled scene instead of the stale local scene", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflictError())
      .mockResolvedValueOnce({ version: 8 });
    const reconcile = vi
      .fn()
      .mockResolvedValue({ elements: mergedElements, files: mergedFiles });

    const result = await saveWithConflictRetry({
      save,
      reconcile,
      elements: localElements,
      files: localFiles,
    });

    expect(result).toEqual({ version: 8 });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([mergedElements, mergedFiles]);
  });

  it("throws a conflict error when the reconciled save also conflicts", async () => {
    const save = vi.fn().mockRejectedValue(conflictError());
    const reconcile = vi
      .fn()
      .mockResolvedValue({ elements: mergedElements, files: mergedFiles });

    await expect(
      saveWithConflictRetry({
        save,
        reconcile,
        elements: localElements,
        files: localFiles,
      })
    ).rejects.toBeInstanceOf(DrawingSaveConflictError);

    expect(save).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("throws a conflict error when reconciliation fails", async () => {
    const save = vi.fn().mockRejectedValue(conflictError());
    const reconcile = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      saveWithConflictRetry({
        save,
        reconcile,
        elements: localElements,
        files: localFiles,
      })
    ).rejects.toBeInstanceOf(DrawingSaveConflictError);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("propagates non-conflict errors without reconciling", async () => {
    const failure = new Error("server exploded");
    const save = vi.fn().mockRejectedValue(failure);
    const reconcile = vi.fn();

    await expect(
      saveWithConflictRetry({
        save,
        reconcile,
        elements: localElements,
        files: localFiles,
      })
    ).rejects.toBe(failure);

    expect(reconcile).not.toHaveBeenCalled();
  });
});
