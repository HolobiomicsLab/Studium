// Audit 2026-11-10 (passe Fable, interface-harnais A3, A4): orientation says what the screen asks.
//   A3  a self-rating is waited for only on the screen that served its request: one the host held back
//       with the reference, or one left behind when the scene changed, is not, after a restart neither;
//       the request itself stays answerable;
//   A4  during a prerequisite detour the minutes left are counted from the scene the lesson returns to,
//       and the orientation names that main-path step, after a restart too.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { orientationOf } from "./orientation.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "orientation-screen-")); dirs.push(d); return d; }

const base = (id: string, concept: string, seconds: number) =>
  ({ id, title: `Scène ${id}`, objective_refs: [concept], concept_refs: [concept], estimated_seconds: seconds, adaptation_hooks: [] });
const quiz = (id: string, concept: string, seconds = 60) => ({
  ...base(id, concept, seconds), type: "quiz", question: "?",
  choices: [{ id: "a", text: "Faux", correct: false }, { id: "b", text: "Juste", correct: true }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const reading = (id: string, concept: string, seconds = 60) => ({ ...base(id, concept, seconds), type: "concept", markdown: "Le cours." });
const explain = (id: string, concept: string) => ({
  ...base(id, concept, 60), type: "explain_back", prompt: "Explique.", key_points: [{ id: "k1", text: "La phase compte.", cues: ["phase"] }],
  model_explanation: "La phase compte.", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});

function lesson(scenes: object[], edges: Array<[string, string]> = []) {
  const concepts = ["a", "dep"];
  return {
    schema_version: "1.4", bundle_id: "orientation-screen", source_plan_id: "p",
    metadata: { title: "Orientation", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
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
function bundles(content: object): string {
  const root = tmp();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(content));
  return root;
}
const pick = (h: SessionHost, sid: string, text: "Faux" | "Juste") =>
  (h.currentPresentation(sid).scene as unknown as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === text)!.id;

describe("A3: a self-rating is waited for only on the screen that serves it", () => {
  it("after a restart the request is not said on the resumed screen, and stays answerable", async () => {
    const root = bundles(lesson([explain("s-e", "a"), quiz("s-q", "dep"), reading("s-end", "dep")]));
    const data = tmp();
    const first = new SessionHost({ bundlesRoot: root, live: false, dataDir: data });
    const sid = (await first.create("lesson.json", "synthetic-audit-rating")).sessionId;
    const answered = await first.respond(sid, { kind: "reply", text: "La phase change le signe." });
    expect(answered.self_rating).toMatchObject({ requested: true, scene_id: "s-e" });
    expect(orientationOf(first, sid).waiting).toBe("self_rating");
    await first.close(sid);

    const second = new SessionHost({ bundlesRoot: root, live: false, dataDir: data });
    const again = (await second.create("lesson.json", "synthetic-audit-rating")).sessionId;
    expect(second.currentPresentation(again).scene.id).toBe("s-q");
    expect(orientationOf(second, again).waiting).toBe("answer");   // the quiz on screen waits for its answer
    const help = second.orientationFacts(again);
    expect(help.self_rating_pending).toBe(false);
    // The request was not lost: the learner may still rate their recall of s-e.
    await expect(second.rateRecall(again, "s-e", "good")).resolves.toBeDefined();
  });

  it("a request left behind when the scene changes is not said on the next screen", async () => {
    const root = bundles(lesson([explain("s-e", "a"), reading("s-r", "dep"), quiz("s-q", "dep")]));
    const h = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const sid = (await h.create("lesson.json", "synthetic-audit-left")).sessionId;
    await h.respond(sid, { kind: "reply", text: "La phase change le signe." });
    expect(orientationOf(h, sid).waiting).toBe("self_rating");
    await h.respond(sid, { kind: "ack" });                         // the learner moved on without rating
    expect(orientationOf(h, sid).waiting).toBe("answer");
    expect(h.orientationFacts(sid).self_rating_pending).toBe(false);
  });
});

describe("A4: the minutes left during a prerequisite detour", () => {
  it("are counted from the scene the detour returns to, and the orientation names that main-path step", async () => {
    // dep needs a. q-a (wrong) → c-dep is gated → the gate sends the learner to q-a2 at the end.
    const scenes = [quiz("q-a", "a", 60), reading("c-dep", "dep", 600), reading("c-dep2", "dep", 600), quiz("q-a2", "a", 60)];
    const root = bundles(lesson(scenes, [["dep", "a"]]));
    const h = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const sid = (await h.create("lesson.json", "synthetic-audit-detour")).sessionId;
    const t = await h.respond(sid, { kind: "quiz_choice", choiceId: pick(h, sid, "Faux") });
    expect(t.navigation).toMatchObject({ kind: "remediate", returns_to: "c-dep" });
    const o = orientationOf(h, sid);
    expect(o.step).toMatchObject({ index: 4, total: 4, detour: { returns_to: "c-dep" }, main: { index: 2, title: "Scène c-dep" } });
    expect(o.minutes_left).toBe(Math.ceil((60 + 600 + 600 + 60) / 60));   // q-a2, then c-dep onwards
  });
});
