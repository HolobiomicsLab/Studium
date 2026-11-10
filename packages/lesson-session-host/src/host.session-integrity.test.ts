// Audit 2026-11-10 (passe Fable, usages apprenant): session-integrity defects reproduced over MCP.
//   D2  a duplicate or late answer was applied to the scene after the one it answered, and a typed
//       answer on a reading scene skipped it;
//   D5  two start_lesson_session of one learner on one lesson gave two live sessions that overwrote
//       each other;
//   D6  a restart during a prerequisite detour resumed past the gate the learner had just failed;
//   D10 forget_session answered in English whatever the learner's language.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost, STALE_SCENE_MESSAGE } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "session-integrity-")); dirs.push(d); return d; }

function quiz(id: string, concept: string) {
  return {
    id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept],
    estimated_seconds: 60, adaptation_hooks: [], question: "?",
    choices: [{ id: "a", text: "W", correct: false }, { id: "b", text: "R", correct: true }],
    feedback_correct: "correct", feedback_incorrect: "incorrect", hints: [],
  };
}
const reading = (id: string, type: "intro" | "concept", ref: string) =>
  ({ id, type, title: id, objective_refs: [ref], concept_refs: [ref], estimated_seconds: 60, adaptation_hooks: [], markdown: "text" });

/** intro, q-a, c-dep (gated on a), q-a2 (an item on a the gate can route to). */
function lesson(language = "fr") {
  return {
    schema_version: "1.4", bundle_id: "integrity", source_plan_id: "p",
    metadata: { title: "Intégrité", target: "L1", duration_minutes: 10, language, discipline: "x" },
    concepts: ["a", "dep"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
    scenes: [reading("s-intro", "intro", "a"), quiz("q-a", "a"), reading("c-dep", "concept", "dep"), quiz("q-a2", "a")],
    rules: [], validated_by: "teacher", validated_at: "2026-11-10T00:00:00Z",
    learning_workflow_graph: {
      schema_version: "1.0", course_id: "c",
      nodes: ["a", "dep"].map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" })),
      edges: [{ id: "dep-a", relation: "prerequisite_for", source: "concept:dep", target: "concept:a" }],
    },
  };
}
function bundles(language = "fr"): string {
  const root = tmp();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(lesson(language)));
  return root;
}
/** The id the quiz on screen displays for its right (or wrong) choice, after the load-time shuffle. */
function choice(h: SessionHost, id: string, right: boolean): string {
  const scene = h.currentPresentation(id).scene as { choices?: Array<{ id: string; correct: boolean }> };
  return scene.choices!.find((c) => c.correct === right)!.id;
}

describe("D2: an answer names the scene it answers", () => {
  it("refuses, in one line and changing nothing, an answer whose expected_scene_id is not the scene on screen", async () => {
    const h = new SessionHost({ bundlesRoot: bundles(), live: false, dataDir: null });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    await h.respond(sessionId, { kind: "ack" }, "companion", { expectedSceneId: "s-intro" });
    const answer = { kind: "quiz_choice" as const, choiceId: choice(h, sessionId, true) };
    const graded = await h.respond(sessionId, answer, "companion", { expectedSceneId: "q-a" });
    expect(graded.verdict?.scene_id).toBe("q-a");
    const before = JSON.stringify(h.getState(sessionId));
    const onScreen = h.currentPresentation(sessionId).scene.id;
    await expect(h.respond(sessionId, answer, "companion", { expectedSceneId: "q-a" })).rejects.toThrow(STALE_SCENE_MESSAGE);
    expect(STALE_SCENE_MESSAGE).not.toContain("\n");
    expect(h.currentPresentation(sessionId).scene.id).toBe(onScreen);
    expect(JSON.stringify(h.getState(sessionId))).toBe(before);
  });

  it("serialises two identical answers sent at once: the second is refused, not applied to the next scene", async () => {
    const h = new SessionHost({ bundlesRoot: bundles(), live: false, dataDir: null });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    await h.respond(sessionId, { kind: "ack" });
    const answer = { kind: "quiz_choice" as const, choiceId: choice(h, sessionId, true) };
    const results = await Promise.allSettled([1, 2].map(() => h.respond(sessionId, answer, "companion", { expectedSceneId: "q-a" })));
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(h.getState(sessionId).scenes_completed).toEqual(["s-intro", "q-a"]);
  });

  it("refuses a typed answer on a reading scene, and still takes ack and reply there", async () => {
    const h = new SessionHost({ bundlesRoot: bundles(), live: false, dataDir: null });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    for (const input of [
      { kind: "quiz_choice" as const, choiceId: "b" }, { kind: "explanation" as const, text: "parce que" },
      { kind: "confidence" as const, value: 2 as const }, { kind: "flaw_verdicts" as const, verdicts: [] },
    ]) {
      await expect(h.respond(sessionId, input)).rejects.toThrow(/^the scene on screen is a reading scene: it takes \{kind: "ack"\}/);
    }
    expect(h.currentPresentation(sessionId).scene.id).toBe("s-intro");
    expect((await h.respond(sessionId, { kind: "reply", text: "continuer" })).kind).toBe("next");
    expect(h.currentPresentation(sessionId).scene.id).toBe("q-a");
  });
});

describe("D5: one live session per learner and lesson in a server", () => {
  it("start returns the session already open for that learner and lesson, said so, where it was", async () => {
    const h = new SessionHost({ bundlesRoot: bundles(), live: false, dataDir: null });
    const first = await h.create("lesson.json", "synthetic-audit-ana");
    await h.respond(first.sessionId, { kind: "ack" });
    const again = await h.create("lesson.json", "synthetic-audit-ana");
    expect(again.sessionId).toBe(first.sessionId);
    expect(again.resume).toEqual({ kind: "already_open", scene_id: "q-a", scenes_completed: 1 });
    expect(again.presentation.scene.id).toBe("q-a");
    expect(again.presentation.display_markdown.split("\n")[0]).toMatch(/^Cette leçon était déjà ouverte\s?: elle continue où tu en étais\.$/u);
    // Another learner, or the same one after end_session, gets a session of their own.
    const other = await h.create("lesson.json", "synthetic-audit-ben");
    expect(other.sessionId).not.toBe(first.sessionId);
    await h.close(first.sessionId);
    const fresh = await h.create("lesson.json", "synthetic-audit-ana");
    expect(fresh.sessionId).not.toBe(first.sessionId);
    expect(fresh.resume.kind).not.toBe("already_open");
  });
});

describe("D6: a restart during a prerequisite detour", () => {
  it("resumes on the remediation, not past the gate the learner failed", async () => {
    const root = bundles();
    const data = tmp();
    const h = new SessionHost({ bundlesRoot: root, live: false, dataDir: data });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    await h.respond(sessionId, { kind: "ack" });
    const detour = await h.respond(sessionId, { kind: "quiz_choice", choiceId: choice(h, sessionId, false) });
    expect(detour.navigation).toMatchObject({ kind: "remediate", returns_to: "c-dep" });
    expect(h.currentPresentation(sessionId).scene.id).toBe("q-a2");
    await h.close(sessionId);

    const restarted = new SessionHost({ bundlesRoot: root, live: false, dataDir: data });
    const resumed = await restarted.create("lesson.json", "synthetic-audit-ana");
    expect(resumed.resume).toMatchObject({ kind: "resumed", scene_id: "q-a2" });
    const back = await restarted.respond(resumed.sessionId, { kind: "quiz_choice", choiceId: choice(restarted, resumed.sessionId, true) });
    expect(back.navigation?.kind).toBe("gate_passed");
    expect(restarted.currentPresentation(resumed.sessionId).scene.id).toBe("c-dep");
  });
});

describe("D10: forget_session speaks the learner's language", () => {
  it("says « nothing to erase » in the language asked for, else the server default", async () => {
    const h = new SessionHost({ bundlesRoot: bundles(), live: false, dataDir: null });
    expect((await h.forgetLearner("synthetic-audit-nobody", "fr")).display_markdown).toMatch(/^Rien à effacer\s?: aucune donnée n'est enregistrée pour toi ici\.$/u);
    expect((await h.forgetLearner("synthetic-audit-nobody")).display_markdown).toBe("Nothing to erase: no data is recorded for you here.");
  });

  it("uses the learner's last lesson language when no language is given", async () => {
    const h = new SessionHost({ bundlesRoot: bundles("fr"), live: false, dataDir: null });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    await h.respond(sessionId, { kind: "ack" });
    await h.respond(sessionId, { kind: "quiz_choice", choiceId: choice(h, sessionId, true) });
    expect((await h.forgetLearner("synthetic-audit-ana")).display_markdown).toMatch(/^\*\*Tes données sont effacées\.\*\*/);
  });

  it("forget by session takes the language asked for over the lesson's", async () => {
    const h = new SessionHost({ bundlesRoot: bundles("fr"), live: false, dataDir: null });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    expect((await h.forget(sessionId, "en")).display_markdown).toMatch(/^\*\*Your data is erased\.\*\*/);
  });
});

describe("D8: the status line during a contest's check questions", () => {
  it("counts the minutes left from where the lesson resumes, plus the check questions still to answer", async () => {
    const h = new SessionHost({ bundlesRoot: bundles(), live: false, dataDir: null });
    const { sessionId } = await h.create("lesson.json", "synthetic-audit-ana");
    await h.respond(sessionId, { kind: "ack" });
    await h.respond(sessionId, { kind: "quiz_choice", choiceId: choice(h, sessionId, true) });
    // On c-dep (60 s) with q-a2 (60 s) after it: two minutes left.
    expect(h.currentPresentation(sessionId).scene.id).toBe("c-dep");
    const before = h.orientationFacts(sessionId).seconds_left;
    expect(before).toBe(120);
    const started = await h.contest(sessionId, "a", "unsure");
    expect(started.questions).toBe(2);
    // The two check questions (60 s each), then the lesson again from c-dep.
    expect(h.orientationFacts(sessionId).seconds_left).toBe(120 + before);
    await h.respond(sessionId, { kind: "quiz_choice", choiceId: choice(h, sessionId, true) });
    expect(h.orientationFacts(sessionId).seconds_left).toBe(60 + before);
  });
});
