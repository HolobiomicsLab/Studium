// apps/lesson-server/src/e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "./server.js";
import { writeMiniBundle, cleanupTmp } from "./test-support.js";

afterEach(cleanupTmp);

describe("full lesson over HTTP", () => {
  it("drives intro → quiz → meta to completion", async () => {
    const { root, ref } = writeMiniBundle();
    const app = buildServer({ bundlesRoot: root, live: false });
    const id = (await app.inject({ method: "POST", url: "/sessions", payload: { bundle_ref: ref } })).json().session_id;

    // s0 intro → ack
    let t = (await app.inject({ method: "POST", url: `/sessions/${id}/respond`, payload: { input: { kind: "ack" } } })).json().transition;
    expect(t.kind).toBe("next");
    // s1 quiz → correct choice "b"
    t = (await app.inject({ method: "POST", url: `/sessions/${id}/respond`, payload: { input: { kind: "quiz_choice", choiceId: "b" } } })).json().transition;
    expect(t.kind).toBe("next");
    // s2 meta_checkpoint → confidence → completes
    t = (await app.inject({ method: "POST", url: `/sessions/${id}/respond`, payload: { input: { kind: "confidence", value: 3 } } })).json().transition;
    expect(t.kind).toBe("complete");
    expect(t.summary.scenesCompleted).toBe(3);

    // state reflects completion
    const state = (await app.inject({ method: "GET", url: `/sessions/${id}/state` })).json().state;
    expect(state.scenes_completed).toEqual(["s0", "s1", "s2"]);
    await app.close();
  });
});
