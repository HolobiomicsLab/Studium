// RT-9: the Socratic tutor and the reasoning scorer receive the bundle's locale, so an English lesson
// gets English tutoring — from the offline stub, from the LLM prompt and from the scorer prompt.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import { StubSocraticTutor } from "./adapters/socratic-tutor.js";
import { buildTutorPrompt } from "./socratic-tutor/prompt.js";
import type { ReasoningScorer, SocraticTutor } from "./ports.js";
import type { TutorInput } from "./socratic-tutor/types.js";

const ACCENTED = /[À-ɏ]/u;

function discussion(language: string): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "tutor", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 5, language, discipline: "x" },
    concepts: [{ id: "c", title: "c", description: "d", bloom_level_target: "understand" }],
    scenes: [{ id: "d", type: "discussion", title: "D", objective_refs: [], concept_refs: ["c"], estimated_seconds: 0,
      adaptation_hooks: [], topic: "Peroxisomes", seed_claim: "they break down hydrogen peroxide",
      target_signals: ["hypothesis"], max_turns: 5 }],
    rules: [], validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z",
  } as unknown as LessonBundle;
}

describe("the tutor and the scorer are told the lesson's language", () => {
  it("passes the bundle locale to the reasoning scorer and the tutor", async () => {
    const seen: { scorer?: string | undefined; tutor?: string | undefined } = {};
    const scorer: ReasoningScorer = { async score(_turn, _topic, locale) { seen.scorer = locale; return { signal: "hypothesis", confidence: 0.8 }; } };
    const tutor: SocraticTutor = { async respond(input: TutorInput) { seen.tutor = input.locale; return { text: "What would you observe?", move_kind: "invite_test", revealed: false }; } };
    const session = new LessonSession(discussion("en"), buildTestDeps({ reasoningScorer: scorer, socraticTutor: tutor }));
    await session.start();
    await session.submitTurn("I think so");
    expect(seen).toEqual({ scorer: "en", tutor: "en" });
  });

  it("the offline stub tutor answers an English lesson in English, low confidence included", async () => {
    for (const confidence of [0.9, 0.2]) {
      const session = new LessonSession(discussion("en"), buildTestDeps({
        reasoningScorer: { async score() { return { signal: "synthesis", confidence }; } },
        socraticTutor: new StubSocraticTutor(),
      }));
      await session.start();
      await session.submitTurn("So it is all one rule");
      const move = session.getLastTutorMove();
      expect(move?.text.length).toBeGreaterThan(0);
      expect(move?.text).not.toMatch(ACCENTED);
      expect(move?.text).not.toMatch(/\b(?:Avance|réponse|qu'est-ce|déjà)\b/u);
    }
  });

  it("keeps French for a French lesson", async () => {
    const session = new LessonSession(discussion("fr"), buildTestDeps({
      reasoningScorer: { async score() { return { signal: "synthesis", confidence: 0.2 }; } },
      socraticTutor: new StubSocraticTutor(),
    }));
    await session.start();
    await session.submitTurn("donc une seule règle");
    expect(session.getLastTutorMove()?.text).toContain("Avance d'un pas");
  });

  it("the LLM tutor prompt is written in, and asks for, the lesson's language", () => {
    const input = { topic: "Peroxisomes", seedClaim: "s", learnerTurn: "I think…", signal: "hypothesis" as const, confidence: 0.8, history: [] };
    const english = buildTutorPrompt({ ...input, locale: "en" });
    expect(english).toContain("You are a Socratic tutor");
    expect(english).toContain("Reply in English");
    expect(english).toContain("NEVER");
    expect(english).toContain("Peroxisomes");
    const french = buildTutorPrompt({ ...input, locale: "fr" });
    expect(french).toContain("Réponds en français");
    expect(buildTutorPrompt(input)).toContain("Tu es un tuteur socratique"); // no locale: the historical French prompt
  });
});
