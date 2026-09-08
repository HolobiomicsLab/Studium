/**
 * @vitest-environment jsdom
 */
// INT-STUDIUM-001 — the web surface may not render nothing.
//
// SceneRouter handled 7 of the 13 scene types the bundle schema declares and returned
// `null` for the other six (spot_the_flaw, explain_back, comparison, summary_audit,
// prompt_practice, communication_sim). The scene component owns the Continue control, so
// a bundle carrying one of those six did not merely look empty — the learner had no way
// forward. This walks every member of `SceneTypeSchema.options` through the router.
//
// The six carry their ANSWER KEYS in the scene body (claims, key_points, model_answer,
// model_correction, model_prompt, model_response), all of which the schema comments mark
// "NEVER rendered pre-answer". A card that showed the scene body to say it cannot run it
// would leak them, so the leak is asserted here and not left to review.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SceneRouter, { UNSUPPORTED_ON_WEB } from "./SceneRouter";
import { SceneTypeSchema } from "@studium/lesson-bundle-schema";
import type { Scene } from "@studium/lesson-bundle-schema";

afterEach(cleanup);

const KEY = "CLE-DE-CORRECTION-QUI-NE-DOIT-PAS-FUIR";

function base(id: string) {
  return {
    id,
    title: `Titre ${id}`,
    objective_refs: [],
    concept_refs: ["c1"],
    estimated_seconds: 60,
    adaptation_hooks: [],
  };
}

const rubric = { completeness: 1, evidence_quality: 1, tone: 1 };
const keyPoints = [{ id: "k1", text: KEY, cues: [KEY] }];
const flawClaims = [{ id: "f1", text: KEY, flaws_expected: [KEY] }];

/** One minimal, schema-valid scene per declared type. Keyed by type so a scene type added
 *  to the schema and not here fails the exhaustiveness assertion below. */
const SCENES: Record<string, Scene> = {
  intro: { ...base("s-intro"), type: "intro", markdown: "Bienvenue" },
  concept: { ...base("s-concept"), type: "concept", markdown: "Un concept" },
  quiz: {
    ...base("s-quiz"), type: "quiz", question: "Question ?",
    choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }],
    feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
  },
  meta_checkpoint: {
    ...base("s-meta"), type: "meta_checkpoint", pre_question: "Confiance ?",
    post_question: "Et maintenant ?", scale_labels: ["1", "2", "3", "4", "5"],
  },
  reproduction: {
    ...base("s-repro"), type: "reproduction", task_card_id: "tc1",
    steps: [{ step_id: "st1", instruction: "Lancer", expected_input_schema: {}, expected_output: "ok" }],
  },
  ai_critique: {
    ...base("s-critique"), type: "ai_critique",
    claims: [{ id: "c1", text: "Une affirmation", flaws_expected: ["faille"] }], rubric,
  },
  discussion: {
    ...base("s-discussion"), type: "discussion", topic: "Un sujet",
    seed_claim: "Une amorce", target_signals: ["justification"], max_turns: 3,
  },
  spot_the_flaw: {
    ...base("s-flaw"), type: "spot_the_flaw", flawed_content: "Un cours fautif",
    claims: flawClaims, model_correction: KEY, rubric,
  },
  explain_back: {
    ...base("s-explain"), type: "explain_back", prompt: "Expliquez",
    key_points: keyPoints, model_explanation: KEY, rubric,
  },
  comparison: {
    ...base("s-comparison"), type: "comparison", prompt: "Comparez",
    artifact_a: "A", artifact_b: "B", key_points: keyPoints, model_answer: KEY, rubric,
  },
  summary_audit: {
    ...base("s-audit"), type: "summary_audit", source_content: "La source",
    ai_summary: "Le résumé", claims: flawClaims, model_correction: KEY, rubric,
  },
  prompt_practice: {
    ...base("s-prompt"), type: "prompt_practice", task: "Rédigez un prompt",
    key_points: keyPoints, model_prompt: KEY, rubric,
  },
  communication_sim: {
    ...base("s-comm"), type: "communication_sim", scenario: "Une situation",
    prompt: "Communiquez", key_points: keyPoints, model_response: KEY, rubric,
  },
};

function renderScene(scene: Scene, onContinue = vi.fn()) {
  const view = render(
    <SceneRouter
      scene={scene}
      bundlePath="b1"
      onSignal={vi.fn().mockResolvedValue(undefined)}
      onContinue={onContinue}
    />,
  );
  return { ...view, onContinue };
}

describe("SceneRouter", () => {
  it("covers every scene type the schema declares", () => {
    expect(Object.keys(SCENES).sort()).toEqual([...SceneTypeSchema.options].sort());
  });

  it.each(SceneTypeSchema.options)("renders something for %s", (type) => {
    const { container } = renderScene(SCENES[type]);
    expect(container.innerHTML).not.toBe("");
  });

  it.each(UNSUPPORTED_ON_WEB)("%s gets a card that names it and lets the learner go on", (type) => {
    const { onContinue } = renderScene(SCENES[type]);
    expect(screen.getByTestId("unsupported-scene").textContent ?? "").toContain(type);
    fireEvent.click(screen.getByRole("button", { name: /Continuer/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it.each(UNSUPPORTED_ON_WEB)("%s's card leaks no answer key", (type) => {
    const { container } = renderScene(SCENES[type]);
    expect(container.textContent ?? "").not.toContain(KEY);
  });

  it("does not list a type that has a real component as unsupported", () => {
    for (const type of ["intro", "concept", "quiz", "meta_checkpoint", "reproduction",
                        "ai_critique", "discussion"]) {
      expect(UNSUPPORTED_ON_WEB).not.toContain(type);
    }
  });
});
