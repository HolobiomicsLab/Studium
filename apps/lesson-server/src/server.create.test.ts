// apps/lesson-server/src/server.create.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "./server.js";
import { writeMiniBundle, cleanupTmp } from "./test-support.js";

afterEach(cleanupTmp);

describe("POST /sessions + GET /sessions/:id", () => {
  it("creates a session and returns the first presentation in an ok envelope", async () => {
    const { root, ref } = writeMiniBundle();
    const app = buildServer({ bundlesRoot: root, live: false });
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { bundle_ref: ref } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.session_id).toBe("string");
    expect(body.presentation.index).toBe(0);
    expect(body.presentation.scene.id).toBe("s0");

    const got = await app.inject({ method: "GET", url: `/sessions/${body.session_id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().presentation.scene.id).toBe("s0");
    await app.close();
  });
  it("404 + err envelope for unknown session", async () => {
    const app = buildServer({ bundlesRoot: ".", live: false });
    const res = await app.inject({ method: "GET", url: "/sessions/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false, ok: false });
    await app.close();
  });
  it("400 + err envelope for bad bundle_ref", async () => {
    const app = buildServer({ bundlesRoot: ".", live: false });
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { bundle_ref: "../escape.json" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    await app.close();
  });
});
