// D1 (waiting review 2026-11-25): the server VS Code offers to Copilot and the Studium pane's own server share
// one learner id and one data folder, so a lesson begun in the chat goes on in the pane. Copilot keeps its
// server running, with the chat's session open: two processes then hold the same lesson for the same learner,
// and D5's guard (one live session per learner and lesson) only sees its own process. Two hosts over one data
// folder stand for the two processes here, as durable-host.test.ts stands a fresh host for a restart.
//
// A session that finds its lesson's saved state changed by another process since it loaded or last saved it
// refuses, in one line and before writing anything, and points to start_lesson_session, which takes the lesson
// up where the other surface left it.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "cross-process-")); dirs.push(d); return d; }

const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "W", correct: false }, { id: "b", text: "R", correct: true }],
  feedback_correct: "yes", feedback_incorrect: "no", hints: [],
});
const LESSON = {
  schema_version: "1.4", bundle_id: "two-surfaces", source_plan_id: "p",
  metadata: { title: "Two surfaces", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
  concepts: ["c1", "c2", "c3", "c4"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
  scenes: [
    { id: "s-intro", type: "intro", title: "Intro", objective_refs: ["c1"], concept_refs: ["c1"], estimated_seconds: 60, adaptation_hooks: [], markdown: "text" },
    quiz("q1", "c1"), quiz("q2", "c2"), quiz("q3", "c3"), quiz("q4", "c4"),
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-11-25T00:00:00Z",
};
const LEARNER = "vscode-learner";

function setUp() {
  const bundlesRoot = tmp();
  writeFileSync(join(bundlesRoot, "lesson.json"), JSON.stringify(LESSON));
  const dataDir = tmp();
  // The chat's server: the editor names the learner (STUDIUM_LEARNER_ID), the model passes none.
  const chat = new SessionHost({ bundlesRoot, dataDir, live: false, defaultLearnerId: LEARNER });
  const pane = () => new SessionHost({ bundlesRoot, dataDir, live: false });
  return { chat, pane };
}
/** Answer the scene on screen: a reading is acknowledged, a quiz gets its right choice. */
async function answer(h: SessionHost, id: string) {
  const scene = h.currentPresentation(id).scene as { type: string; choices?: Array<{ id: string; correct: boolean }> };
  return h.respond(id, scene.type === "quiz" ? { kind: "quiz_choice", choiceId: scene.choices!.find((c) => c.correct)!.id } : { kind: "ack" });
}
/** Where a fresh process resumes the lesson: what is on disk. */
async function onDisk(pane: () => SessionHost) {
  const fresh = pane();
  return (await fresh.create("lesson.json", LEARNER)).resume;
}

describe("D1: two servers on one data folder, one learner", () => {
  it("an answer in a session whose lesson went on in another process is refused, and the progress made there is kept", async () => {
    const { chat, pane } = setUp();
    const inChat = await chat.create("lesson.json");
    expect(inChat.resume.kind).toBe("new");
    await answer(chat, inChat.sessionId); // s-intro done, the chat is on q1
    expect(chat.currentPresentation(inChat.sessionId).scene.id).toBe("q1");

    // The pane opens the lesson where the chat left it, and plays two steps, the chat's server still running.
    const paneHost = pane();
    const inPane = await paneHost.create("lesson.json", LEARNER);
    expect(inPane.resume).toMatchObject({ kind: "resumed", scene_id: "q1" });
    await answer(paneHost, inPane.sessionId);
    await answer(paneHost, inPane.sessionId);
    expect(paneHost.currentPresentation(inPane.sessionId).scene.id).toBe("q3");
    expect(await onDisk(pane)).toMatchObject({ kind: "resumed", scene_id: "q3", scenes_completed: 3 });

    // Back in the chat, whose session still shows q1: its answer must not save q1's state over the pane's.
    const refused = answer(chat, inChat.sessionId);
    await expect(refused).rejects.toThrow(/^session not found: /);
    await expect(refused).rejects.toThrow(/went on in another session[^\n]*call start_lesson_session/);
    expect(await onDisk(pane)).toMatchObject({ kind: "resumed", scene_id: "q3", scenes_completed: 3 });
    // A later call on that session says the same, not « the server may have restarted ».
    await expect(answer(chat, inChat.sessionId)).rejects.toThrow(/went on in another session/);
  });

  it("start_lesson_session in the server whose session went stale takes the lesson up where the other surface left it", async () => {
    const { chat, pane } = setUp();
    const inChat = await chat.create("lesson.json");
    await answer(chat, inChat.sessionId);
    const paneHost = pane();
    const inPane = await paneHost.create("lesson.json", LEARNER);
    await answer(paneHost, inPane.sessionId);
    await answer(paneHost, inPane.sessionId);

    // D5 would hand back the chat's own open session, still at q1: the disk moved on, so it is not.
    const again = await chat.create("lesson.json");
    expect(again.resume).toMatchObject({ kind: "resumed", scene_id: "q3", scenes_completed: 3 });
    expect(again.sessionId).not.toBe(inChat.sessionId);
    // The new session plays on and saves.
    await answer(chat, again.sessionId);
    expect(await onDisk(pane)).toMatchObject({ kind: "resumed", scene_id: "q4", scenes_completed: 4 });
  });

  it("a session that is not stale goes on as before: D5 returns it, and its answers save", async () => {
    const { chat, pane } = setUp();
    const inChat = await chat.create("lesson.json");
    await answer(chat, inChat.sessionId);
    const same = await chat.create("lesson.json");
    expect(same.resume.kind).toBe("already_open");
    expect(same.sessionId).toBe(inChat.sessionId);
    await answer(chat, inChat.sessionId);
    await answer(chat, inChat.sessionId);
    expect(await onDisk(pane)).toMatchObject({ kind: "resumed", scene_id: "q3", scenes_completed: 3 });
  });

  it("closing a stale session does not write its older progress into the study record", async () => {
    const { chat, pane } = setUp();
    const inChat = await chat.create("lesson.json");
    await answer(chat, inChat.sessionId);
    const paneHost = pane();
    const inPane = await paneHost.create("lesson.json", LEARNER);
    await answer(paneHost, inPane.sessionId);
    await answer(paneHost, inPane.sessionId);
    await chat.close(inChat.sessionId);
    const plan = await pane().studyPlan(LEARNER);
    expect(plan.in_progress).toEqual([expect.objectContaining({ bundle_ref: "lesson.json", scenes_completed: 3 })]);
  });
});

// Review of the waiting branch, finding 4: the guard held only for a learner id nobody shares. With studium.learnerId
// set to "anonymous" or "agent-operator", the chat's server kept no stamp of what it loaded, and its stale answer saved
// over the pane's progress. When the editor names the learner, that learner is one person, whatever the id: the guard
// holds, and a second start in the chat finds its open session (D5), as for any named learner.
describe("D1: the editor's learner is guarded whatever its id", () => {
  for (const id of ["anonymous", "agent-operator"]) {
    it(`an answer from the chat that the pane moved on is refused for the editor's learner "${id}"`, async () => {
      const bundlesRoot = tmp();
      writeFileSync(join(bundlesRoot, "lesson.json"), JSON.stringify(LESSON));
      const dataDir = tmp();
      const chat = new SessionHost({ bundlesRoot, dataDir, live: false, defaultLearnerId: id, editorNamesLearner: true });
      const pane = () => new SessionHost({ bundlesRoot, dataDir, live: false });
      const inChat = await chat.create("lesson.json");
      await answer(chat, inChat.sessionId);
      const paneHost = pane();
      const inPane = await paneHost.create("lesson.json", id);
      await answer(paneHost, inPane.sessionId);
      await answer(paneHost, inPane.sessionId);
      await expect(answer(chat, inChat.sessionId)).rejects.toThrow(/went on in another session/);
      expect((await pane().create("lesson.json", id)).resume).toMatchObject({ kind: "resumed", scene_id: "q3", scenes_completed: 3 });
    });

    it(`a second start in the chat finds the session already open for the editor's learner "${id}"`, async () => {
      const bundlesRoot = tmp();
      writeFileSync(join(bundlesRoot, "lesson.json"), JSON.stringify(LESSON));
      const chat = new SessionHost({ bundlesRoot, dataDir: tmp(), live: false, defaultLearnerId: id, editorNamesLearner: true });
      const inChat = await chat.create("lesson.json");
      await answer(chat, inChat.sessionId);
      const again = await chat.create("lesson.json");
      expect(again.sessionId).toBe(inChat.sessionId);
      expect(again.resume.kind).toBe("already_open");
    });
  }

  it("leaves a shared id on a server where the editor does not name the learner as it was: never merged", async () => {
    const bundlesRoot = tmp();
    writeFileSync(join(bundlesRoot, "lesson.json"), JSON.stringify(LESSON));
    const host = new SessionHost({ bundlesRoot, dataDir: tmp(), live: false });
    const first = await host.create("lesson.json", "anonymous");
    expect((await host.create("lesson.json", "anonymous")).sessionId).not.toBe(first.sessionId);
  });
});
