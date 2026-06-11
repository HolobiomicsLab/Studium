// packages/lesson-session/src/grading/graders.ts
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import type { ResponseInput } from "../types.js";
import type { EmitInput } from "../telemetry.js";
import type { CritiqueEvaluator } from "../ports.js";
import { matchClaimsAgainstCritique } from "./ai-audit-matcher.js";
import { SceneGradingError } from "../errors.js";

export interface GradeResult { signal: Signal; telemetry: EmitInput[]; }
export interface GradeDeps { critiqueEvaluator: CritiqueEvaluator; hintCount?: number; }
type Grader = (scene: Scene, input: ResponseInput, deps: GradeDeps) => Promise<GradeResult>;

const DIFFICULTY = { quiz: 0.5, ai_critique: 0.7 } as const;

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
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct, time_ms: 0, hint_count: deps.hintCount ?? 0, difficulty: DIFFICULTY.quiz },
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
    signal: { kind: "answer_submitted", concept_id: conceptOf(scene), scene_id: scene.id, correct: passed, time_ms: 0, hint_count: 0, difficulty: DIFFICULTY.ai_critique },
    telemetry: [
      { type: "critique_submitted", scene_id: scene.id, llm_score: Math.max(0, Math.min(1, score)), completion_rate },
      { type: "ai_audit_result", scene_id: scene.id, planted_errors: audit.planted_errors, true_positives: audit.true_positives, false_positives: audit.false_positives, missed: audit.missed },
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
};

export async function grade(scene: Scene, input: ResponseInput, deps: GradeDeps): Promise<GradeResult> {
  return GRADERS[scene.type](scene, input, deps);
}
