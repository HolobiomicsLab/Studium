// The verdict-deck path of the spot_the_flaw grader: a per-claim flagged/sound response yields a REAL
// false-alarm count (over-distrust) with zero LLM, feeding the same judgment_audit the free-text/judge
// paths emit — but only when the scene is grounded in a real executed result.
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import { verdictDeck } from "./deck.js";
import type { CritiqueEvaluator } from "../ports.js";
import type { ResponseInput } from "../types.js";

const groundedRun = {
  ran: true, passed: true, landmark: "k=0.42", figure_path: null,
  checks: [{ check: "produced", passed: true }],
  provenance: { capsule_doi: null, cmd: ["python", "run.py"], env: "uv" },
};

function deckScene(grounded: boolean): Extract<Scene, { type: "spot_the_flaw" }> {
  return {
    id: "deck1", type: "spot_the_flaw", title: "t", objective_refs: [], concept_refs: ["c1"],
    estimated_seconds: 60, adaptation_hooks: [],
    flawed_content: "A flawed AI reading of the run.",
    claims: [
      { id: "f1", text: "k is dimensionless", flaws_expected: ["dimensionless"] },
      { id: "f2", text: "the half-life is 10 s", flaws_expected: ["half-life"] },
    ],
    model_correction: "corrected",
    rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
    sound_claims: [{ id: "s1", text: "k is a first-order rate" }, { id: "s2", text: "fit by regression" }],
    verdict_deck: true,
    ...(grounded ? { reference_result: groundedRun } : {}),
  };
}

const evalStub: CritiqueEvaluator = { async evaluate() { return { score: 1, feedback: "" }; } };

function verdicts(scene: Extract<Scene, { type: "spot_the_flaw" }>, opts: { flagFlaws: boolean; flagSound: number }) {
  const deck = verdictDeck(scene.claims, scene.sound_claims ?? [], scene.id);
  const out: Array<{ token: string; flagged: boolean }> = [];
  if (opts.flagFlaws) for (const i of deck.filter((d) => d.flawed)) out.push({ token: i.token, flagged: true });
  for (const i of deck.filter((d) => !d.flawed).slice(0, opts.flagSound)) out.push({ token: i.token, flagged: true });
  return { kind: "flaw_verdicts", verdicts: out } as Extract<ResponseInput, { kind: "flaw_verdicts" }>;
}

describe("spot_the_flaw verdict-deck grader", () => {
  it("a perfect audit (flag both flaws, no sound) grounded -> full judgment_audit, no false alarms", async () => {
    const scene = deckScene(true);
    const r = await grade(scene, verdicts(scene, { flagFlaws: true, flagSound: 0 }), { critiqueEvaluator: evalStub });
    expect(r.signal).toMatchObject({
      kind: "answer_submitted", concept_id: "c1", correct: true,
      judgment_audit: { grounded: true, planted: 2, caught: 2, false_positives: 0, sound_total: 2 },
    });
    expect(r.telemetry[1]).toMatchObject({ planted_errors: 2, true_positives: 2, false_positives: 0, missed: 0 });
  });

  it("flagging a SOUND claim registers over-distrust (false_positives>0) KEY-FREE", async () => {
    const scene = deckScene(true);
    const r = await grade(scene, verdicts(scene, { flagFlaws: true, flagSound: 1 }), { critiqueEvaluator: evalStub });
    expect(r.signal).toMatchObject({ judgment_audit: { false_positives: 1, sound_total: 2 } });
  });

  it("an UNGROUNDED deck scene never feeds trust (no judgment_audit on the signal)", async () => {
    const scene = deckScene(false);
    const r = await grade(scene, verdicts(scene, { flagFlaws: true, flagSound: 0 }), { critiqueEvaluator: evalStub });
    expect("judgment_audit" in r.signal).toBe(false);
    expect(r.telemetry[1]).toMatchObject({ planted_errors: 2, true_positives: 2 }); // coverage telemetry still emitted
  });

  it("missing every flaw and flagging every sound claim -> failing + max over-distrust", async () => {
    const scene = deckScene(true);
    const r = await grade(scene, verdicts(scene, { flagFlaws: false, flagSound: 2 }), { critiqueEvaluator: evalStub });
    expect(r.signal).toMatchObject({ correct: false, judgment_audit: { caught: 0, false_positives: 2, sound_total: 2 } });
  });
});
