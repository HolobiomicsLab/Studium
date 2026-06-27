import { z } from "zod";
import { RenderAssetSchema } from "./render-asset";

// ADR 014 — Evidence schemas (Zod local copy ; lesson-plan-schema uses AJV, incompatible direct import)

export const BibliographicRefSchema = z.object({
  perspicacite_doc_id: z.string().min(1),
  doi: z.string().optional(),
  title: z.string().min(1),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  excerpt: z.string().max(500),
  relevance_score: z.number().min(0).max(1),
  prov_derived_from: z.string().min(1),
});

export const CaseStudySchema = z.object({
  title: z.string().min(1),
  summary: z.string().max(1000),
  source_refs: z.array(z.string()),
});

export const ABSAssetSchema = z.object({
  asset_type: z.enum([
    "spectrum_viewer_svg",
    "code_snippet",
    "data_csv",
    "protocol_card_md",
    "script_snippet",
    // interactive / first-class rich types (rendered client-side):
    "plot_spec",       // payload_inline = a Vega-Lite or Plotly JSON spec (zoom/hover)
    "equation_latex",  // payload_inline = a LaTeX string, rendered with KaTeX/MathJax
    "orbital_viewer_3d", // payload_path = a .cube volumetric, rendered with 3Dmol.js
    "molecule_3d",       // payload_path/inline = xyz/mol/pdb/SMILES, rendered with 3Dmol.js / RDKit.js
    "spectrum_data",     // payload_inline = a Vega-Lite spec of spectral lines (λ / m·z⁻¹ vs intensity)
  ]),
  payload_inline: z.string().optional(),
  payload_path: z.string().optional(),
  abs_task_card_id: z.string().optional(),
  prov_derived_from: z.string().min(1),
});

export const EnrichmentMetadataSchema = z.object({
  enricher_version: z.string().min(1),
  perspicacite_mode_used: z.enum(["basic", "advanced", "profound", "agentic", "passages"]),
  timestamp: z.string().min(1),
  degraded: z.boolean(),
});

export const EvidenceSchema = z.object({
  bibliographic_refs: z.array(BibliographicRefSchema).optional(),
  case_studies: z.array(CaseStudySchema).optional(),
  abs_asset: ABSAssetSchema.optional(),
  enrichment_metadata: EnrichmentMetadataSchema,
});

export const SceneTypeSchema = z.enum([
  "intro", "concept", "quiz", "meta_checkpoint",
  "reproduction", "ai_critique", "discussion",
  // active-learning scenes (learner-as-active-agent): find planted errors / teach back.
  "spot_the_flaw", "explain_back",
  // active-learning wave-1: compare AI vs teacher output / audit an AI summary / craft & refine prompts.
  "comparison", "summary_audit", "prompt_practice",
  // active-learning wave-2 (D2): simulate a professional communication situation.
  "communication_sim",
]);

export const ReasoningSignalEnum = z.enum([
  "justification", "hypothesis", "question", "counterexample", "synthesis",
]);

export const SceneBaseSchema = z.object({
  id: z.string().min(1),
  type: SceneTypeSchema,
  title: z.string().min(1),
  objective_refs: z.array(z.string()),
  concept_refs: z.array(z.string()),
  estimated_seconds: z.number().int().nonnegative(),
  adaptation_hooks: z.array(z.string()),
  // explicit typed artifacts shown pair-by-pair with this scene/cell (orbital, spectrum, equation,
  // plot…). Flattened into the render manifest by sceneRenderAssets(); optional + back-compatible.
  render_assets: z.array(RenderAssetSchema).optional(),
});

// ADR 010 — flat shape : champs métier à la racine, pas d'enveloppe `content`.

export const IntroSceneSchema = SceneBaseSchema.extend({
  type: z.literal("intro"),
  markdown: z.string(),
  evidence: EvidenceSchema.optional(),
});

export const ConceptSceneSchema = SceneBaseSchema.extend({
  type: z.literal("concept"),
  markdown: z.string(),
  image_path: z.string().optional(),
  evidence: EvidenceSchema.optional(),
});

const ChoiceSchema = z.object({
  id: z.string(), text: z.string(), correct: z.boolean(),
});

export const QuizSceneSchema = SceneBaseSchema.extend({
  type: z.literal("quiz"),
  question: z.string(),
  choices: z.array(ChoiceSchema).min(2).max(6),
  feedback_correct: z.string(),
  feedback_incorrect: z.string(),
  hints: z.array(z.string()),
});

export const MetaCheckpointSceneSchema = SceneBaseSchema.extend({
  type: z.literal("meta_checkpoint"),
  pre_question: z.string(),
  post_question: z.string(),
  scale_labels: z.array(z.string()).length(5),
});

export const ReproductionStepSchema = z.object({
  step_id: z.string(),
  instruction: z.string(),
  expected_input_schema: z.record(z.unknown()),
  expected_output: z.union([z.string(), z.record(z.unknown())]),
});

// The result of executing the capsule once at author time (the "reference run"), so a learner
// sees a real, graded analysis rather than only step text. Populated by tools/capsule_runner.py;
// absent when the capsule is heavy/deferred or type-checked-only.
export const ReferenceRunSchema = z.object({
  ran: z.boolean(),
  passed: z.boolean(),
  landmark: z.string().nullable(),
  figure_path: z.string().nullable(),
  checks: z.array(z.object({ check: z.string(), passed: z.boolean() })),
  provenance: z.object({
    capsule_doi: z.string().nullable(),
    cmd: z.array(z.string()),
    env: z.string(),
  }),
});
export type ReferenceRun = z.infer<typeof ReferenceRunSchema>;

// LEARNER-TIME provisioning + run manifest. Studium emits it (from the capsule's runnable contract)
// so a PLUGGABLE AGENTIC OPERATOR provisions the env, installs deps, and runs the capsule IN THE VS CODE
// WORKSPACE — Studium NEVER executes (no per-learner sandbox). Deliberately NON-answer-bearing: it carries
// only HOW to run (capsule ref / cmd / install / produced file NAMES / file-existence checks), and NEVER
// the expected values or the author's landmark — the learner produces those by actually running it.
export const RunManifestSchema = z.object({
  capsule_ref: z.string().min(1),                  // where the capsule lives / how to obtain it (path or DOI)
  cmd: z.array(z.string()).min(1),                 // the command the operator runs in the workspace
  working_dir: z.string().nullable().optional(),
  timeout_s: z.number().positive().optional(),
  requirements: z.array(z.string()).optional(),    // pip deps to install (or a requirements.txt at capsule_ref)
  expected_outputs: z.array(z.string()),           // file NAMES the run should produce (not their values)
  verify_checks: z.array(z.string()),              // human-readable file-existence checks (no answer values)
  research_question: z.string().optional(),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

export const ReproductionSceneSchema = SceneBaseSchema.extend({
  type: z.literal("reproduction"),
  task_card_id: z.string(),
  steps: z.array(ReproductionStepSchema).min(1),
  prov_derived_from: z.string().url().optional(),
  image_path: z.string().optional(),         // rendered figure from the reference run
  reference_result: ReferenceRunSchema.optional(),
  // OPTIONAL learner-time run: when present, the scene is reproduced BY THE LEARNER at session time
  // (the host/operator provisions + runs it), not merely shown as a pre-baked author run.
  run_manifest: RunManifestSchema.optional(),
  evidence: EvidenceSchema.optional(),
});

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  flaws_expected: z.array(z.string()),
});

export const AICritiqueRubricSchema = z.object({
  completeness: z.number().min(0).max(1),
  evidence_quality: z.number().min(0).max(1),
  tone: z.number().min(0).max(1),
});

export const AICritiqueSceneSchema = SceneBaseSchema.extend({
  type: z.literal("ai_critique"),
  claims: z.array(ClaimSchema).min(1).max(3),
  rubric: AICritiqueRubricSchema,
});

export const DiscussionSceneSchema = SceneBaseSchema.extend({
  type: z.literal("discussion"),
  topic: z.string().min(1),
  seed_claim: z.string().min(1),
  target_signals: z.array(ReasoningSignalEnum).min(1),
  max_turns: z.number().int().positive().max(50),
});

// A spot_the_flaw claim MUST carry at least one expected-flaw keyword: a planted assertion with
// nothing to spot is meaningless, and (since the offline scorer derives the pass/score from the flaw
// COUNT) an all-empty answer key would silently fail every learner. This differs from ai_critique's
// ClaimSchema, which legitimately allows a sound distractor claim with no flaws.
export const FlawClaimSchema = ClaimSchema.extend({
  flaws_expected: z.array(z.string()).min(1),
});

// spot_the_flaw — the learner reads a deliberately-FLAWED mini-lesson (flawed_content), names what
// is wrong (free text), and is scored on how many planted flaws they catch. `claims` is the answer
// key (the flawed assertions + the flaws_expected keywords the scorer matches) and is NEVER rendered
// pre-answer; `model_correction` is the corrected reference ("cours amélioré"), a reveal — also not
// shown before the learner responds. Reuses FlawClaim + AICritiqueRubricSchema so the existing
// CritiqueEvaluator grades it unchanged.
export const SpotTheFlawSceneSchema = SceneBaseSchema.extend({
  type: z.literal("spot_the_flaw"),
  flawed_content: z.string().min(1),
  claims: z.array(FlawClaimSchema).min(1).max(5),
  model_correction: z.string().min(1),
  rubric: AICritiqueRubricSchema,
  // OPTIONAL grounding in a REAL capsule execution. When `flawed_content` is a deliberately-flawed
  // AI reading of a genuine executed result (the capsule "reference run"), the scene carries that run
  // so the learner audits the AI interpretation AGAINST the real output (figure + landmark + graded
  // checks) — "real operation as the vehicle, judgment as the destination". Populated at author time
  // by tools/ground_judgment.py (which gets it from tools/capsule_runner.py); absent for a purely
  // hand-authored flaw. Surfaced as an `executed_result` render-asset by sceneRenderAssets — the SAME
  // carrier reproduction uses. The run carries no answer key (the flaws live in `claims`), so showing
  // it is the evidence the learner reasons from, not a leak.
  reference_result: ReferenceRunSchema.optional(),
  // OPTIONAL learner-run grounding (closes the operation→judgment loop): a task_card_id whose
  // LEARNER-TIME run (the learner's OWN executed result, captured via the run protocol) grounds this
  // judgment — the learner audits a flawed AI reading of the result THEY produced. At session time the
  // host injects the recorded run as `reference_result` (so both the evidence shown AND the grading
  // feed off the learner's run). Falls back to the authored `reference_result` (or ungrounded) when no
  // learner run was captured. Non-answer-bearing — it is just a reference to which run to ground on.
  //
  // SOUNDNESS REQUIREMENT — DETERMINISTIC CAPSULES ONLY: the authored `claims`/`flaws_expected` (the
  // answer key the grader scores against) are written for a CANONICAL result and are NOT regenerated
  // from the learner's run. So `reference_from_run` is only sound when the capsule is DETERMINISTIC
  // (the landmark is stable across runs — e.g. a fixed seed). For a stochastic capsule the learner
  // would see their real landmark while being graded against flaws written for different numbers. Only
  // author `reference_from_run` against a deterministic capsule; for stochastic ones keep a pre-baked
  // author `reference_result` (or regenerate the flaws per-run — a deferred enhancement).
  reference_from_run: z.string().optional(),
});

// A key idea a good explanation should contain. `cues` (>=1) are the phrases the offline coverage
// scorer matches against (mapped to Claim.flaws_expected at grade time); a key point with no cues
// could never be covered, so it is forbidden.
export const KeyPointSchema = z.object({
  id: z.string(),
  text: z.string(),
  cues: z.array(z.string()).min(1),
});

// explain_back — teach-back / Feynman: the learner explains a concept (prompt) in their own words and
// is scored by how well the explanation covers the authored key_points. `key_points` (answer key) and
// `model_explanation` (reference reveal) are NEVER rendered pre-answer.
export const ExplainBackSceneSchema = SceneBaseSchema.extend({
  type: z.literal("explain_back"),
  prompt: z.string().min(1),
  key_points: z.array(KeyPointSchema).min(1).max(6),
  model_explanation: z.string().min(1),
  rubric: AICritiqueRubricSchema,
});

// comparison — the learner is shown TWO artifacts (artifact_a / artifact_b, e.g. an AI-written course vs a
// teacher-written one) and must name the differences / added value. `key_points` are those differences (the
// answer key, mapped to claim-shape at grade time so the SAME evaluator/matcher scores coverage); `model_answer`
// is the reference reveal. key_points + model_answer are NEVER rendered pre-answer. Graded explainBack-style
// (coverage over key_points). Reuses KeyPoint + AICritiqueRubricSchema.
export const ComparisonSceneSchema = SceneBaseSchema.extend({
  type: z.literal("comparison"),
  prompt: z.string().min(1),
  artifact_a: z.string().min(1),
  artifact_b: z.string().min(1),
  key_points: z.array(KeyPointSchema).min(1),
  model_answer: z.string().min(1),
  rubric: AICritiqueRubricSchema,
});

// summary_audit — the learner reads a source (source_content) and an AI summary of it (ai_summary), then audits
// what the summary omitted or distorted. `claims` are the omissions/distortions to catch (FlawClaim answer key,
// each flaws_expected non-empty); `model_correction` is the reference reveal. claims + model_correction are NEVER
// rendered pre-answer. This is a learner-as-auditor variant of spot_the_flaw, so it is graded flawGrader-style
// (true_positives / planted_errors). Reuses FlawClaim + AICritiqueRubricSchema.
export const SummaryAuditSceneSchema = SceneBaseSchema.extend({
  type: z.literal("summary_audit"),
  source_content: z.string().min(1),
  ai_summary: z.string().min(1),
  claims: z.array(FlawClaimSchema).min(1).max(5),
  model_correction: z.string().min(1),
  rubric: AICritiqueRubricSchema,
});

// prompt_practice — the learner writes (or refines a starter_prompt for) a prompt for the authored `task`, scored
// on how many prompt-quality cues it hits (clear instruction / context / constraints / output format). `key_points`
// are those cues (answer key, mapped to claim-shape at grade time); `model_prompt` is the reference reveal.
// key_points + model_prompt are NEVER rendered pre-answer. Graded coverage-style over key_points. `starter_prompt`
// (optional) IS shown — it is the affordance the learner refines, not an answer key.
export const PromptPracticeSceneSchema = SceneBaseSchema.extend({
  type: z.literal("prompt_practice"),
  task: z.string().min(1),
  starter_prompt: z.string().optional(),
  key_points: z.array(KeyPointSchema).min(1),
  model_prompt: z.string().min(1),
  rubric: AICritiqueRubricSchema,
});

// communication_sim — Dubas "simuler des situations de communication professionnelle": the learner is placed in
// a professional communication SITUATION (scenario = the situation + the learner's role + the audience) and must
// communicate a target message (prompt). Scored explainBack-style on how well the response hits the authored
// communication objectives (key_points: clarity-for-non-expert / addresses-the-audience / accurate / actionable).
// key_points (answer key, mapped to claim-shape at grade time so the SAME evaluator/matcher scores coverage) and
// model_response (reference reveal) are NEVER rendered pre-answer. Reuses KeyPoint + AICritiqueRubricSchema.
export const CommunicationSimSceneSchema = SceneBaseSchema.extend({
  type: z.literal("communication_sim"),
  scenario: z.string().min(1),
  prompt: z.string().min(1),
  key_points: z.array(KeyPointSchema).min(1),
  model_response: z.string().min(1),
  rubric: AICritiqueRubricSchema,
});

export const SceneSchema = z.discriminatedUnion("type", [
  IntroSceneSchema,
  ConceptSceneSchema,
  QuizSceneSchema,
  MetaCheckpointSceneSchema,
  ReproductionSceneSchema,
  AICritiqueSceneSchema,
  DiscussionSceneSchema,
  SpotTheFlawSceneSchema,
  ExplainBackSceneSchema,
  ComparisonSceneSchema,
  SummaryAuditSceneSchema,
  PromptPracticeSceneSchema,
  CommunicationSimSceneSchema,
]);

export type Scene = z.infer<typeof SceneSchema>;
