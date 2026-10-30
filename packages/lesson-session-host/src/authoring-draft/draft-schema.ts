// packages/lesson-session-host/src/authoring-draft/draft-schema.ts
//
// LessonDraft (contract C2): what an agent sends to create_lesson. A draft is a LessonBundle 1.4
// without its bookkeeping: scenes are the bundle's scene objects with every identifier optional
// (scene ids, choice, key point and claim ids), base fields defaulted and, per scene, the
// `quotes` it rests on. The builder (build.ts) fills ids, graph, evidence and metadata.authoring.
//
// The scene schemas are derived from the bundle's own, so a field added to a bundle scene is a
// draft field too. Objects are strict: a misspelt optional field ("hint" for "hints") is an error,
// not a silent loss. The draft offers the 12 scene types that need no executed capsule: a
// reproduction needs a run the conversational route cannot attest (teacher route).
import { z } from "zod";
import {
  AICritiqueRubricSchema, AICritiqueSceneSchema, BloomLevelSchema, CommunicationSimSceneSchema, ComparisonSceneSchema,
  ConceptSceneSchema, DiscussionSceneSchema, ExplainBackSceneSchema, IntroSceneSchema,
  MetaCheckpointSceneSchema, PromptPracticeSceneSchema, QuizSceneSchema, SpotTheFlawSceneSchema,
  SummaryAuditSceneSchema,
} from "@studium/lesson-bundle-schema";

/** Concept and course ids: a short lowercase name, safe as a path segment and a graph id. */
export const DRAFT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DraftIdSchema = z.string().regex(DRAFT_ID_PATTERN, "a short lowercase id such as c-solidarite");
/** A cue is a stem or a short phrase the learner would write, never a sentence. */
export const MAX_CUE_CHARS = 40;

export const QuoteSchema = z.object({
  passage_id: z.string().min(1),
  text: z.string().min(1),
}).strict();

const Quotes = z.array(QuoteSchema).min(1).max(5);
const OptionalQuotes = z.array(QuoteSchema).max(5).optional();

/** What every draft scene may leave out of a bundle scene (the builder fills it), plus quotes. */
const DRAFT_BASE = {
  id: DraftIdSchema.optional(),
  objective_refs: z.array(z.string()).optional(),
  concept_refs: z.array(z.string().min(1)).min(1).optional(),
  estimated_seconds: z.number().int().nonnegative().optional(),
  adaptation_hooks: z.array(z.string()).optional(),
  quotes: Quotes,
};
/** Production and audit scenes may leave the rubric out: the builder writes the usual weights. */
const OPTIONAL_RUBRIC = { rubric: AICritiqueRubricSchema.strict().optional() };

const DraftChoiceSchema = z.object({ id: z.string().min(1).optional(), text: z.string().min(1), correct: z.boolean() }).strict();
const DraftKeyPointSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().min(1),
  cues: z.array(z.string().trim().min(2).max(MAX_CUE_CHARS)).min(2).max(4),
}).strict();
const DraftClaimSchema = z.object({ id: z.string().min(1).optional(), text: z.string().min(1), flaws_expected: z.array(z.string().min(1)) }).strict();
const DraftFlawClaimSchema = DraftClaimSchema.extend({ flaws_expected: z.array(z.string().min(1)).min(1) }).strict();
const DraftSoundClaimSchema = z.object({ id: z.string().min(1).optional(), text: z.string().min(1) }).strict();

export const DraftSceneSchema = z.discriminatedUnion("type", [
  IntroSceneSchema.omit({ evidence: true }).extend({ ...DRAFT_BASE, quotes: OptionalQuotes }).strict(),
  ConceptSceneSchema.omit({ evidence: true, image_path: true }).extend(DRAFT_BASE).strict(),
  QuizSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE,
    choices: z.array(DraftChoiceSchema).min(2).max(6),
    hints: z.array(z.string().min(1)).max(3).optional(),
  }).strict(),
  MetaCheckpointSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, quotes: OptionalQuotes, scale_labels: z.array(z.string().min(1)).length(5).optional(),
  }).strict(),
  AICritiqueSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC, claims: z.array(DraftClaimSchema).min(1).max(3),
  }).strict(),
  DiscussionSceneSchema.omit({ evidence: true }).extend(DRAFT_BASE).strict(),
  SpotTheFlawSceneSchema.omit({ evidence: true, reference_result: true, reference_from_run: true, regenerate_from_run: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC,
    claims: z.array(DraftFlawClaimSchema).min(1).max(5),
    sound_claims: z.array(DraftSoundClaimSchema).optional(),
  }).strict(),
  ExplainBackSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC, key_points: z.array(DraftKeyPointSchema).min(1).max(6),
  }).strict(),
  ComparisonSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC, key_points: z.array(DraftKeyPointSchema).min(1).max(6),
  }).strict(),
  SummaryAuditSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC, claims: z.array(DraftFlawClaimSchema).min(1).max(5),
  }).strict(),
  PromptPracticeSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC, key_points: z.array(DraftKeyPointSchema).min(1).max(6),
  }).strict(),
  CommunicationSimSceneSchema.omit({ evidence: true }).extend({
    ...DRAFT_BASE, ...OPTIONAL_RUBRIC, key_points: z.array(DraftKeyPointSchema).min(1).max(6),
  }).strict(),
]);

export const DraftConceptSchema = z.object({
  id: DraftIdSchema,
  label: z.string().min(1).max(200),
  bloom: BloomLevelSchema,
  prerequisites: z.array(z.string().min(1)).max(10).optional(),
  description: z.string().min(1).max(1000).optional(),
}).strict();

/** Optional intake (SL-6): it shapes the draft (examples, the opening diagnostic) and is not stored
 * in the lesson. */
export const LearnerProfileSchema = z.object({
  prior: z.string().min(1).max(1000).optional(),
  interests: z.array(z.string().min(1).max(200)).max(10).optional(),
  minutes_per_day: z.number().int().positive().max(600).optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date YYYY-MM-DD").optional(),
}).strict();

export const LessonDraftSchema = z.object({
  title: z.string().min(1).max(200),
  /** BCP 47 tag of the lesson's language (the learner's); quotes stay in their source's language. */
  language: z.string().min(2).max(35),
  /** The learner's goal in their own words; defaults to the goal given to prepare_sources. */
  goal: z.string().min(1).max(1000).optional(),
  target: z.string().min(1).max(200).optional(),
  discipline: z.string().max(200).optional(),
  duration_minutes: z.number().int().positive().max(600).optional(),
  learner_profile: LearnerProfileSchema.optional(),
  concepts: z.array(DraftConceptSchema).min(1).max(20),
  scenes: z.array(DraftSceneSchema).min(1).max(40),
}).strict();

export type LessonDraft = z.infer<typeof LessonDraftSchema>;
export type DraftScene = z.infer<typeof DraftSceneSchema>;
export type DraftSceneType = DraftScene["type"];
