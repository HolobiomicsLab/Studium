// D4 review (2026-11-25), finding 1: the stdio server an assistant starts is one person's process — one assistant
// session of one user — and, with owner decision 4, its chat and its browser player play the same default learner in
// that one process. When that learner is the default "anonymous" (no learner_id from the model, STUDIUM_LEARNER_ID
// unset), D5 never merged its sessions and the stale-answer guard was off: the chat's « here » session and the
// browser's session of one lesson both lived in the process and saved over each other. A server that serves one person
// (servesOnePerson) treats its default learner as one person, whatever the id: D5 hands back the open session and the
// guard refuses a session another process moved on. A server that serves several people (the lesson HTTP API) keeps
// "anonymous" shared: never merged, never guarded.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "one-person-")); dirs.push(d); return d; }

const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "W", correct: false }, { id: "b", text: "R", correct: true }],
  feedback_correct: "yes", feedback_incorrect: "no", hints: [],
});
const LESSON = {
  schema_version: "1.4", bundle_id: "one-person", source_plan_id: "p",
  metadata: { title: "One person", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
  concepts: ["c1", "c2", "c3"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
  scenes: [
    { id: "s-intro", type: "intro", title: "Intro", objective_refs: ["c1"], concept_refs: ["c1"], estimated_seconds: 60, adaptation_hooks: [], markdown: "text" },
    quiz("q1", "c1"), quiz("q2", "c2"), quiz("q3", "c3"),
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-11-25T00:00:00Z",
};

function bundles(): string {
  const root = tmp();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(LESSON));
  return root;
}
/** Answer the scene on screen: a reading is acknowledged, a quiz gets its right choice. */
async function answer(h: SessionHost, id: string) {
  const scene = h.currentPresentation(id).scene as { type: string; choices?: Array<{ id: string; correct: boolean }> };
  return h.respond(id, scene.type === "quiz" ? { kind: "quiz_choice", choiceId: scene.choices!.find((c) => c.correct)!.id } : { kind: "ack" });
}

describe("D4 review, finding 1: the default learner of a server that serves one person", () => {
  it("is one person whatever its id: the chat's start finds the session the browser opened (D5)", async () => {
    const host = new SessionHost({ bundlesRoot: bundles(), dataDir: tmp(), live: false, servesOnePerson: true });
    const inBrowser = await host.create("lesson.json");
    await answer(host, inBrowser.sessionId);
    const inChat = await host.create("lesson.json");
    expect(inChat.sessionId).toBe(inBrowser.sessionId);
    expect(inChat.resume).toMatchObject({ kind: "already_open", scene_id: "q1", scenes_completed: 1 });
    // Named as the default, it is the same learner.
    expect((await host.create("lesson.json", "anonymous")).sessionId).toBe(inBrowser.sessionId);
  });

  it("is guarded: an answer in a session whose lesson another process moved on is refused", async () => {
    const bundlesRoot = bundles();
    const dataDir = tmp();
    const chat = new SessionHost({ bundlesRoot, dataDir, live: false, servesOnePerson: true });
    const other = () => new SessionHost({ bundlesRoot, dataDir, live: false, servesOnePerson: true });
    const inChat = await chat.create("lesson.json");
    await answer(chat, inChat.sessionId);
    const elsewhere = other();
    const there = await elsewhere.create("lesson.json");
    await answer(elsewhere, there.sessionId);
    await answer(elsewhere, there.sessionId);
    await expect(answer(chat, inChat.sessionId)).rejects.toThrow(/went on in another session/);
    expect((await other().create("lesson.json")).resume).toMatchObject({ kind: "resumed", scene_id: "q3", scenes_completed: 3 });
  });

  it("leaves another shared id named in a call shared: never merged", async () => {
    const host = new SessionHost({ bundlesRoot: bundles(), dataDir: tmp(), live: false, servesOnePerson: true });
    const first = await host.create("lesson.json", "agent-operator");
    expect((await host.create("lesson.json", "agent-operator")).sessionId).not.toBe(first.sessionId);
  });
});

describe("D4 review, finding 1: a server that serves several people", () => {
  it("leaves \"anonymous\" shared: never merged", async () => {
    const host = new SessionHost({ bundlesRoot: bundles(), dataDir: tmp(), live: false });
    const first = await host.create("lesson.json");
    expect((await host.create("lesson.json")).sessionId).not.toBe(first.sessionId);
  });
});
