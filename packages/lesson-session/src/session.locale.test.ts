import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession, MAX_SCENE_REPLAYS } from "./session.js";
import { buildTestDeps } from "./testing.js";

const ACCENTED_CHARACTER = /[\u00c0-\u024f]/u;
const FORBIDDEN_FRENCH_WORD = /\b(?:deux|erreurs|réponse|maîtrise|revoir|prérequis)\b/iu;

function englishBundle(language = "en"): LessonBundle {
  return {
    schema_version: "1.4",
    bundle_id: "locale-en",
    source_plan_id: "plan",
    metadata: { title: "English lesson", target: "L1", duration_minutes: 5, language, discipline: "testing" },
    concepts: [{ id: "c1", title: "Concept", description: "Description", bloom_level_target: "understand" }],
    scenes: [
      {
        id: "quiz",
        type: "quiz",
        title: "Question",
        objective_refs: [],
        concept_refs: ["c1"],
        estimated_seconds: 0,
        adaptation_hooks: [],
        question: "Choose the right answer.",
        choices: [
          { id: "wrong", text: "Wrong", correct: false },
          { id: "right", text: "Right", correct: true },
        ],
        feedback_correct: "Correct answer.",
        feedback_incorrect: "Try again.",
        hints: [],
      },
      {
        id: "checkpoint",
        type: "meta_checkpoint",
        title: "Confidence",
        objective_refs: [],
        concept_refs: ["c1"],
        estimated_seconds: 0,
        adaptation_hooks: [],
        pre_question: "How confident are you?",
        post_question: "How confident are you now?",
        scale_labels: ["Not at all", "A little", "Somewhat", "Quite", "Very"],
      },
    ],
    rules: [{
      id: "retry",
      when: { consecutive_errors_same_concept: ">=1" },
      action: { kind: "replay_current_scene", reason: "Try the question again." },
      modulator: "M1",
      explanation_short: "Try the question again.",
    }],
    validated_by: "teacher",
    validated_at: "2026-10-29T00:00:00Z",
  } as unknown as LessonBundle;
}

describe("bundle-derived learner locale", () => {
  it("serves only English chrome through replay exhaustion and a meta checkpoint", async () => {
    const session = new LessonSession(englishBundle(), buildTestDeps());
    const served: unknown[] = [await session.start()];

    for (let attempt = 0; attempt <= MAX_SCENE_REPLAYS; attempt += 1) {
      const transition = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
      served.push(transition);
    }

    const checkpoint = session.currentPresentation();
    expect(checkpoint.scene.type).toBe("meta_checkpoint");
    served.push(checkpoint, await session.respond({ kind: "confidence", pre: 2, post: 3 }));

    const presentations = served.flatMap((item) => {
      const value = item as { locale?: string; presentation?: { locale?: string } };
      return value.presentation ? [value.presentation] : value.locale ? [value] : [];
    });
    expect(presentations.length).toBeGreaterThan(0);
    expect(presentations.every((presentation) => presentation.locale === "en")).toBe(true);
    const servedText = JSON.stringify(served);
    expect(servedText).not.toMatch(ACCENTED_CHARACTER);
    expect(servedText).not.toMatch(FORBIDDEN_FRENCH_WORD);
  });

  it("uses the first two language letters and defaults unknown values to French", async () => {
    const english = await new LessonSession(englishBundle("EN-us"), buildTestDeps()).start();
    const fallback = await new LessonSession(englishBundle("de"), buildTestDeps()).start();
    expect((english as unknown as { locale?: string }).locale).toBe("en");
    expect((fallback as unknown as { locale?: string }).locale).toBe("fr");
  });
});
