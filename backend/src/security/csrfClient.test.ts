import { Request } from "express";
import { describe, expect, it } from "vitest";
import {
  CSRF_CLIENT_COOKIE_NAME,
  getCsrfClientCookieValue,
  getCsrfValidationClientIds,
  getLegacyClientId,
  parseCookies,
} from "./csrfClient.js";

const makeRequest = (overrides?: Partial<Request>): Request =>
  ({
    headers: {
      cookie: "",
      "user-agent": "UnitTestAgent/1.0",
    },
    ip: "203.0.113.10",
    connection: { remoteAddress: "198.51.100.8" },
    ...overrides,
  }) as unknown as Request;

describe("csrfClient helpers", () => {
  it("parses cookies and tolerates bad encoding", () => {
    const parsed = parseCookies("a=1; b=hello%20world; c=%E0%A4%A");
    expect(parsed).toEqual({
      a: "1",
      b: "hello world",
      c: "%E0%A4%A",
    });
  });

  it("reads only valid csrf cookie values", () => {
    const validReq = makeRequest({
      headers: {
        cookie: `${CSRF_CLIENT_COOKIE_NAME}=abcDEF1234567890_-`,
      },
    });
    expect(getCsrfClientCookieValue(validReq)).toBe("abcDEF1234567890_-");

    const invalidReq = makeRequest({
      headers: {
        cookie: `${CSRF_CLIENT_COOKIE_NAME}=bad!`,
      },
    });
    expect(getCsrfClientCookieValue(invalidReq)).toBeNull();
  });

  it("builds legacy client id from IP + user agent and truncates", () => {
    const longAgent = "x".repeat(600);
    const req = makeRequest({
      headers: {
        "user-agent": longAgent,
      },
    });
    const id = getLegacyClientId(req);
    expect(id.startsWith("203.0.113.10:")).toBe(true);
    expect(id.length).toBeLessThanOrEqual(256);
  });

  it("returns validation candidates with cookie id first when present", () => {
    const req = makeRequest({
      headers: {
        cookie: `${CSRF_CLIENT_COOKIE_NAME}=cookieToken123456`,
        "user-agent": "Agent",
      },
      ip: "10.0.0.1",
    });

    const candidates = getCsrfValidationClientIds(req);
    expect(candidates[0]).toBe("cookie:cookieToken123456");
    expect(candidates[1]).toContain("10.0.0.1:Agent");
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
