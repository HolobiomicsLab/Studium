// apps/lesson-server/src/server.state-delete.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "./server.js";
import { writeMiniBundle, cleanupTmp } from "./test-support.js";

afterEach(cleanupTmp);

describe("GET /state + DELETE", () => {
  it("returns learner state", async () => {
    const { root, ref } = writeMiniBundle();
    const app = buildServer({ bundlesRoot: root, live: false });
    const id = (await app.inject({ method: "POST", url: "/sessions", payload: { bundle_ref: ref } })).json().session_id;
    const res = await app.inject({ method: "GET", url: `/sessions/${id}/state` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.lesson_id).toBe("mini-001");
    await app.close();
  });
  it("DELETE drops the session and emits forget_requested before removal", async () => {
    const { root, ref } = writeMiniBundle();
    const app = buildServer({ bundlesRoot: root, live: false });
    const id = (await app.inject({ method: "POST", url: "/sessions", payload: { bundle_ref: ref } })).json().session_id;
    const del = await app.inject({ method: "DELETE", url: `/sessions/${id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ success: true, forgotten: true });
    // session gone:
    expect((await app.inject({ method: "GET", url: `/sessions/${id}` })).statusCode).toBe(404);
    await app.close();
  });
  it("404 delete on unknown session", async () => {
    const app = buildServer({ bundlesRoot: ".", live: false });
    expect((await app.inject({ method: "DELETE", url: "/sessions/nope" })).statusCode).toBe(404);
    await app.close();
  });
});
