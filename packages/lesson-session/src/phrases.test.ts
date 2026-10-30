// Sprint verification fix wave (2026-10-30, lead decisions L-5 and L-6) — the engine's own phrases.
//
// L-6 (RFR-05, R-en-01, RT-8c): the navigation explanations reach learners (navigation.reason,
// transition.reason, explain_last_adaptation). They said « item du prérequis réussi, maîtrise encore
// sous le seuil », "prerequisite unmet and no scene can assess it", "routed to remediation": engine
// jargon, and claims of correctness or of non-mastery nothing measured. They are now neutral.
// L-5 (RFR-08, UX-12): French learner-facing text says « tu », and is typeset with French spacing
// (U+202F before ; ! ?, U+00A0 before : and inside « »), outside code spans.
import { describe, expect, it } from "vitest";
import { phrase, PHRASE_KEYS, type PhraseKey } from "./phrases.js";

const EXPLANATIONS: PhraseKey[] = [
  "explanation_graph_universe_escalated", "explanation_replay_budget_exhausted", "explanation_graph_prereq_gate",
  "explanation_graph_prereq_gate_passed", "explanation_graph_prereq_gate_released", "explanation_graph_prereq_unassessable",
  "explanation_graph_skip_mastered",
];
const ENGINE_WORDS = /\bitems?\b|seuil|threshold|univers|universe|rem[ée]dia|answered correctly|r[ée]ussi|non acquis|unmet|not yet mastered|pas encore ma[iî]tris|unmastered|non ma[iî]tris|sans succ[eè]s|without success/i;

function catalogue(locale: "fr" | "en"): Record<string, string> {
  return Object.fromEntries(PHRASE_KEYS.map((key) => [key, phrase(key, {}, locale)]));
}

describe("L-6 — navigation explanations are neutral", () => {
  for (const locale of ["fr", "en"] as const) {
    for (const key of EXPLANATIONS) {
      it(`${locale} ${key} names no engine notion and claims no correctness`, () => {
        expect(phrase(key, {}, locale)).not.toMatch(ENGINE_WORDS);
      });
    }
  }
});

describe("L-5 — French register and typography", () => {
  it("the catalogue lists its keys", () => {
    expect(PHRASE_KEYS.length).toBeGreaterThan(50);
    expect(PHRASE_KEYS).toContain("tutor_question");
  });

  it("French says « tu », never « vous »", () => {
    for (const [key, text] of Object.entries(catalogue("fr"))) expect(text, key).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
  });

  it("French has no ordinary space before ; : ! ? » nor after «, outside code", () => {
    for (const [key, text] of Object.entries(catalogue("fr"))) {
      const prose = text.split(/`[^`]*`/).join("`…`");
      expect(prose, key).not.toMatch(/ [;:!?»]|« /);
    }
  });

  it("thin no-break space before ; ! ?, no-break space before :", () => {
    expect(phrase("tutor_question", {}, "fr")).toContain("réponse ?");
    expect(phrase("deck_detail", { caught: 1, planted: 2, false_positives: 0, sound_total: 1 }, "fr"))
      .toBe("1/2 défauts plantés trouvés ; 0/1 fausses alertes");
    expect(phrase("workspace_scene_type", { type: "quiz" }, "fr")).toBe("**Type de scène :** `quiz`");
  });

  it("code spans are left as written", () => {
    expect(phrase("workspace_instruction_quiz", {}, "fr")).toContain("{ \"kind\": \"quiz_choice\", \"choiceId\": \"<id>\" }");
  });

  it("French carries its accents in the file channel too", () => {
    for (const [key, raw] of Object.entries(catalogue("fr"))) {
      const text = raw.replace(/\{[a-z_]+\}/g, "");
      expect(text, key).not.toMatch(/\b(reponse|etape|lecon|scene|deja|verifie|ingere|remediation|prerequis|resultat|ecris|maitrise)\b/i);
    }
  });

  it("English text keeps ordinary spacing", () => {
    expect(phrase("deck_detail", { caught: 1, planted: 2, false_positives: 0, sound_total: 1 }, "en"))
      .toBe("1/2 planted flaws found; 0/1 false positives");
  });
});

// Refix (verification review, L-6): the file channel's replay and remediate_alt lines carried the
// transition reason, which for those kinds is the bundle rule's action.reason code (create_lesson
// writes `errors_threshold`), so task.md / feedback.md read « ↻ À revoir : errors_threshold. ».
// Those lines are now worded from the navigation kind alone; a reason passed in never reaches them.
describe("L-6 — file-channel navigation lines are worded from the kind", () => {
  for (const locale of ["fr", "en"] as const) {
    for (const key of ["workspace_feedback_replay", "workspace_feedback_remediate_alt"] as const) {
      it(`${locale} ${key} shows no rule reason code`, () => {
        const text = phrase(key, { reason: "errors_threshold" }, locale);
        expect(text).not.toContain("errors_threshold");
        expect(text).not.toMatch(/\{[a-z_]+\}/);
        expect(text).not.toMatch(ENGINE_WORDS);
      });
    }
  }
});

// Refix (verification review, L-6 honest wording): the calibration verdicts are served once a concept
// has one graded attempt and one confidence sample, below MIN_MASTERY_ATTEMPTS, so they may compare
// confidence with what the answers showed, never claim a command of the concept.
const MASTERY_CLAIM = /ma[iî]tris|command of|understand this concept|actual|r[ée]elle/i;
describe("L-6 — calibration verdicts speak of answers, not mastery", () => {
  for (const locale of ["fr", "en"] as const) {
    for (const key of ["calibration_well", "calibration_over", "calibration_under"] as const) {
      it(`${locale} ${key} claims no mastery`, () => {
        const text = phrase(key, {}, locale);
        expect(text).not.toMatch(MASTERY_CLAIM);
        expect(text).not.toMatch(ENGINE_WORDS);
      });
    }
  }
});
