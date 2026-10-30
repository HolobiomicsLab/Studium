// packages/lesson-session-host/src/host.session-not-found.test.ts
//
// RFR-14, R-en-06: a session id the server no longer knows (it restarted, or the session was closed)
// used to answer a bare « session not found: <id> ». The error now says how to go on: the same
// start_lesson_session resumes the lesson where it stopped, start_review_session restarts a review.
// The message still starts with « session not found: », which the HTTP adapter maps to a 404.
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { SessionHost, SessionHostNotFoundError } from "./host.js";

describe("an unknown session id", () => {
  it("says the server may have restarted and which call resumes", async () => {
    const host = new SessionHost({ bundlesRoot: tmpdir(), live: false, dataDir: null });
    const error = (() => { try { host.currentPresentation("gone-42"); } catch (e) { return e as Error; } return null; })();
    expect(error).toBeInstanceOf(SessionHostNotFoundError);
    expect(error!.message).toMatch(/^session not found: gone-42\b/);
    expect(error!.message).toContain("the server may have restarted");
    expect(error!.message).toContain("start_lesson_session");
    expect(error!.message).toContain("bundle_ref");
    expect(error!.message).toContain("learner_id");
    expect(error!.message).toContain("start_review_session");
    expect(error!.message).not.toContain("\n");
    await expect(host.respond("gone-42", { kind: "ack" })).rejects.toThrow(/start_lesson_session/);
  });
});
