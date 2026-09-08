// packages/lesson-session/src/grading/graders.ts
import type { Scene, BloomLevel } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import type { ResponseInput } from "../types.js";
import type { EmitInput } from "../telemetry.js";
import type { CritiqueEvaluator, AuditJudge } from "../ports.js";
import { matchClaimsAgainstCritique } from "./ai-audit-matcher.js";
import { scoreVerdictDeck } from "./deck.js";
import { SceneGradingError } from "../errors.js";

export interface GradeResult { signal: Signal; telemetry: EmitInput[]; }
export interface GradeDeps {
  critiqueEvaluator: CritiqueEvaluator;
  /** OPTIONAL LLM-backed audit judge. When present AND the scene carries `sound_claims`, it supplies the
   * over-distrust direction (false positives) the keyword matcher cannot. Absent ⇒ keyword matcher ⇒ fp=0
   * (the documented honesty boundary). */
  auditJudge?: AuditJudge;
  hintCount?: number;
  bloomLevel?: BloomLevel;
}
type Grader = (scene: Scene, input: ResponseInput, deps: GradeDeps) => Promise<GradeResult>;

const DIFFICULTY = { quiz: 0.5, ai_critique: 0.7, spot_the_flaw: 0.7, explain_back: 0.7, comparison: 0.7, summary_audit: 0.7, prompt_practice: 0.7, communication_sim: 0.7 } as const;

// M1: item difficulty (the IRT weight `w` fed to beta-updater) derives from the scene
// concept's Bloom level via this monotone map. ANCHOR: `understand` -> 0.5 == the legacy
// flat quiz default, so bundles whose concepts are `understand` (and the absent-bloom
// fallback) behave EXACTLY as before. Higher Bloom -> higher w -> a correct answer earns
// less alpha ((1-w)+1 shrinks) and a wrong answer adds more beta — i.e. mastering an
// `analyze` concept is genuinely harder to certify than a `remember` one.
const BLOOM_DIFFICULTY: Record<BloomLevel, number> = {
  remember: 0.3, understand: 0.5, apply: 0.6, analyze: 0.7, evaluate: 0.8, create: 0.9,
};

function difficultyForBloom(bloom: BloomLevel | undefined, fallback: number): number {
  return bloom ? BLOOM_DIFFICULTY[bloom] : fallback;
}

function conceptOf(scene: Scene): string {
  return ("concept_refs" in scene ? scene.concept_refs[0] : undefined) ?? "default";
}

const ackGrader: Grader = async (scene) => ({
  signal: { kind: "scene_completed", scene_id: scene.id, duration_ms: 0 },
  telemetry: [],
});

const quizGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "quiz") throw new SceneGradingError(scene.type, "quizGrader on non-quiz");
  if (input.kind !== "quiz_choice") throw new SceneGradingError(scene.type, `expected quiz_choice, got ${input.kind}`);
  const choice = scene.choices.find((c) => c.id === input.choiceId);
  const correct = choice?.correct ?? false;
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct, time_ms: 0, hint_count: deps.hintCount ?? 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.quiz) },
    telemetry: [{ type: "quiz_answered", scene_id: scene.id, item_id: input.choiceId, correct, response_time_ms: 0, confidence: 0.5 }],
  };
};

const metaGrader: Grader = async (scene, input) => {
  if (scene.type !== "meta_checkpoint") throw new SceneGradingError(scene.type, "metaGrader on non-meta_checkpoint");
  if (input.kind !== "confidence") throw new SceneGradingError(scene.type, `expected confidence, got ${input.kind}`);
  // M3: tie the declared confidence to the meta scene's concept so the engine can compare it
  // against that concept's actual accumulated mastery (calibration loop).
  return { signal: { kind: "confidence_declared", scene_id: scene.id, value: input.value, concept_id: conceptOf(scene) }, telemetry: [] };
};

const critiqueGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "ai_critique") throw new SceneGradingError(scene.type, "critiqueGrader on non-ai_critique");
  if (input.kind !== "critique") throw new SceneGradingError(scene.type, `expected critique, got ${input.kind}`);
  const { score } = await deps.critiqueEvaluator.evaluate({ claims: scene.claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  const trimmed = input.text.trim().toLowerCase();
  const mentioned = scene.claims.reduce((n, c) => n + (trimmed.includes(c.id.toLowerCase()) ? 1 : 0), 0);
  const completion_rate = scene.claims.length === 0 ? 0 : Math.max(0, Math.min(1, mentioned / scene.claims.length));
  const audit = matchClaimsAgainstCritique(scene.claims, input.text);
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.ai_critique) },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "ai_critique", llm_score: Math.max(0, Math.min(1, score)), completion_rate },
      // sound_total 0: the keyword matcher holds the planted-flaw key only, so over-distrust is UNMEASURED here.
      { type: "ai_audit_result", scene_id: scene.id, planted_errors: audit.planted_errors, true_positives: audit.true_positives, false_positives: audit.false_positives, missed: audit.missed, sound_total: 0 },
    ],
  };
};

type SpotScene = Extract<Scene, { type: "spot_the_flaw" }>;
type FlawVerdictsInput = Extract<ResponseInput, { kind: "flaw_verdicts" }>;

// VERDICT-DECK path — the learner marks each deck item flawed/sound. A checkbox IS a flagging decision,
// so false alarms on the sound claims are COUNTED with zero LLM — real over-distrust offline (closes the
// keyword path's fp=0 boundary). Feeds the SAME judgment_audit shape the free-text/judge paths emit
// (grounded-gated), so recordJudgmentAudit + the SDT diagnostic see it identically. The pass/score is
// deck accuracy (hits + correct rejections) rather than free-text coverage.
function gradeFlawVerdicts(scene: SpotScene, input: FlawVerdictsInput, deps: GradeDeps): GradeResult {
  const soundClaims = scene.sound_claims ?? [];
  const s = scoreVerdictDeck(scene.claims, soundClaims, scene.id, input.verdicts);
  const passed = s.accuracy >= 0.6;
  const missed = Math.max(0, s.planted - s.caught);
  const completion_rate = s.planted === 0 ? 0 : s.caught / s.planted;
  const grounded = scene.reference_result != null;
  return {
    signal: {
      kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0,
      difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.spot_the_flaw),
      ...(grounded
        ? { judgment_audit: { grounded: true as const, planted: s.planted, caught: s.caught, false_positives: s.falsePositives, sound_total: s.soundTotal } }
        : {}),
    },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "spot_the_flaw", llm_score: Math.max(0, Math.min(1, s.accuracy)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
      // sound_total carries the deck's SOUND population — the denominator collector-side over-distrust needs.
      { type: "ai_audit_result", scene_id: scene.id, planted_errors: s.planted, true_positives: s.caught, false_positives: s.falsePositives, missed, sound_total: s.soundTotal },
    ],
  };
}

// spot_the_flaw — a learner-as-auditor variant of ai_critique: the scene embeds a deliberately-flawed
// mini-lesson (flawed_content) and the answer-key claims; the learner names the flaws (free text) OR marks
// a verdict deck (flaw_verdicts → gradeFlawVerdicts). We reuse the SAME CritiqueEvaluator + flaw matcher
// for the free-text path, so scoring degrades offline to deterministic flaw coverage (true_positives /
// planted_errors). model_correction is authored but graded-against only via the evaluator (never leaked).
const flawGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "spot_the_flaw") throw new SceneGradingError(scene.type, "flawGrader on non-spot_the_flaw");
  if (input.kind === "flaw_verdicts") return gradeFlawVerdicts(scene, input, deps);
  if (input.kind !== "flaw_report") throw new SceneGradingError(scene.type, `expected flaw_report or flaw_verdicts, got ${input.kind}`);
  const { score } = await deps.critiqueEvaluator.evaluate({ claims: scene.claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  // AUDIT COUNTS feed trust_calibration. CLAIM-GRANULAR in BOTH paths (planted = number of distinct
  // planted-flaw CLAIMS, caught = distinct flaw claims identified) so the over_trust the engine derives
  // (missed/planted) is comparable whether or not a live judge is wired:
  //  - keyword matcher (default/offline): a CLAIM is caught when ANY of its flaws_expected keywords match
  //    (the keywords are alternative phrasings of one flaw). false_positives ALWAYS 0 + sound_total 0 —
  //    it holds the planted-flaw key, not the SOUND claims, so it can't tell a flagged sound claim from
  //    praise; over-distrust stays unmeasured (the honesty boundary).
  //  - LLM AuditJudge (when injected AND the scene declares `sound_claims`): told BOTH the planted flaws
  //    and the sound claims, it reports caught flaws AND wrongly-flagged sound claims — the OVER-DISTRUST
  //    direction. Ids are GUARDED against hallucination (only ids that exist in the scene's keys count).
  const soundClaims = scene.sound_claims ?? [];
  const flawIds = new Set(scene.claims.map((c) => c.id));
  const planted = flawIds.size; // DISTINCT flaw-claim count — the unit recordJudgmentAudit normalizes by
  let true_positives: number, false_positives: number, sound_total: number;
  if (deps.auditJudge && soundClaims.length > 0) {
    const j = await deps.auditJudge.judge({
      flawed_content: scene.flawed_content,
      flawed_claims: scene.claims.map((c) => ({ id: c.id, text: c.text })),
      sound_claims: soundClaims.map((s) => ({ id: s.id, text: s.text })),
      critique: input.text,
    });
    const soundIds = new Set(soundClaims.map((s) => s.id));
    true_positives = new Set(j.caught_flaw_ids.filter((id) => flawIds.has(id))).size;
    false_positives = new Set(j.wrongly_flagged_sound_ids.filter((id) => soundIds.has(id))).size;
    sound_total = soundIds.size;
  } else {
    // claim-granular keyword fallback: a claim is caught if any of its keywords appears in the critique.
    const caught = new Set(
      scene.claims.filter((c) => matchClaimsAgainstCritique([c], input.text).true_positives > 0).map((c) => c.id),
    );
    true_positives = caught.size; false_positives = 0; sound_total = 0;
  }
  const missed = Math.max(0, planted - true_positives);
  const completion_rate = planted === 0 ? 0 : true_positives / planted;
  // JUDGMENT-OVER-ARTIFACT (the north-star destination): when the scene is GROUNDED in a real executed
  // result (carries a reference_result), the audit breakdown is a TRUST-calibration signal the engine
  // folds into trust_calibration — missed planted flaws = over-trust (credulous of a wrong AI reading),
  // wrongly-flagged sound claims = over-distrust (false_positives/sound_total). Attached ONLY when
  // grounded; an ungrounded spot_the_flaw never feeds the trust dimension. With a live AuditJudge +
  // sound_claims, false_positives can be > 0, so BOTH trust directions are measurable live.
  const grounded = scene.reference_result != null;
  return {
    signal: {
      kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0,
      difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.spot_the_flaw),
      ...(grounded
        ? { judgment_audit: { grounded: true as const, planted, caught: true_positives, false_positives, sound_total } }
        : {}),
    },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "spot_the_flaw", llm_score: Math.max(0, Math.min(1, score)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
      // sound_total mirrors the judgment_audit: >0 under a live judge, 0 on the keyword path (unmeasured).
      { type: "ai_audit_result", scene_id: scene.id, planted_errors: planted, true_positives, false_positives, missed, sound_total },
    ],
  };
};

// explain_back — teach-back: the learner explains a concept; we score how well the explanation covers
// the authored key_points. We map key_points -> claim-shape ({id, text, flaws_expected: cues}) so the
// SAME evaluator/matcher scores coverage with no new port. No ai_audit_result (nothing is "planted").
const explainBackGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "explain_back") throw new SceneGradingError(scene.type, "explainBackGrader on non-explain_back");
  if (input.kind !== "explanation") throw new SceneGradingError(scene.type, `expected explanation, got ${input.kind}`);
  const claims = scene.key_points.map((k) => ({ id: k.id, text: k.text, flaws_expected: k.cues }));
  const { score } = await deps.critiqueEvaluator.evaluate({ claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  const cover = matchClaimsAgainstCritique(claims, input.text);
  const completion_rate = cover.planted_errors === 0 ? 0 : cover.true_positives / cover.planted_errors;
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.explain_back) },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "explain_back", llm_score: Math.max(0, Math.min(1, score)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
    ],
  };
};

// comparison — "AI course vs teacher course": the learner names the differences / added value; we score how
// well the answer covers the authored key_points. Mapped key_points -> claim-shape ({id, text, flaws_expected:
// cues}) so the SAME evaluator/matcher scores coverage with no new port. Coverage-graded like explain_back; no
// ai_audit_result (nothing is "planted"). Emits critique_submitted with scene_type "comparison".
const comparisonGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "comparison") throw new SceneGradingError(scene.type, "comparisonGrader on non-comparison");
  if (input.kind !== "comparison") throw new SceneGradingError(scene.type, `expected comparison, got ${input.kind}`);
  const claims = scene.key_points.map((k) => ({ id: k.id, text: k.text, flaws_expected: k.cues }));
  const { score } = await deps.critiqueEvaluator.evaluate({ claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  const cover = matchClaimsAgainstCritique(claims, input.text);
  const completion_rate = cover.planted_errors === 0 ? 0 : cover.true_positives / cover.planted_errors;
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.comparison) },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "comparison", llm_score: Math.max(0, Math.min(1, score)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
    ],
  };
};

// summary_audit — learner-as-auditor of an AI summary: the scene embeds source_content + ai_summary and the
// answer-key claims (the omissions/distortions the summary planted); the learner names them (free text). Same
// CritiqueEvaluator + flaw matcher as spot_the_flaw, so scoring degrades offline to deterministic coverage
// (true_positives / planted_errors). Emits critique_submitted (scene_type "summary_audit") + ai_audit_result.
const summaryAuditGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "summary_audit") throw new SceneGradingError(scene.type, "summaryAuditGrader on non-summary_audit");
  if (input.kind !== "summary_audit") throw new SceneGradingError(scene.type, `expected summary_audit, got ${input.kind}`);
  const { score } = await deps.critiqueEvaluator.evaluate({ claims: scene.claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  const audit = matchClaimsAgainstCritique(scene.claims, input.text);
  const completion_rate = audit.planted_errors === 0 ? 0 : audit.true_positives / audit.planted_errors;
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.summary_audit) },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "summary_audit", llm_score: Math.max(0, Math.min(1, score)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
      // sound_total 0: keyword matcher, no sound-claims key on this scene ⇒ over-distrust UNMEASURED.
      { type: "ai_audit_result", scene_id: scene.id, planted_errors: audit.planted_errors, true_positives: audit.true_positives, false_positives: audit.false_positives, missed: audit.missed, sound_total: 0 },
    ],
  };
};

// prompt_practice — the learner writes/refines a prompt for the authored task; we score how many prompt-quality
// cues (clear instruction / context / constraints / output format) it hits. key_points -> claim-shape mapping
// reuses the SAME evaluator/matcher. Coverage-graded; no ai_audit_result. Emits critique_submitted with
// scene_type "prompt_practice".
const promptPracticeGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "prompt_practice") throw new SceneGradingError(scene.type, "promptPracticeGrader on non-prompt_practice");
  if (input.kind !== "prompt_submission") throw new SceneGradingError(scene.type, `expected prompt_submission, got ${input.kind}`);
  const claims = scene.key_points.map((k) => ({ id: k.id, text: k.text, flaws_expected: k.cues }));
  const { score } = await deps.critiqueEvaluator.evaluate({ claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  const cover = matchClaimsAgainstCritique(claims, input.text);
  const completion_rate = cover.planted_errors === 0 ? 0 : cover.true_positives / cover.planted_errors;
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.prompt_practice) },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "prompt_practice", llm_score: Math.max(0, Math.min(1, score)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
    ],
  };
};

// communication_sim — Dubas "simuler des situations de communication professionnelle": the learner communicates a
// target message in a professional situation (role + audience); we score how well the response hits the authored
// communication objectives (key_points). key_points -> claim-shape mapping reuses the SAME evaluator/matcher with no
// new port. Coverage-graded like explain_back; no ai_audit_result (nothing is "planted"). Emits critique_submitted
// with scene_type "communication_sim".
const communicationSimGrader: Grader = async (scene, input, deps) => {
  if (scene.type !== "communication_sim") throw new SceneGradingError(scene.type, "communicationSimGrader on non-communication_sim");
  if (input.kind !== "communication") throw new SceneGradingError(scene.type, `expected communication, got ${input.kind}`);
  const claims = scene.key_points.map((k) => ({ id: k.id, text: k.text, flaws_expected: k.cues }));
  const { score } = await deps.critiqueEvaluator.evaluate({ claims, rubric: scene.rubric, critique: input.text });
  const passed = score >= 0.6;
  const cover = matchClaimsAgainstCritique(claims, input.text);
  const completion_rate = cover.planted_errors === 0 ? 0 : cover.true_positives / cover.planted_errors;
  return {
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: difficultyForBloom(deps.bloomLevel, DIFFICULTY.communication_sim) },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, scene_type: "communication_sim", llm_score: Math.max(0, Math.min(1, score)), completion_rate: Math.max(0, Math.min(1, completion_rate)) },
    ],
  };
};

export const GRADERS: Record<Scene["type"], Grader> = {
  intro: ackGrader,
  concept: ackGrader,
  reproduction: ackGrader,
  discussion: ackGrader,
  quiz: quizGrader,
  meta_checkpoint: metaGrader,
  ai_critique: critiqueGrader,
  spot_the_flaw: flawGrader,
  explain_back: explainBackGrader,
  comparison: comparisonGrader,
  summary_audit: summaryAuditGrader,
  prompt_practice: promptPracticeGrader,
  communication_sim: communicationSimGrader,
};

export async function grade(scene: Scene, input: ResponseInput, deps: GradeDeps): Promise<GradeResult> {
  const r = await GRADERS[scene.type](scene, input, deps);
  // PER-ANSWER calibration capture (capture-ready; no UI feeds confidence yet): carry an optional
  // per-answer self-rated confidence from the input onto the answer_submitted signal, so the engine
  // can fold it into calibration when supplied.
  if (r.signal.kind === "answer_submitted" && "confidence" in input && typeof input.confidence === "number") {
    return { ...r, signal: { ...r.signal, confidence: input.confidence } };
  }
  return r;
}
