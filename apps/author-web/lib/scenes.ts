// Client-side Zod schemas + KEY-FREE offline graders for the active-learning
// scene types the /studio form can author: spot_the_flaw and explain_back.
//
// These mirror SpotTheFlawSceneSchema / ExplainBackSceneSchema from
// @studium/lesson-bundle-schema FIELD-FOR-FIELD (incl. the .min(1) invariants on
// flaws_expected / cues and the .min(1) array bounds). They are kept local — like
// quiz-scene.ts — so the form's green/red badge can gate on a well-formed scene
// BEFORE touching the network, and so the on-device "reveal after a mock answer"
// preview needs no API key, no LLM, no Node-only SessionHost.
import { z } from "zod";

// ---- shared sub-schemas --------------------------------------------------- //

// AICritiqueRubric — three [0,1] weights. spot_the_flaw and explain_back both
// reuse it (mirror of AICritiqueRubricSchema). Authors rarely need to tune these,
// so the form fixes a sane default and the schema just guards the range.
export const RubricSchema = z.object({
  completeness: z.number().min(0).max(1),
  evidence_quality: z.number().min(0).max(1),
  tone: z.number().min(0).max(1),
});
export type Rubric = z.infer<typeof RubricSchema>;

export const DEFAULT_RUBRIC: Rubric = {
  completeness: 0.5,
  evidence_quality: 0.3,
  tone: 0.2,
};

// A spot_the_flaw claim: a planted (flawed) assertion + >=1 expected-flaw keyword.
// flaws_expected MUST be non-empty (FlawClaimSchema) — an assertion with nothing
// to spot would silently fail every learner in the offline scorer.
export const FlawClaimSchema = z.object({
  id: z.string().min(1, "id requis"),
  text: z.string().min(1, "assertion requise"),
  flaws_expected: z.array(z.string().min(1)).min(1, "au moins un défaut attendu"),
});
export type FlawClaim = z.infer<typeof FlawClaimSchema>;

// A key idea a good explanation should contain. `cues` (>=1) are the phrases the
// offline coverage scorer matches; a key point with no cues could never be
// covered, so it is forbidden (mirror of KeyPointSchema).
export const KeyPointSchema = z.object({
  id: z.string().min(1, "id requis"),
  text: z.string().min(1, "idée-clé requise"),
  cues: z.array(z.string().min(1)).min(1, "au moins un indice de couverture"),
});
export type KeyPoint = z.infer<typeof KeyPointSchema>;

// ---- spot_the_flaw -------------------------------------------------------- //

export const SpotTheFlawSceneSchema = z.object({
  id: z.string().min(1, "id requis"),
  type: z.literal("spot_the_flaw"),
  title: z.string().min(1, "titre requis"),
  objective_refs: z.array(z.string()),
  concept_refs: z.array(z.string()),
  estimated_seconds: z.number().int().nonnegative(),
  adaptation_hooks: z.array(z.string()),
  flawed_content: z.string().min(1, "le cours volontairement erroné est requis"),
  claims: z.array(FlawClaimSchema).min(1, "au moins une assertion erronée").max(5),
  model_correction: z.string().min(1, "le cours corrigé est requis"),
  rubric: RubricSchema,
});
export type SpotTheFlawScene = z.infer<typeof SpotTheFlawSceneSchema>;

// ---- explain_back --------------------------------------------------------- //

export const ExplainBackSceneSchema = z.object({
  id: z.string().min(1, "id requis"),
  type: z.literal("explain_back"),
  title: z.string().min(1, "titre requis"),
  objective_refs: z.array(z.string()),
  concept_refs: z.array(z.string()),
  estimated_seconds: z.number().int().nonnegative(),
  adaptation_hooks: z.array(z.string()),
  prompt: z.string().min(1, "la consigne est requise"),
  key_points: z.array(KeyPointSchema).min(1, "au moins une idée-clé").max(6),
  model_explanation: z.string().min(1, "l'explication de référence est requise"),
  rubric: RubricSchema,
});
export type ExplainBackScene = z.infer<typeof ExplainBackSceneSchema>;

// --------------------------------------------------------------------------- //
// KEY-FREE offline graders.
//
// These reproduce, in pure synchronous TS, the CHEAP keyword-coverage branch the
// canonical CritiqueEvaluator uses offline (no LLM): fold accents/superscripts +
// case, then a cue/flaw counts as "covered" iff it appears as a substring of the
// learner's free-text answer. They are deliberately lenient and are ONLY used for
// the author's pre-submit self-preview — never for real grading, which the
// backend owns. Returning per-item hit/miss lets the reveal panel show the
// learner WHICH planted flaws / key points their mock answer caught.
// --------------------------------------------------------------------------- //

// Fold accents + common superscripts + case so "n−ℓ−1" matches "n-l-1" etc.
// Mirrors the spirit of the backend matcher's normalisation (accent/superscript).
const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁻": "-", "ℓ": "l", "−": "-", "–": "-", "—": "-",
};
export function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻ℓ−–—]/g, (c) => SUPERSCRIPTS[c] ?? c)
    .toLowerCase()
    .trim();
}

function termHit(answer: string, term: string): boolean {
  const t = foldText(term);
  return t.length > 0 && foldText(answer).includes(t);
}

export type CoverageItem = {
  id: string;
  text: string;
  /** the cues / flaws_expected for this item */
  terms: string[];
  /** terms found in the learner's answer */
  hits: string[];
  /** true iff at least one term was found */
  covered: boolean;
};

export type CoverageResult = {
  items: CoverageItem[];
  covered: number; // # of items with >=1 hit
  total: number;
};

function gradeCoverage(
  items: { id: string; text: string; terms: string[] }[],
  answer: string
): CoverageResult {
  const graded = items.map((it) => {
    const hits = it.terms.filter((term) => termHit(answer, term));
    return { ...it, hits, covered: hits.length > 0 };
  });
  return {
    items: graded,
    covered: graded.filter((i) => i.covered).length,
    total: graded.length,
  };
}

// spot_the_flaw: each claim is "caught" iff the learner's free text mentions any
// of its flaws_expected keywords. Returns per-claim hit/miss for the reveal.
export function gradeSpotTheFlaw(
  scene: Pick<SpotTheFlawScene, "claims">,
  answer: string
): CoverageResult {
  return gradeCoverage(
    scene.claims.map((c) => ({ id: c.id, text: c.text, terms: c.flaws_expected })),
    answer
  );
}

// explain_back: each key_point is "covered" iff the learner's explanation mentions
// any of its cues. Returns per-key-point hit/miss for the reveal.
export function gradeExplainBack(
  scene: Pick<ExplainBackScene, "key_points">,
  answer: string
): CoverageResult {
  return gradeCoverage(
    scene.key_points.map((k) => ({ id: k.id, text: k.text, terms: k.cues })),
    answer
  );
}
