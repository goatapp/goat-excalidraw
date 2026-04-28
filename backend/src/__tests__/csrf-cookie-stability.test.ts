import { describe, expect, it } from "vitest";
import { createCsrfToken, validateCsrfToken } from "../security.js";

describe("CSRF client identity stability", () => {
  it("keeps token validation stable when using cookie-based client IDs", () => {
    const cookieClientId = "cookie:fixed-client-id";
    const token = createCsrfToken(cookieClientId);

    expect(validateCsrfToken(cookieClientId, token)).toBe(true);
  });

  it("shows why legacy IP-based IDs are unstable across proxy hops", () => {
    const userAgent = "Mozilla/5.0 test";
    const clientIdViaProxyA = `10.0.0.5:${userAgent}`;
    const clientIdViaProxyB = `10.0.0.6:${userAgent}`;
    const token = createCsrfToken(clientIdViaProxyA);

    expect(validateCsrfToken(clientIdViaProxyB, token)).toBe(false);
  });
});
