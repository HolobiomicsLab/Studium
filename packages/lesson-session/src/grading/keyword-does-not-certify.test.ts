// packages/lesson-session/src/grading/keyword-does-not-certify.test.ts
//
// INT-STUDIUM-035, the owner's decision (2026-09-10): CANDIDATE 2 — keep the keyword score as a
// coverage hint, and stop feeding `correct` from it.
//
// The measurement that forced the decision: driving the real atomistique-l1 bundle with answers
// written the way L1 students write them, 11 of 12 were graded against the teacher — 5 correct
// answers marked wrong and 6 wrong ones marked right. « Je ne vois aucune erreur… » scored 1.00
// for containing the three cue words. `matchClaimsAgainstCritique` credits a cue string appearing
// ANYWHERE, with no negation, no subject and no requirement of a sentence, so a pass on that path
// is a statement about vocabulary and was being spent as a statement about understanding: it fed
// `answer_submitted{correct}`, and through it the Beta posterior, FSRS scheduling and the concept
// gates.
//
// What changes here is ONLY the certification. The score, the coverage rate and the audit counts
// all remain — they are a useful hint about what an answer covered, and the collector's
// `keyword_graded_rate` (ADR 006 v1.6) says how much of a cohort they describe. What stops is the
// claim that the learner KNOWS the concept.
//
// The three paths that still certify, and why they are not the substring matcher:
//   - `quiz`     — a marked choice against the authored key. Ground truth.
//   - verdict deck — the learner marks each claim flawed/sound; scored against the key by IDENTITY,
//                    never by looking for words in prose.
//   - a live evaluator (`source: "llm"`) — the semantic judgement the offline path cannot make.
//
// Absence, not falsehood. An ungraded answer carries NO `correct` field at all rather than
// `correct: false`: the learner may well have been right, and recording a failure would be the
// same defect pointing the other way. This follows INT-STUDIUM-029's precedent — `matchesCondition`
// makes an absent context key a first-class answer, so no adaptation rule fires on it.
import { describe, it, expect } from "vitest";
import { grade } from "./graders";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator";
import { buildTestDeps } from "../testing";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { CritiqueEvaluator, CritiqueEvaluation } from "../ports";
import type { ResponseInput } from "../types";

const rubric = { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 };
const claims = [{ id: "c1", text: "la règle de Hund est violée", flaws_expected: ["hund"] }];
const keyPoints = [{ id: "k1", text: "le plan nodal", cues: ["nodal"] }];

/** An evaluator that answers the way a wired LLM shim does. */
class LlmLike implements CritiqueEvaluator {
  constructor(private readonly score = 0.9) {}
  async evaluate(): Promise<CritiqueEvaluation> {
    return { score: this.score, feedback: "[live]", source: "llm" };
  }
}

/** An evaluator that states no provenance — the pre-v1.6 shape, and any third-party adapter. */
class SilentEvaluator implements CritiqueEvaluator {
  async evaluate(): Promise<CritiqueEvaluation> {
    return { score: 0.9, feedback: "[silent]" };
  }
}

function scene<T extends Scene["type"]>(type: T, extra: Record<string, unknown>): Extract<Scene, { type: T }> {
  return {
    id: `s-${type}`, type, title: "T", objective_refs: [], concept_refs: ["c1"],
    estimated_seconds: 60, adaptation_hooks: [], rubric, ...extra,
  } as unknown as Extract<Scene, { type: T }>;
}

/** Every free-text scene type the runtime grades through the substring matcher, with an answer
 * that DOES contain the cue word — i.e. one the keyword path would have passed. */
const FREE_TEXT: Array<{ label: string; scene: Scene; input: ResponseInput }> = [
  { label: "ai_critique", scene: scene("ai_critique", { claims }), input: { kind: "critique", text: "hund" } },
  {
    label: "spot_the_flaw (free text)",
    scene: scene("spot_the_flaw", { claims, flawed_content: "…" }),
    input: { kind: "flaw_report", text: "hund" },
  },
  {
    label: "explain_back",
    scene: scene("explain_back", { prompt: "explique", key_points: keyPoints }),
    input: { kind: "explanation", text: "nodal" },
  },
  {
    label: "comparison",
    scene: scene("comparison", { prompt: "compare", key_points: keyPoints }),
    input: { kind: "comparison", text: "nodal" },
  },
  {
    label: "summary_audit",
    scene: scene("summary_audit", { claims, source_content: "…", ai_summary: "…" }),
    input: { kind: "summary_audit", text: "hund" },
  },
  {
    label: "prompt_practice",
    scene: scene("prompt_practice", { task: "rédige", key_points: keyPoints }),
    input: { kind: "prompt_submission", text: "nodal" },
  },
  {
    label: "communication_sim",
    scene: scene("communication_sim", { situation: "…", role: "…", audience: "…", key_points: keyPoints }),
    input: { kind: "communication", text: "nodal" },
  },
];

function keywordDeps() {
  return { ...buildTestDeps(), critiqueEvaluator: new StubCritiqueEvaluator() };
}
function critiqueEvent(telemetry: readonly unknown[]): Record<string, unknown> {
  const ev = telemetry.find((e) => (e as { type: string }).type === "critique_submitted");
  if (!ev) throw new Error("no critique_submitted emitted");
  return ev as Record<string, unknown>;
}

describe("a keyword score no longer certifies", () => {
  for (const { label, scene: sc, input } of FREE_TEXT) {
    it(`${label}: the cue word is present, the score passes, and NOTHING is certified`, async () => {
      const out = await grade(sc, input, keywordDeps());
      expect(out.signal.kind).toBe("answer_submitted");
      // Not `correct: false` — ABSENT. The learner may have been right; we did not measure it.
      expect("correct" in out.signal).toBe(false);
      // …and the score that would have certified is still there, above the 0.6 pass line.
      expect(critiqueEvent(out.telemetry).llm_score).toBeGreaterThanOrEqual(0.6);
      expect(critiqueEvent(out.telemetry).score_source).toBe("keyword");
    });
  }

  it("the word-soup answer that used to score 1.00 certifies nothing", async () => {
    // « hund celibataires 2p3 » — three words, no sentence. This is the exact shape of the
    // measurement in INT-STUDIUM-035's table.
    const out = await grade(
      scene("ai_critique", { claims: [{ id: "c1", text: "…", flaws_expected: ["hund"] }] }),
      { kind: "critique", text: "hund celibataires 2p3" },
      keywordDeps(),
    );
    expect(critiqueEvent(out.telemetry).llm_score).toBe(1);
    expect("correct" in out.signal).toBe(false);
  });

  it("an evaluator that states no provenance certifies nothing either", async () => {
    // Unknown provenance is not a licence. Treating a silent adapter as live would restore the
    // defect through the one door the v1.6 tag deliberately left open.
    const deps = { ...buildTestDeps(), critiqueEvaluator: new SilentEvaluator() };
    const out = await grade(FREE_TEXT[0]!.scene, FREE_TEXT[0]!.input, deps);
    expect("correct" in out.signal).toBe(false);
    expect("score_source" in critiqueEvent(out.telemetry)).toBe(false);
  });
});

describe("the coverage hint survives — this is candidate 2, not candidate 1", () => {
  it("completion_rate, llm_score and the audit counts are all still emitted", async () => {
    const out = await grade(FREE_TEXT[0]!.scene, FREE_TEXT[0]!.input, keywordDeps());
    const ev = critiqueEvent(out.telemetry);
    expect(typeof ev.llm_score).toBe("number");
    expect(typeof ev.completion_rate).toBe("number");
    expect(out.telemetry.some((e) => (e as { type: string }).type === "ai_audit_result")).toBe(true);
  });

  it("the scene still completes and still names its concept — the attempt is recorded", async () => {
    const out = await grade(FREE_TEXT[0]!.scene, FREE_TEXT[0]!.input, keywordDeps());
    expect(out.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", scene_id: "s-ai_critique" });
  });
});

describe("the three paths that still certify", () => {
  it("a live evaluator certifies, on the same scene and the same answer", async () => {
    const deps = { ...buildTestDeps(), critiqueEvaluator: new LlmLike(0.9) };
    const out = await grade(FREE_TEXT[0]!.scene, FREE_TEXT[0]!.input, deps);
    expect(out.signal).toMatchObject({ correct: true });
  });

  it("a live evaluator also records a FAILURE — it is the grading that returns, not the passing", async () => {
    const deps = { ...buildTestDeps(), critiqueEvaluator: new LlmLike(0.2) };
    const out = await grade(FREE_TEXT[0]!.scene, FREE_TEXT[0]!.input, deps);
    expect(out.signal).toMatchObject({ correct: false });
  });

  it("quiz is untouched: a marked choice is ground truth, not vocabulary", async () => {
    const quiz = scene("quiz", {
      question: "?", choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }],
    });
    const ok = await grade(quiz, { kind: "quiz_choice", choiceId: "a" }, keywordDeps());
    const ko = await grade(quiz, { kind: "quiz_choice", choiceId: "b" }, keywordDeps());
    expect(ok.signal).toMatchObject({ correct: true });
    expect(ko.signal).toMatchObject({ correct: false });
  });

  it("the verdict deck is untouched: it scores marks against the key by identity, not by words", async () => {
    // The deck is the trust instrument's KEY-FREE offline measurement — the learner ticks
    // flawed/sound and the scorer compares tokens, never prose. Collapsing it into the keyword
    // path would delete the one honest offline grade the project has.
    const deck = scene("spot_the_flaw", {
      claims, sound_claims: [{ id: "s1", text: "cette partie est correcte" }], flawed_content: "…",
    });
    const out = await grade(deck, { kind: "flaw_verdicts", verdicts: [] }, keywordDeps());
    expect(typeof (out.signal as { correct?: unknown }).correct).toBe("boolean");
    expect(critiqueEvent(out.telemetry).score_source).toBe("verdict_deck");
  });
});
