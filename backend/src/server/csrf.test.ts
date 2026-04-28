import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerCsrfProtection } from "./csrf.js";

describe("CSRF token issuance", () => {
  it("binds first-issued tokens to cookie client identity", async () => {
    const app = express();
    app.use(express.json());

    registerCsrfProtection({
      app,
      isAllowedOrigin: () => true,
      maxRequestsPerWindow: 100,
    });

    app.post("/drawings", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const agent = request.agent(app);
    const csrfRes = await agent
      .get("/csrf-token")
      .set("User-Agent", "csrf-test-agent-a");

    expect(csrfRes.status).toBe(200);
    const headerName = csrfRes.body.header as string;
    const token = csrfRes.body.token as string;
    expect(typeof headerName).toBe("string");
    expect(typeof token).toBe("string");

    const postRes = await agent
      .post("/drawings")
      .set("User-Agent", "csrf-test-agent-b")
      .set(headerName, token)
      .send({ name: "test" });

    expect(postRes.status).toBe(200);
    expect(postRes.body.ok).toBe(true);
  });
});
