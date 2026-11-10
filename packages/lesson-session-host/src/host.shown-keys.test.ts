// Audit 2026-11-10 (passe Fable, interface-harnais A2, proposal C2): a question whose answer key the
// learner has already been shown was asked again as a graded question — by a prerequisite gate that
// brought back `s4-quiz-balmer` after its feedback said « La bonne réponse : n = 3 → n = 2 », and as a
// check question of a contest of « Particules de l'atome » after `s1-quiz-fer` was corrected on screen.
// Such an answer measures immediate memory, not knowledge. The learner's lesson state now keeps the
// scenes whose reference was released (`reference_shown`), and neither the routing nor a contest serves
// one of them as a graded question again. Played on fixtures/atomistique-l1 by synthetic learners.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { SessionHost, type ServedTransition } from "./host.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as LessonBundle;
type Choice = { id: string; text: string; correct?: boolean };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Scene types whose answer is graded or compared against a reference the verdict may release. */
const GRADED = new Set(["quiz", "spot_the_flaw", "summary_audit", "explain_back", "comparison", "prompt_practice", "communication_sim", "ai_critique"]);
const releasesReference = (t: ServedTransition): boolean =>
  (t.verdict?.key_points?.length ?? 0) > 0 || t.verdict?.model_answer !== undefined;

/** A walk that answers every quiz wrong (except those in `right`), writes a short answer to every
 * written scene and rates its recall, and records each scene served as a graded question after its
 * reference was released. Stops at a learner-time run, which needs a real run. */
async function walk(host: SessionHost, sid: string, opts: {
  right?: ReadonlySet<string>; until?: (sceneId: string) => boolean;
  /** The audit's explore.mjs policy: these quizzes take the displayed choice named, others the first displayed. */
  explore?: Record<string, string>;
} = {}) {
  const shown = new Set<string>();
  const servedAfterShown: string[] = [];
  const served: string[] = [];
  const note = (t: ServedTransition) => {
    if (t.verdict && releasesReference(t)) shown.add(t.verdict.scene_id);
    const next = "presentation" in t ? t.presentation.scene : undefined;
    if (next && GRADED.has(next.type)) {
      served.push(next.id);
      if (shown.has(next.id)) servedAfterShown.push(next.id);
    }
  };
  for (let guard = 0; guard < 200; guard += 1) {
    const scene = host.currentPresentation(sid).scene as unknown as {
      id: string; type: string; choices?: Choice[]; deck?: Array<{ token: string }>; run_manifest?: unknown;
    };
    if (opts.until?.(scene.id)) break;
    if (scene.run_manifest) break;
    let t: ServedTransition;
    if (scene.type === "quiz") {
      const key = (authored.scenes.find((s) => s.id === scene.id) as unknown as { choices: Choice[] }).choices;
      const wanted = key.find((choice) => choice.correct === (opts.right?.has(scene.id) ?? false))!.text;
      const choiceId = opts.explore ? opts.explore[scene.id] ?? scene.choices![0]!.id : scene.choices!.find((c) => c.text === wanted)!.id;
      t = await host.respond(sid, { kind: "quiz_choice", choiceId, confidence: 1 }, "fast");
    } else if (scene.type === "spot_the_flaw" && scene.deck) {
      t = await host.respond(sid, { kind: "flaw_verdicts", verdicts: scene.deck.map((d, i) => ({ token: d.token, flagged: i === 0 })) }, "fast");
    } else if (scene.type === "meta_checkpoint") {
      t = await host.respond(sid, { kind: "confidence", value: 2 } as never, "fast");
    } else if (GRADED.has(scene.type)) {
      t = await host.respond(sid, { kind: "reply", text: "Une réponse d'essai écrite par l'audit, assez longue pour être notée." }, "fast");
      if (t.self_rating) await host.rateRecall(sid, t.self_rating.scene_id, "hard", "fast");
    } else {
      t = await host.respond(sid, { kind: "ack" }, "fast");
    }
    note(t);
    if (t.kind === "complete") break;
  }
  return { shown, servedAfterShown, served };
}

function host(dataDir: string | null = null) {
  return new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir });
}

describe("C2: a scene whose reference was shown is never asked again as a graded question", () => {
  it("a whole atomistique-l1 walk with wrong answers: no gate or detour serves a scene after its key was shown (Balmer)", async () => {
    const h = host();
    const sid = (await h.create(ATOMS, "synthetic-audit-keys-walk")).sessionId;
    const run = await walk(h, sid);
    expect(run.shown.has("s4-quiz-balmer")).toBe(true);           // the wrong answer's feedback showed n = 3 → n = 2
    expect(run.servedAfterShown).toEqual([]);
    // The register is the learner's: it is in the lesson state, with every scene whose key was shown.
    expect(new Set(h.getState(sid).reference_shown)).toEqual(run.shown);
  });

  it("the audit's own walk (explore.mjs): the gate does not bring s4-quiz-balmer back after its key was shown", async () => {
    const h = host();
    const sid = (await h.create(ATOMS, "synthetic-audit-keys-explore")).sessionId;
    const run = await walk(h, sid, { explore: { "s1-quiz-fer": "a", "s2-quiz-4f": "a", "s3-quiz-noeuds": "b" } });
    expect(run.shown.has("s4-quiz-balmer")).toBe(true);
    expect(run.servedAfterShown).toEqual([]);
  });

  it("a contest after s1-quiz-fer was corrected on screen does not ask s1-quiz-fer again", async () => {
    const h = host();
    const sid = (await h.create(ATOMS, "synthetic-audit-keys-contest")).sessionId;
    await walk(h, sid, { until: (id) => id === "s1b-audit-particules" });   // s1-quiz-fer answered wrong
    expect(h.conceptMapRecord(sid)!.contest.questions["c-particules"]).toBe(1);
    const started = await h.contest(sid, "c-particules", "known", "fast");
    expect(started.presentation.scene.id).toBe("s9-rappel-carbone14");
    expect(started.questions).toBe(1);
    expect(h.getState(sid).reference_shown).toContain("s1-quiz-fer");
    const key = (authored.scenes.find((s) => s.id === "s9-rappel-carbone14") as unknown as { choices: Choice[] }).choices;
    const shownChoices = (started.presentation.scene as unknown as { choices: Choice[] }).choices;
    const only = await h.respond(sid, { kind: "quiz_choice", choiceId: shownChoices.find((c) => c.text === key.find((k) => k.correct)!.text)!.id }, "fast");
    expect(only.contest).toMatchObject({ outcome: "partial", scene_ids: ["s9-rappel-carbone14"], results: [true] });
  });

  it("with no fresh question left, the concept cannot be contested, in one line", async () => {
    const h = host();
    const sid = (await h.create(ATOMS, "synthetic-audit-keys-nofresh")).sessionId;
    // c-periodicite has one key-graded scene, s6-quiz-tendance: answered wrong, its key is shown.
    await walk(h, sid, { until: (id) => id === "s7-concept-geometrie" });
    expect(h.conceptMapRecord(sid)!.contest.questions["c-periodicite"]).toBe(0);
    expect(h.getState(sid).reference_shown).toContain("s6-quiz-tendance");
    const message = await h.contest(sid, "c-periodicite", "known").then(() => "accepted", (error: Error) => error.message);
    expect(message).toMatch(/c-periodicite/);
    expect(message).not.toContain("\n");
  });

  it("a same-item replay withholds the key, so the scene is not registered until it is left for good", async () => {
    const root = mkdtempSync(join(tmpdir(), "shown-keys-replay-")); dirs.push(root);
    const quiz = (id: string) => ({
      id, type: "quiz", title: id, objective_refs: ["a"], concept_refs: ["a"], estimated_seconds: 30, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "Faux", correct: false }, { id: "b", text: "Juste", correct: true }],
      feedback_correct: "oui", feedback_incorrect: "non", hints: [],
    });
    writeFileSync(join(root, "lesson.json"), JSON.stringify({
      schema_version: "1.4", bundle_id: "replay-keys", source_plan_id: "p",
      metadata: { title: "Rejeu", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
      concepts: [{ id: "a", title: "A", description: "d", bloom_level_target: "understand" }],
      scenes: [quiz("q1"), { id: "end", type: "concept", title: "fin", objective_refs: ["a"], concept_refs: ["a"], estimated_seconds: 30, adaptation_hooks: [], markdown: "x" }],
      rules: [{ id: "retry", when: { answer_correct: "==false" }, action: { kind: "replay_current_scene", reason: "encore" }, modulator: "M1", explanation_short: "On reprend." }],
      validated_by: "teacher", validated_at: "2026-11-10T00:00:00Z",
    }));
    const h = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const sid = (await h.create("lesson.json", "synthetic-audit-keys-replay")).sessionId;
    const wrong = () => {
      const shown = h.currentPresentation(sid).scene as unknown as { choices: Choice[] };
      return h.respond(sid, { kind: "quiz_choice", choiceId: shown.choices.find((c) => c.text === "Faux")!.id }, "fast");
    };
    const first = await wrong();
    expect(first.kind).toBe("replay");
    expect(first.verdict).not.toHaveProperty("key_points");
    expect(h.getState(sid).reference_shown ?? []).toEqual([]);
  });

  it("the register survives a restart; a state saved without it loads as an empty register", async () => {
    const data = mkdtempSync(join(tmpdir(), "shown-keys-durable-")); dirs.push(data);
    const first = host(data);
    const sid = (await first.create(ATOMS, "synthetic-audit-keys-durable")).sessionId;
    await walk(first, sid, { until: (id) => id === "s1b-audit-particules" });
    expect(first.getState(sid).reference_shown).toContain("s1-quiz-fer");
    await first.close(sid);
    const second = host(data);
    const again = (await second.create(ATOMS, "synthetic-audit-keys-durable")).sessionId;
    expect(second.getState(again).reference_shown).toContain("s1-quiz-fer");
    expect((await second.contest(again, "c-particules", "known")).presentation.scene.id).toBe("s9-rappel-carbone14");
  });
});
