// packages/lesson-session/src/grading/answer-graded-types.contract.test.ts
//
// INT-STUDIUM-037 — THE DRIFT GUARD BETWEEN THE GRADERS AND THE ROUTER.
//
// `graph-nav.ts` holds `ANSWER_GRADED_TYPES`, the scene types remediation will route a learner
// back to. Its comment used to read "scene types whose grading emits an answer_submitted signal".
// Nothing enforced that, and it was false: EIGHT types emit one and the set names two.
//
// Since INT-STUDIUM-035 candidate 2 the interesting predicate is no longer "emits an
// answer_submitted" anyway — it is "can a detour here raise mastery?", and offline that is true of
// only `quiz` and `spot_the_flaw`'s VERDICT DECK, the two paths scored against the key by identity
// rather than by looking for words in prose. The other six carry a `correct` only when a live
// evaluator declares `source: "llm"`.
//
// So there are THREE sets, they are all different, and prose kept them in step badly. This suite
// derives two of them by RUNNING the real graders — change a grader and the numbers here move on
// their own — and asserts the router's set against what it finds. It takes no position on what the
// router's set SHOULD be: choosing between "widen it and route offline learners into scenes that
// cannot converge" and "shrink it and cost a live deployment its free-text remediation" is the
// routing decision INT-STUDIUM-037 files and leaves to the owner. What must not happen again is
// the gap going unnoticed.
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade, GRADERS } from "./index.js";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator.js";
import { ANSWER_GRADED_TYPES } from "../graph-nav.js";
import type { ResponseInput } from "../types.js";

const deps = { critiqueEvaluator: new StubCritiqueEvaluator() }; // the DEFAULT tester path: no LLM
const rubric = { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 };
const keyPoints = [{ id: "k1", text: "un point", cues: ["cue"] }];
const flawClaims = [{ id: "c1", text: "une affirmation", flaws_expected: ["faille"] }];
const base = { title: "t", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [] };

/** One minimal scene per grader, plus the response its grader accepts. */
const CASES: Record<Scene["type"], { scene: object; input: ResponseInput }> = {
  intro: { scene: { id: "s", type: "intro", ...base, body: "b" }, input: { kind: "ack" } },
  concept: { scene: { id: "s", type: "concept", ...base, body: "b" }, input: { kind: "ack" } },
  reproduction: { scene: { id: "s", type: "reproduction", ...base, body: "b" }, input: { kind: "ack" } },
  discussion: { scene: { id: "s", type: "discussion", ...base, body: "b" }, input: { kind: "ack" } },
  meta_checkpoint: { scene: { id: "s", type: "meta_checkpoint", ...base }, input: { kind: "confidence", value: 3 } },
  quiz: {
    scene: { id: "s", type: "quiz", ...base, question: "?", hints: [], feedback_correct: "ok", feedback_incorrect: "no",
      choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }] },
    input: { kind: "quiz_choice", choiceId: "a" },
  },
  ai_critique: { scene: { id: "s", type: "ai_critique", ...base, claims: flawClaims, rubric }, input: { kind: "critique", text: "faille" } },
  spot_the_flaw: {
    scene: { id: "s", type: "spot_the_flaw", ...base, flawed_content: "f", claims: flawClaims, model_correction: "m", rubric },
    input: { kind: "flaw_report", text: "faille" },
  },
  explain_back: {
    scene: { id: "s", type: "explain_back", ...base, prompt: "p", key_points: keyPoints, model_explanation: "m", rubric },
    input: { kind: "explanation", text: "cue" },
  },
  comparison: {
    scene: { id: "s", type: "comparison", ...base, prompt: "p", artifact_a: "a", artifact_b: "b", key_points: keyPoints, model_answer: "m", rubric },
    input: { kind: "comparison", text: "cue" },
  },
  summary_audit: {
    scene: { id: "s", type: "summary_audit", ...base, source_content: "s", ai_summary: "a", claims: flawClaims, model_correction: "m", rubric },
    input: { kind: "summary_audit", text: "faille" },
  },
  prompt_practice: {
    scene: { id: "s", type: "prompt_practice", ...base, task: "t", key_points: keyPoints, model_prompt: "m", rubric },
    input: { kind: "prompt_submission", text: "cue" },
  },
  communication_sim: {
    scene: { id: "s", type: "communication_sim", ...base, scenario: "s", prompt: "p", key_points: keyPoints, model_response: "m", rubric },
    input: { kind: "communication", text: "cue" },
  },
};

async function measure() {
  const emits = new Set<string>();
  const certifiesOffline = new Set<string>();
  for (const type of Object.keys(GRADERS) as Scene["type"][]) {
    const c = CASES[type];
    const r = await grade(c.scene as Scene, c.input, deps);
    if (r.signal.kind !== "answer_submitted") continue;
    emits.add(type);
    if ("correct" in r.signal) certifiesOffline.add(type);
  }
  // spot_the_flaw's SECOND response mode. The learner ticks each claim flawed/sound and the marks
  // are scored against the key by identity — the project's one honest offline grade, and the reason
  // this type belongs in `certifiesOffline` even though its free-text mode does not certify.
  // Verdicts are keyed by the deck's OPAQUE positional token, never by claim id — one flaw claim and
  // no sound claims makes a one-item deck, so `d0` is it. The value of `correct` is not the point
  // here; its PRESENCE is.
  const deck = await grade(
    CASES.spot_the_flaw.scene as Scene,
    { kind: "flaw_verdicts", verdicts: [{ token: "d0", flagged: true }] },
    deps,
  );
  if (deck.signal.kind === "answer_submitted" && "correct" in deck.signal) certifiesOffline.add("spot_the_flaw");
  return { emits, certifiesOffline };
}

const sorted = (s: Set<string>) => [...s].sort();

describe("what the graders actually do (measured, not asserted)", () => {
  it("EIGHT scene types emit an answer_submitted", async () => {
    const { emits } = await measure();
    expect(sorted(emits)).toEqual([
      "ai_critique", "communication_sim", "comparison", "explain_back",
      "prompt_practice", "quiz", "spot_the_flaw", "summary_audit",
    ]);
  });

  it("but offline only TWO of them certify — INT-STUDIUM-035 candidate 2", async () => {
    const { certifiesOffline } = await measure();
    // quiz: the marked choice IS the ground truth. spot_the_flaw: via the verdict deck.
    expect(sorted(certifiesOffline)).toEqual(["quiz", "spot_the_flaw"]);
  });

  it("the six free-text types leave `correct` ABSENT, never false", async () => {
    for (const type of ["ai_critique", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim"] as const) {
      const c = CASES[type];
      const r = await grade(c.scene as Scene, c.input, deps);
      expect(r.signal.kind).toBe("answer_submitted");
      // absent — an unmeasured answer is not a wrong one
      expect("correct" in r.signal, `${type} carried a correct offline`).toBe(false);
    }
  });
});

describe("the router's set, against those facts", () => {
  it("is a strict subset of the emitting types — six emit and are never routed to", async () => {
    const { emits } = await measure();
    for (const t of ANSWER_GRADED_TYPES) expect(emits.has(t), `${t} is routed to but emits nothing`).toBe(true);
    const unroutable = sorted(emits).filter((t) => !ANSWER_GRADED_TYPES.has(t));
    expect(unroutable).toEqual([
      "communication_sim", "comparison", "explain_back", "prompt_practice", "spot_the_flaw", "summary_audit",
    ]);
  });

  // The candidate-2 consequence, stated as a test rather than as a comment. On the real
  // atomistique-l1 bundle this costs `concept:c-configuration` — assessed only by a
  // prompt_practice — its remediation, and the gate over it opens on the first try. That opening
  // is now announced (graph_prereq_unassessable, see session.prereq-unassessable.test.ts); which
  // of these two sets the router should use is the owner's, and is not decided here.
  it("holds one type that cannot converge offline, and misses one that can", async () => {
    const { certifiesOffline } = await measure();
    expect(ANSWER_GRADED_TYPES.has("ai_critique")).toBe(true);
    expect(certifiesOffline.has("ai_critique")).toBe(false); // routed to, cannot raise mastery offline
    expect(certifiesOffline.has("spot_the_flaw")).toBe(true);
    expect(ANSWER_GRADED_TYPES.has("spot_the_flaw")).toBe(false); // can raise mastery, never routed to
    // quiz is the only member of both — the one unambiguous remediation target the project has.
    const both = sorted(certifiesOffline).filter((t) => ANSWER_GRADED_TYPES.has(t));
    expect(both).toEqual(["quiz"]);
  });
});
