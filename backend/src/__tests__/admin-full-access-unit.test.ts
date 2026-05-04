import { describe, expect, it } from "vitest";
import { isAdminFullAccessOverride } from "../authz/sharing.js";

describe("isAdminFullAccessOverride", () => {
  it("returns true when user is ADMIN and toggle is enabled", () => {
    expect(isAdminFullAccessOverride({ role: "ADMIN" }, true)).toBe(true);
  });

  it("returns false when user is ADMIN but toggle is disabled", () => {
    expect(isAdminFullAccessOverride({ role: "ADMIN" }, false)).toBe(false);
  });

  it("returns false when user is not ADMIN even if toggle is enabled", () => {
    expect(isAdminFullAccessOverride({ role: "USER" }, true)).toBe(false);
  });

  it("returns false when user is null", () => {
    expect(isAdminFullAccessOverride(null, true)).toBe(false);
  });

  it("returns false when user is undefined", () => {
    expect(isAdminFullAccessOverride(undefined, true)).toBe(false);
  });

  it("returns false when both toggle is off and user is regular", () => {
    expect(isAdminFullAccessOverride({ role: "USER" }, false)).toBe(false);
  });
});
