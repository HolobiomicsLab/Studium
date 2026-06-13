// reveal.test.ts
import { describe, it, expect } from "vitest";
import { tokenize, jaccard, revealsAnswer } from "./reveal.js";
import { collectBannedAnswers } from "./reveal.js";
import type { LessonBundle, Scene } from "@studium/lesson-bundle-schema";

describe("reveal guardrail primitives", () => {
  it("tokenize lowercases, splits on non-alphanumerics, drops <3-char + stopwords", () => {
    expect(tokenize("The Peroxisome breaks H2O2!")).toEqual(new Set(["peroxisome", "breaks", "h2o2"]));
    expect(tokenize(null)).toEqual(new Set());
  });
  it("jaccard is intersection over union, 0 for two empties", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  it("revealsAnswer flags a verbatim answer substring", () => {
    expect(revealsAnswer("En fait, la réponse est le peroxysome.", ["le peroxysome"])).toBe(true);
  });
  it("revealsAnswer flags high token overlap even without a substring", () => {
    expect(revealsAnswer("peroxysome catalase oxydation", ["oxydation catalase peroxysome"])).toBe(true);
  });
  it("revealsAnswer passes a faded, non-revealing prompt", () => {
    expect(revealsAnswer("Qu'observerais-tu si c'était vrai ?", ["le peroxysome catalase"])).toBe(false);
  });
});

function discussion(id: string, concept: string, seed: string): Scene {
  return { id, type: "discussion", title: "D", objective_refs: [], concept_refs: [concept],
    estimated_seconds: 0, adaptation_hooks: [], topic: "t", seed_claim: seed,
    target_signals: ["justification"], max_turns: 5 } as unknown as Scene;
}
function quiz(id: string, concept: string, correctText: string, fbCorrect: string): Scene {
  return { id, type: "quiz", title: "Q", objective_refs: [], concept_refs: [concept],
    estimated_seconds: 0, adaptation_hooks: [], question: "?",
    choices: [{ id: "a", text: "wrong", correct: false }, { id: "b", text: correctText, correct: true }],
    feedback_correct: fbCorrect, feedback_incorrect: "no", hints: [] } as unknown as Scene;
}
function bundle(scenes: Scene[]): LessonBundle {
  return { schema_version: "1.4", bundle_id: "L", source_plan_id: "p",
    metadata: { title: "T", target: "L", duration_minutes: 1, language: "fr", discipline: "x" },
    concepts: [], scenes, rules: [], validated_by: "t", validated_at: "2026-06-10T10:00:00Z" } as unknown as LessonBundle;
}

describe("collectBannedAnswers", () => {
  it("collects seed_claim + sibling-quiz correct choice text + feedback_correct for shared concepts", () => {
    const disc = discussion("d1", "c1", "Le peroxysome dégrade le peroxyde");
    const b = bundle([disc, quiz("q1", "c1", "le peroxysome", "Exact, le peroxysome.")]);
    const banned = collectBannedAnswers(b, disc);
    expect(banned).toContain("Le peroxysome dégrade le peroxyde");
    expect(banned).toContain("le peroxysome");
    expect(banned).toContain("Exact, le peroxysome.");
  });
  it("ignores quizzes that share no concept_ref with the discussion", () => {
    const disc = discussion("d1", "c1", "seed");
    const b = bundle([disc, quiz("q1", "c2", "other answer", "fb other")]);
    const banned = collectBannedAnswers(b, disc);
    expect(banned).toEqual(["seed"]);
  });
});
