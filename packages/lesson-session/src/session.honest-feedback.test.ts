// RT-1 (spec D5, R4): the free-text feedback states a coverage count only when a judge measured it.
// The offline path used the substring matcher the project withdrew from grading in INT-STUDIUM-035,
// and on the 2026-10-30 probe it told a learner who negated every key point "4/4 covered" and a
// learner who paraphrased all four correctly "0/4 covered — Missing: <all four>". Offline, the
// verdict now reveals the reference points to compare against and asks for a self-rating (C4).
//
// Lead decision I-1 (integration wave, 2026-10-30): that reference is data on the verdict —
// `key_points` (the key points, or an audit's planted flaws) and `model_answer` — released with the
// verdict only, and the feedback text no longer repeats it: every surface renders the two fields (the
// host's display_markdown and feedback.md, the VS Code pane). The assertions that read « Compare ta
// réponse à ces points clés … ; Modèle : … » in `feedback` now read the two fields, and check that the
// feedback does not duplicate them; the chat wording is pinned in the host (chat-display.test.ts).
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultLearnerState } from "@studium/learner-state";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryEventLog } from "./testing.js";
import { StubCritiqueEvaluator } from "./adapters/critique-evaluator.js";
import { StubAuditJudge } from "./adapters/audit-judge.js";
import { verdictDeck } from "./grading/deck.js";
import { SelfRatingNotRequestedError } from "./errors.js";
import type { CritiqueEvaluator, AuditJudge } from "./ports.js";

const rubric = { completeness: 1, evidence_quality: 1, tone: 1 };
const KEY_POINTS = [
  { id: "kp-fonction", text: "La fonction d'onde change de signe", cues: ["fonction d onde"] },
  { id: "kp-signe", text: "Les deux lobes sont de signes opposés", cues: ["signe oppose"] },
  { id: "kp-nodal", text: "Un plan nodal sépare les lobes", cues: ["plan nodal"] },
  { id: "kp-probab", text: "Densité de probabilité de présence", cues: ["probabilite presence"] },
];
const NEGATED = "Rien a voir avec la fonction d'onde ; aucun signe opposé ; pas de plan nodal ; probabilité de présence uniforme.";
const PARAPHRASE = "Psi change de signe entre les deux lobes ; la surface qui les sépare est l'endroit où psi s'annule ; les lobes sont là où l'électron a le plus de chances d'être trouvé.";
const COUNT = /\d+\s*\/\s*\d+/;

const base = (id: string, type: string) => ({
  id, type, title: id, objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [],
});
const explainBack = (id = "s") => ({
  ...base(id, "explain_back"), prompt: "Explique les deux lobes de l'orbitale 2p.",
  key_points: KEY_POINTS, model_explanation: "La fonction d'onde change de signe de part et d'autre d'un plan nodal.", rubric,
});
const spotTheFlaw = <T extends object>(extra: T = {} as T) => ({
  ...base("s", "spot_the_flaw"), flawed_content: "N : 1s2 2s2 2p4, électrons appariés.",
  claims: [{ id: "f-hund", text: "Les électrons 2p sont appariés", flaws_expected: ["hund"] },
    { id: "f-count", text: "La sous-couche 2p porte 4 électrons", flaws_expected: ["2p3"] }],
  model_correction: "N : 1s2 2s2 2p3, règle de Hund, trois électrons célibataires.", rubric, ...extra,
});
const summaryAudit = () => ({
  ...base("s", "summary_audit"), source_content: "source", ai_summary: "résumé",
  claims: [{ id: "o-1", text: "Le résumé omet la règle de Hund", flaws_expected: ["hund"] }],
  model_correction: "Le résumé doit citer la règle de Hund.", rubric,
});
const aiCritique = () => ({
  ...base("s", "ai_critique"),
  claims: [{ id: "claim_a", text: "n=3 prouve l'effet", flaws_expected: ["petit échantillon"] },
    { id: "claim_b", text: "Le groupe témoin est apparié", flaws_expected: [] }],
  rubric,
});
const quiz = (id = "q") => ({
  ...base(id, "quiz"), question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
  feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
});

function bundle(scenes: object[], language = "fr"): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "honest", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 5, language, discipline: "x" },
    concepts: [{ id: "c", title: "c", description: "d", bloom_level_target: "understand" }],
    scenes, rules: [], validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z",
  } as unknown as LessonBundle;
}

async function answer(scenes: object[], input: object, deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator() }), language = "fr") {
  const session = new LessonSession(bundle(scenes, language), deps);
  await session.start();
  return { session, transition: await session.respond(input as never) };
}

/** A wired judge: an LLM evaluator that says which key points / claims it found covered. */
function judge(covered_ids: string[] | undefined, score = 0.7): CritiqueEvaluator {
  return { async evaluate() { return { score, feedback: "judged", source: "llm" as const, ...(covered_ids ? { covered_ids } : {}) }; } };
}

const MODEL = "La fonction d'onde change de signe de part et d'autre d'un plan nodal.";

/** The reference is on the verdict, says what its points are (key points to cover, or flaws an audit
 * should have caught), and the feedback text does not repeat it (I-1). */
function expectReferenceAsData(
  verdict: { feedback?: string; key_points?: string[]; model_answer?: string; reference_kind?: string } | undefined,
  points: string[], model: string, kind: "key_points" | "planted_flaws" = "key_points",
): void {
  expect(verdict?.key_points).toEqual(points);
  expect(verdict?.model_answer).toBe(model);
  expect(verdict?.reference_kind).toBe(kind);
  const feedback = verdict?.feedback ?? "";
  for (const point of points) expect(feedback).not.toContain(point);
  expect(feedback).not.toContain(model);
}

describe("RT-1 — offline free-text feedback asserts no coverage", () => {
  for (const [name, text] of [["negated answer", NEGATED], ["correct paraphrase", PARAPHRASE]] as const) {
    it(`${name}: no count, no "missing" list, the key points and the model to compare with`, async () => {
      const { transition } = await answer([explainBack()], { kind: "explanation", text });
      const feedback = transition.verdict?.feedback ?? "";
      expect(feedback).not.toMatch(COUNT);
      expect(feedback).not.toMatch(/couverts|Manquant/);
      expectReferenceAsData(transition.verdict, KEY_POINTS.map((point) => point.text), MODEL);
    });
  }

  it("an English bundle carries the same reference, and no count either", async () => {
    const { transition } = await answer([explainBack()], { kind: "explanation", text: NEGATED }, undefined, "en");
    expectReferenceAsData(transition.verdict, KEY_POINTS.map((point) => point.text), MODEL);
    expect(transition.verdict?.feedback ?? "").not.toMatch(/covered|Missing/);
  });

  it("spot_the_flaw free text: no planted-flaw count, the planted flaws and the correction instead", async () => {
    const { transition } = await answer([spotTheFlaw()], { kind: "flaw_report", text: "hund 2p3" });
    expect(transition.verdict?.feedback ?? "").not.toMatch(COUNT);
    expectReferenceAsData(transition.verdict, ["Les électrons 2p sont appariés", "La sous-couche 2p porte 4 électrons"],
      "N : 1s2 2s2 2p3, règle de Hund, trois électrons célibataires.", "planted_flaws");
  });

  it("summary_audit: no count, the omissions to compare with", async () => {
    const { transition } = await answer([summaryAudit()], { kind: "summary_audit", text: "hund" });
    expect(transition.verdict?.feedback ?? "").not.toMatch(COUNT);
    expectReferenceAsData(transition.verdict, ["Le résumé omet la règle de Hund"], "Le résumé doit citer la règle de Hund.", "planted_flaws");
  });

  // L-2 (2026-10-30, RFR-02): a WRONG quiz answer now releases its correct choice as reference data
  // (`correct_choice`), so the learner who leaves the item still wrong learns the right answer; this
  // test answered wrong and pinned "no reference", so it now pins that on a RIGHT answer, and that the
  // wrong one carries the correct choice and still no model answer.
  it("a right quiz verdict carries no reference fields; a wrong one only the correct choice", async () => {
    const right = await answer([quiz(), quiz("q2")], { kind: "quiz_choice", choiceId: "b" });
    expect(right.transition.verdict).not.toHaveProperty("key_points");
    expect(right.transition.verdict).not.toHaveProperty("model_answer");
    expect(right.transition.verdict).not.toHaveProperty("reference_kind");
    const { transition } = await answer([quiz(), quiz("q2")], { kind: "quiz_choice", choiceId: "a" });
    expect(transition.verdict).toMatchObject({ key_points: ["B"], reference_kind: "correct_choice" });
    expect(transition.verdict).not.toHaveProperty("model_answer");
  });

  // Integration tail T3 (2026-10-30): the ai_critique reference — each claim that hid a flaw, with the
  // flaws its author expected — moved from the feedback text into reference data, like the key-point and
  // audit scenes (I-1), so the host withholds it on a replay. The assertion that read it in `feedback`
  // now reads it in `key_points`, and checks that the feedback no longer carries it.
  it("ai_critique: no claims-addressed count, the flawed claims and their expected flaws as reference data", async () => {
    const { transition } = await answer([aiCritique()], { kind: "critique", text: "claim_a petit échantillon" });
    const feedback = transition.verdict?.feedback ?? "";
    expect(feedback).not.toMatch(COUNT);
    expect(transition.verdict?.key_points).toEqual(["n=3 prouve l'effet (petit échantillon)"]); // a sound claim is not a flaw to find
    expect(transition.verdict?.reference_kind).toBe("flawed_claims");
    expect(feedback).not.toContain("n=3 prouve l'effet");
    expect(feedback).not.toContain("petit échantillon");
    expect(feedback).not.toContain("Le groupe témoin est apparié");
    // ai_critique has no model answer.
    expect(transition.verdict).not.toHaveProperty("model_answer");
  });

  it("ai_critique whose claims hid no flaw: its claims are the reference, still not in the feedback", async () => {
    const scene = { ...aiCritique(), claims: [{ id: "claim_b", text: "Le groupe témoin est apparié", flaws_expected: [] }] };
    const { transition } = await answer([scene], { kind: "critique", text: "rien à redire" });
    expect(transition.verdict?.key_points).toEqual(["Le groupe témoin est apparié"]);
    expect(transition.verdict?.reference_kind).toBe("flawed_claims");
    expect(transition.verdict?.feedback ?? "").not.toContain("Le groupe témoin est apparié");
  });

  it("an LLM evaluator that names no covered ids still asserts no count", async () => {
    const deps = buildTestDeps({ critiqueEvaluator: judge(undefined) });
    const { transition } = await answer([explainBack()], { kind: "explanation", text: PARAPHRASE }, deps);
    expect(transition.verdict?.feedback ?? "").not.toMatch(COUNT);
  });

  it("spot_the_flaw with the offline stub audit judge: its keyword catch is no count either", async () => {
    const deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator(), auditJudge: new StubAuditJudge() });
    const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }] });
    // The stub catches f-hund by its tokens, so before the fix this read "1/2 défauts plantés trouvés".
    const { transition } = await answer([scene], { kind: "flaw_report", text: "Les électrons 2p sont appariés : faux" }, deps);
    expect(transition.verdict?.feedback ?? "").not.toMatch(COUNT);
    expectReferenceAsData(transition.verdict, ["Les électrons 2p sont appariés", "La sous-couche 2p porte 4 électrons"],
      "N : 1s2 2s2 2p3, règle de Hund, trois électrons célibataires.", "planted_flaws");
  });

  it("an audit judge that fell back to keywords, or does not say how it judged, is no count", async () => {
    for (const source of ["keyword", undefined] as const) {
      const auditJudge: AuditJudge = {
        async judge() { return { caught_flaw_ids: ["f-hund"], wrongly_flagged_sound_ids: [], ...(source ? { source } : {}) }; },
      };
      const deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator(), auditJudge });
      const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }] });
      const { transition } = await answer([scene], { kind: "flaw_report", text: "hund" }, deps);
      expect(transition.verdict?.feedback ?? "", `source ${String(source)}`).not.toMatch(COUNT);
    }
  });
});

describe("RT-1 — with a judge, the feedback is built from the ids it found covered", () => {
  it("counts and names what the judge measured", async () => {
    const deps = buildTestDeps({ critiqueEvaluator: judge(["kp-signe", "kp-nodal"]) });
    const { transition } = await answer([explainBack()], { kind: "explanation", text: PARAPHRASE }, deps);
    const feedback = transition.verdict?.feedback ?? "";
    expect(feedback).toContain("2/4 points clés couverts");
    // Which points were missing is reference data now (I-1, review of G1): withheld with the key points
    // until the learner leaves the scene, and not repeated in the feedback text.
    expect(feedback).not.toContain("Manquant");
    expect(transition.verdict?.key_points_missing).toEqual(["La fonction d'onde change de signe", "Densité de probabilité de présence"]);
    // The model answer is data now (I-1), not a « Modèle : » tail of the judged feedback.
    expect(feedback).not.toContain("Modèle : ");
    expect(transition.verdict?.model_answer).toBe(MODEL);
    expect(transition.verdict?.key_points).toEqual(KEY_POINTS.map((point) => point.text));
  });

  it("ignores ids the scene does not declare, and counts each id once", async () => {
    const deps = buildTestDeps({ critiqueEvaluator: judge(["kp-signe", "kp-signe", "kp-invented"]) });
    const { transition } = await answer([explainBack()], { kind: "explanation", text: PARAPHRASE }, deps);
    expect(transition.verdict?.feedback).toContain("1/4 points clés couverts");
  });

  it("ai_critique counts the claims the judge found addressed", async () => {
    const deps = buildTestDeps({ critiqueEvaluator: judge(["claim_a"]) });
    const { transition } = await answer([aiCritique()], { kind: "critique", text: "x" }, deps);
    expect(transition.verdict?.feedback).toContain("1/2 affirmations traitées");
    // T3: the judged verdict carries the same reference as data, as the key-point scenes do.
    expect(transition.verdict).toMatchObject({ key_points: ["n=3 prouve l'effet (petit échantillon)"], reference_kind: "flawed_claims" });
    expect(transition.verdict?.feedback).not.toContain("n=3 prouve l'effet");
  });

  // L-5 (2026-10-30): the French catalogue is typeset — a narrow no-break space before « ; ».
  it("spot_the_flaw with the audit judge counts caught flaws and false alarms", async () => {
    const auditJudge: AuditJudge = { async judge() { return { caught_flaw_ids: ["f-hund"], wrongly_flagged_sound_ids: ["ok"], source: "llm" }; } };
    const deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator(), auditJudge });
    const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }] });
    const { transition } = await answer([scene], { kind: "flaw_report", text: "hund" }, deps);
    expect(transition.verdict?.feedback).toContain("1/2 défauts plantés trouvés\u202f; 1/1 fausses alertes");
  });

  it("the verdict deck keeps its identity-scored counts", async () => {
    const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }], verdict_deck: true });
    const deck = verdictDeck(scene.claims, scene.sound_claims, scene.id);
    const verdicts = deck.map((item) => ({ token: item.token, flagged: item.flawed }));
    const { transition } = await answer([scene], { kind: "flaw_verdicts", verdicts });
    expect(transition.verdict?.feedback).toContain("2/2 défauts plantés trouvés\u202f; 0/1 fausses alertes");
  });
});

describe("C4 — an uncertified production answer asks for a self-rating", () => {
  const GRADES = ["again", "hard", "good", "easy"];

  it("the transition after an uncertified free-text answer requests it", async () => {
    const { transition } = await answer([explainBack(), quiz()], { kind: "explanation", text: PARAPHRASE });
    expect(transition.self_rating).toEqual({ requested: true, grades: GRADES });
  });

  it("a quiz, a verdict deck and a judged answer request none", async () => {
    const onQuiz = await answer([quiz()], { kind: "quiz_choice", choiceId: "b" });
    expect(onQuiz.transition.self_rating).toBeUndefined();
    const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }], verdict_deck: true });
    const verdicts = verdictDeck(scene.claims, scene.sound_claims, scene.id).map((item) => ({ token: item.token, flagged: item.flawed }));
    const onDeck = await answer([scene], { kind: "flaw_verdicts", verdicts });
    expect(onDeck.transition.self_rating).toBeUndefined();
    const judged = await answer([explainBack()], { kind: "explanation", text: PARAPHRASE }, buildTestDeps({ critiqueEvaluator: judge(["kp-signe"]) }));
    expect(judged.transition.self_rating).toBeUndefined();
  });

  it("rateRecall records an FSRS grade with self_rated provenance and never moves mastery", async () => {
    const eventLog = new InMemoryEventLog();
    const deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator(), eventLog });
    const { session } = await answer([explainBack(), quiz()], { kind: "explanation", text: PARAPHRASE }, deps);
    const before = session.getState();
    const record = await session.rateRecall("s", "good");
    expect(record).toMatchObject({ scene_id: "s", concept_id: "c", grade: "good", fsrs_grade: 3, source: "self_rated" });
    expect(Number.isNaN(Date.parse(record.rated_at))).toBe(false);
    const after = session.getState();
    expect(after.concept_states).toEqual(before.concept_states);
    expect(after.history).toHaveLength(before.history.length);
    expect(eventLog.records.at(-1)).toMatchObject({ event_type: "recall_self_rated", payload: { scene_id: "s", grade: "good", source: "self_rated" } });
  });

  it("maps again|hard|good|easy to FSRS 1..4", async () => {
    for (const [grade, fsrs] of [["again", 1], ["hard", 2], ["good", 3], ["easy", 4]] as const) {
      const { session } = await answer([explainBack(), quiz()], { kind: "explanation", text: PARAPHRASE });
      expect((await session.rateRecall("s", grade)).fsrs_grade).toBe(fsrs);
    }
  });

  it("refuses a rating nobody asked for, a second rating, and an unknown grade", async () => {
    const { session } = await answer([explainBack(), quiz()], { kind: "explanation", text: PARAPHRASE });
    await expect(session.rateRecall("q", "good")).rejects.toBeInstanceOf(SelfRatingNotRequestedError);
    await expect(session.rateRecall("s", "great" as never)).rejects.toThrow(/again\|hard\|good\|easy/);
    await session.rateRecall("s", "easy");
    await expect(session.rateRecall("s", "easy")).rejects.toBeInstanceOf(SelfRatingNotRequestedError);
  });

  it("accepts the rating of the last scene after the lesson completes", async () => {
    const { session, transition } = await answer([explainBack()], { kind: "explanation", text: PARAPHRASE });
    expect(transition.kind).toBe("complete");
    expect(transition.self_rating?.requested).toBe(true);
    await expect(session.rateRecall("s", "hard")).resolves.toMatchObject({ fsrs_grade: 2 });
  });

  it("a learner state carried in from a previous session is untouched by the request itself", async () => {
    const state = defaultLearnerState("honest");
    const session = new LessonSession(bundle([explainBack(), quiz()]), buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator() }), state);
    await session.start();
    await session.respond({ kind: "explanation", text: PARAPHRASE });
    expect(session.getState().concept_states.c).toMatchObject({ total_attempts: 0, ungraded_attempts: 1 });
  });
});
