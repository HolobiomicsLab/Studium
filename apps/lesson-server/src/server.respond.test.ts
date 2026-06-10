// apps/lesson-server/src/server.respond.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "./server.js";
import { writeMiniBundle, cleanupTmp } from "./test-support.js";

afterEach(cleanupTmp);

async function newSession() {
  const { root, ref } = writeMiniBundle();
  const app = buildServer({ bundlesRoot: root, live: false });
  const res = await app.inject({ method: "POST", url: "/sessions", payload: { bundle_ref: ref } });
  return { app, id: res.json().session_id as string };
}

describe("POST /sessions/:id/respond + /turns", () => {
  it("ack advances intro → quiz", async () => {
    const { app, id } = await newSession();
    const res = await app.inject({ method: "POST", url: `/sessions/${id}/respond`, payload: { input: { kind: "ack" } } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.transition.kind).toBe("next");
    expect(body.transition.presentation.scene.id).toBe("s1");
    await app.close();
  });
  it("400 on invalid input", async () => {
    const { app, id } = await newSession();
    const res = await app.inject({ method: "POST", url: `/sessions/${id}/respond`, payload: { input: { kind: "bogus" } } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it("turns endpoint accepts a turn (200) even on non-discussion scene (no-op)", async () => {
    const { app, id } = await newSession();
    const res = await app.inject({ method: "POST", url: `/sessions/${id}/turns`, payload: { text: "because X" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    await app.close();
  });
  it("404 respond on unknown session", async () => {
    const { root, ref } = writeMiniBundle();
    const app = buildServer({ bundlesRoot: root, live: false });
    const res = await app.inject({ method: "POST", url: `/sessions/nope/respond`, payload: { input: { kind: "ack" } } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
  it("404 turns on unknown session", async () => {
    const { root, ref } = writeMiniBundle();
    const app = buildServer({ bundlesRoot: root, live: false });
    const res = await app.inject({ method: "POST", url: `/sessions/nope/turns`, payload: { text: "hello" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false });
    await app.close();
  });
});
