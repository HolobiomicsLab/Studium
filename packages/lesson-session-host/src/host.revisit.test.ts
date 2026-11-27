// Revisit a step already done (owner decision 2026-11-26, « précédent »): the host lists the main-path
// steps the learner already did and shows one as it was, read only. Neither call moves the session: the
// state, the path, the scene on screen and the memory stay exactly as they were.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "revisit-")); dirs.push(d); return d; }

const base = (id: string, concept: string) =>
  ({ id, title: `Scène ${id}`, objective_refs: [concept], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [] });
const quiz = (id: string, concept: string) => ({
  ...base(id, concept), type: "quiz", question: "Laquelle ?",
  choices: [{ id: "a", text: "Faux", correct: false }, { id: "b", text: "Juste", correct: true }],
  feedback_correct: "CLÉ : oui", feedback_incorrect: "CLÉ : non", hints: [],
});
const reading = (id: string, concept: string) => ({ ...base(id, concept), type: "concept", markdown: "Le cours." });

function lesson(scenes: object[], edges: Array<[string, string]> = []) {
  const concepts = ["a", "dep"];
  return {
    schema_version: "1.4", bundle_id: "revisit", source_plan_id: "p",
    metadata: { title: "Relecture", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: concepts.map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-11-10T00:00:00Z",
    ...(edges.length ? {
      learning_workflow_graph: {
        schema_version: "1.0", course_id: "c",
        nodes: concepts.map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" })),
        edges: edges.map(([source, target], i) => ({ id: `e${i}`, relation: "prerequisite_for", source: `concept:${source}`, target: `concept:${target}` })),
      },
    } : {}),
  };
}
async function open(content: object) {
  const root = tmp();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(content));
  const h = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
  const sid = (await h.create("lesson.json", "synthetic-revisit")).sessionId;
  return { h, sid };
}
const pick = (h: SessionHost, sid: string, text: "Faux" | "Juste") =>
  (h.currentPresentation(sid).scene as unknown as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === text)!.id;
const snapshot = (h: SessionHost, sid: string) => JSON.stringify({
  state: h.getState(sid), scene: h.currentPresentation(sid).scene.id, facts: h.orientationFacts(sid),
});

describe("the main-path steps already done", () => {
  it("are the scenes before the one on screen that the learner did, in lesson order", async () => {
    const { h, sid } = await open(lesson([reading("r1", "a"), quiz("q1", "a"), reading("r2", "dep"), quiz("q2", "dep")]));
    expect(h.revisitableSteps(sid)).toEqual([]);
    await h.respond(sid, { kind: "ack" });
    await h.respond(sid, { kind: "quiz_choice", choiceId: pick(h, sid, "Faux") });
    // The wrong answer may replay q1 or move on; either way only steps before the one on screen are listed.
    const onScreen = h.currentPresentation(sid).scene.id;
    const listed = h.revisitableSteps(sid);
    expect(listed[0]).toEqual({ index: 1, scene_id: "r1", title: "Scène r1" });
    expect(listed.map((s) => s.scene_id)).not.toContain(onScreen);
    expect(listed.map((s) => s.scene_id)).not.toContain("q2");
  });

  it("show a step as it was, public, with what the session recorded of the answer, and move nothing", async () => {
    const { h, sid } = await open(lesson([quiz("q1", "a"), reading("r2", "dep"), quiz("q2", "dep")]));
    await h.respond(sid, { kind: "quiz_choice", choiceId: pick(h, sid, "Juste") });
    expect(h.currentPresentation(sid).scene.id).toBe("r2");
    const before = snapshot(h, sid);
    const past = h.revisitScene(sid, "q1");
    expect(past).toMatchObject({ index: 0, total: 3, answered: true, correct: true, assessed_by: "key", scene: { id: "q1", question: "Laquelle ?" } });
    // The key stays with the host: no feedback halves, no right choice.
    expect(JSON.stringify(past.scene)).not.toMatch(/CLÉ|feedback_(?:correct|incorrect)/);
    expect((past.scene as unknown as { choices: object[] }).choices.every((c) => !("correct" in c))).toBe(true);
    expect(snapshot(h, sid)).toBe(before);
  });

  it("refuse a step not reached yet, and the step on screen", async () => {
    const { h, sid } = await open(lesson([quiz("q1", "a"), reading("r2", "dep"), quiz("q2", "dep")]));
    await h.respond(sid, { kind: "quiz_choice", choiceId: pick(h, sid, "Juste") });
    expect(() => h.revisitScene(sid, "q2")).toThrow(/not a step already done/);
    expect(() => h.revisitScene(sid, "r2")).toThrow(/not a step already done/);
    expect(() => h.revisitScene(sid, "nope")).toThrow(/not a step already done/);
  });

  it("on a prerequisite detour, are the main-path steps before the one the detour returns to", async () => {
    // dep needs a. q-a (wrong) gates c-dep: the learner is sent to q-a2, at the end of the lesson.
    const { h, sid } = await open(lesson([quiz("q-a", "a"), reading("c-dep", "dep"), reading("c-dep2", "dep"), quiz("q-a2", "a")], [["dep", "a"]]));
    const t = await h.respond(sid, { kind: "quiz_choice", choiceId: pick(h, sid, "Faux") });
    expect(t.navigation).toMatchObject({ kind: "remediate", returns_to: "c-dep" });
    expect(h.currentPresentation(sid).scene.id).toBe("q-a2");
    expect(h.revisitableSteps(sid)).toEqual([{ index: 1, scene_id: "q-a", title: "Scène q-a" }]);
    expect(() => h.revisitScene(sid, "q-a2")).toThrow(/not a step already done/);
    expect(() => h.revisitScene(sid, "c-dep")).toThrow(/not a step already done/);
    // Back on the main path: the detour's own step, further down the lesson, is not a step passed.
    await h.respond(sid, { kind: "quiz_choice", choiceId: pick(h, sid, "Juste") });
    expect(h.currentPresentation(sid).scene.id).toBe("c-dep");
    expect(h.revisitableSteps(sid).map((s) => s.scene_id)).toEqual(["q-a"]);
    expect(h.revisitScene(sid, "q-a")).toMatchObject({ answered: true, correct: false });
  });
});
