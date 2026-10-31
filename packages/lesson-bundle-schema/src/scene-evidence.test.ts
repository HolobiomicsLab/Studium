// Every scene may carry the evidence it rests on (sprint 2026-10-30, contract C2: the conversational
// author binds each item to the passage it cites). Before, only intro, concept and reproduction
// declared `evidence`; on any other type the parser silently dropped it.
import { describe, expect, it } from "vitest";
import { SceneSchema, SceneTypeSchema } from "./index";

const EVIDENCE = {
  bibliographic_refs: [{
    perspicacite_doc_id: "p:source:1", title: "Source", authors: [], excerpt: "un extrait exact",
    relevance_score: 1, prov_derived_from: "https://example.org/source",
  }],
  enrichment_metadata: { enricher_version: "test/1", perspicacite_mode_used: "passages", timestamp: "2026-10-30T00:00:00Z", degraded: false },
};
const BASE = { title: "T", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [] };
const RUBRIC = { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 };
const KEY_POINTS = [{ id: "kp1", text: "k", cues: ["k"] }];
const FLAW_CLAIMS = [{ id: "c1", text: "t", flaws_expected: ["f"] }];
const FIELDS: Record<string, Record<string, unknown>> = {
  intro: { markdown: "m" },
  concept: { markdown: "m" },
  quiz: { question: "q", choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
  meta_checkpoint: { pre_question: "a", post_question: "b", scale_labels: ["1", "2", "3", "4", "5"] },
  reproduction: { task_card_id: "t", steps: [{ step_id: "1", instruction: "i", expected_input_schema: {}, expected_output: "o" }] },
  ai_critique: { claims: FLAW_CLAIMS, rubric: RUBRIC },
  discussion: { topic: "t", seed_claim: "s", target_signals: ["justification"], max_turns: 4 },
  spot_the_flaw: { flawed_content: "x", claims: FLAW_CLAIMS, model_correction: "f", rubric: RUBRIC },
  explain_back: { prompt: "p", key_points: KEY_POINTS, model_explanation: "m", rubric: RUBRIC },
  comparison: { prompt: "p", artifact_a: "a", artifact_b: "b", key_points: KEY_POINTS, model_answer: "m", rubric: RUBRIC },
  summary_audit: { source_content: "s", ai_summary: "a", claims: FLAW_CLAIMS, model_correction: "f", rubric: RUBRIC },
  prompt_practice: { task: "t", key_points: KEY_POINTS, model_prompt: "m", rubric: RUBRIC },
  communication_sim: { scenario: "s", prompt: "p", key_points: KEY_POINTS, model_response: "m", rubric: RUBRIC },
};

describe("scene evidence", () => {
  it("covers every scene type of the schema", () => {
    expect(Object.keys(FIELDS).sort()).toEqual([...SceneTypeSchema.options].sort());
  });

  it.each(Object.keys(FIELDS))("is kept on a %s scene", (type) => {
    const parsed = SceneSchema.parse({ id: `s-${type}`, type, ...BASE, ...FIELDS[type], evidence: EVIDENCE });
    expect((parsed as { evidence?: unknown }).evidence).toEqual(EVIDENCE);
  });

  it("stays optional", () => {
    const parsed = SceneSchema.parse({ id: "s", type: "quiz", ...BASE, ...FIELDS["quiz"] });
    expect("evidence" in parsed).toBe(false);
  });
});
