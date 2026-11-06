import { z } from "zod";

/** Version 1 (INT-STUDIUM-057). Still written by a backend that cannot give the orientation, and for
 * the notice of a forgotten session; every reader keeps reading it. */
export const PANEL_VIEW_SCHEMA_V1 = "studium/panel-view/1" as const;
/** Version 2 (INT-STUDIUM-058): version 1 plus where the learner is, who speaks, which help is open,
 * the prompts, the attention level and the surface. Fields are added, none is removed or retyped. */
export const PANEL_VIEW_SCHEMA = "studium/panel-view/2" as const;
export const PANEL_VIEW_SCHEMAS = [PANEL_VIEW_SCHEMA_V1, PANEL_VIEW_SCHEMA] as const;
export const RecallGradeSchema = z.enum(["again", "hard", "good", "easy"]);
/** How much the session may propose: nothing, the default, or more (spec § 2.6). */
export const AttentionSchema = z.enum(["quiet", "normal", "coached"]);
export type Attention = z.infer<typeof AttentionSchema>;
/** The delay, in milliseconds, between the learner's previous action and the display of the view that
 * answered it, as the surface measured it (spec § 2.3). Sent beside the next action, never inside it. */
export const ClientMsSchema = z.number().int().min(0).max(600_000);
export const PanelActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond"), input: z.unknown() }).strict(),
  z.object({ type: z.literal("turn"), text: z.string() }).strict(),
  z.object({ type: z.literal("hint") }).strict(),
  z.object({ type: z.literal("rateRecall"), sceneId: z.string().min(1), grade: RecallGradeSchema }).strict(),
  z.object({ type: z.literal("reviewNow") }).strict(),
  z.object({ type: z.literal("restartLesson") }).strict(),
  z.object({ type: z.literal("end"), confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal("pickCourse") }).strict(),
  // INT-STUDIUM-058: acts of the fast lane that need no model turn.
  /** Hand over to the conversation to ask a question; `text` is the question when the surface has it. */
  z.object({ type: z.literal("ask"), text: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal("setAttention"), level: AttentionSchema }).strict(),
  /** A language tag (`en`, `fr-CA`); null returns to the lesson's language. */
  z.object({ type: z.literal("setLanguage"), presentation_language: z.string().min(2).nullable() }).strict(),
  /** « I only have ten minutes »: the minutes the learner has now. */
  z.object({ type: z.literal("replan"), minutes: z.number().int().min(1).max(600) }).strict(),
  /** Show the concept map beside the scene (`map` on the view), until closeMap. Nothing is answered. */
  z.object({ type: z.literal("openMap") }).strict(),
  z.object({ type: z.literal("closeMap") }).strict(),
  /** « I know it » (`known`) of a concept not acquired, « I am not sure » (`unsure`) of an acquired one:
   * check questions follow, graded as any answer. The claim itself changes nothing. */
  z.object({ type: z.literal("contest"), concept_id: z.string().min(1), claim: z.enum(["known", "unsure"]) }).strict(),
  /** The learner's answer to a proposal of the view (`prompts`): accept it or dismiss it. The server
   * keeps the outcome; accepting then does what the proposal said. */
  z.object({ type: z.literal("prompt"), id: z.string().min(1), outcome: z.enum(["accept", "dismiss"]) }).strict(),
]);
export type PanelAction = z.infer<typeof PanelActionSchema>;
export type PanelActionName = PanelAction["type"];
export const PANEL_ACTION_NAMES = [
  "respond", "turn", "hint", "rateRecall", "reviewNow", "restartLesson", "end", "pickCourse", "ask", "setAttention", "setLanguage", "replan",
  "openMap", "closeMap", "contest", "prompt",
] as const satisfies readonly PanelActionName[];
export const PanelActionNameSchema = z.enum(PANEL_ACTION_NAMES);
export const NamedConceptSchema = z.object({ id: z.string(), label: z.string() });
export type NamedConcept = z.infer<typeof NamedConceptSchema>;
const object = z.record(z.unknown());
/** Common public scene fields; variant-specific display fields remain available. */
export const PublicSceneSchema = z.object({
  id: z.string(), type: z.string(), title: z.string().optional(), question: z.string().optional(),
  prompt: z.string().optional(), markdown: z.string().optional(), concept_refs: z.array(z.string()).optional(),
  choices: z.array(z.object({ id: z.string(), text: z.string() }).passthrough()).optional(),
  deck: z.array(z.object({ token: z.string(), text: z.string() }).passthrough()).optional(),
}).passthrough();
export type PublicScene = z.infer<typeof PublicSceneSchema>;
export const SourceSchema = z.object({ title: z.string(), quote: z.string().optional(), url: z.string().optional(), license: z.string().optional() });
export type Source = z.infer<typeof SourceSchema>;
export const VerdictSchema = z.object({
  scene_id: z.string(), graded: z.boolean(), correct: z.boolean().optional(), signal: z.string().optional(),
  assessed_by: z.enum(["key", "judge", "none"]).optional(), feedback: z.string().optional(),
  key_points: z.array(z.string()).optional(), key_points_missing: z.array(z.string()).optional(),
  model_answer: z.string().optional(), display_markdown: z.string().optional(), sources: z.array(SourceSchema).optional(),
}).passthrough();
export type Verdict = z.infer<typeof VerdictSchema>;
export const NavigationSchema = z.object({
  kind: z.enum(["advance", "replay", "remediate_alt", "remediate", "gate_passed", "gate_released", "gate_unassessable", "skip_mastered", "skip_concept", "calibration", "complete"]),
  scene_id: z.string().nullable().optional(), rule_id: z.string().nullable().optional(), reason: z.string().nullable().optional(),
  modulator: z.string().nullable().optional(), returns_to: z.string().optional(), skipped_scene_ids: z.array(z.string()).optional(),
}).passthrough();
export type Navigation = z.infer<typeof NavigationSchema>;
export const SelfRatingSchema = z.object({ requested: z.literal(true), scene_id: z.string().optional(), grades: z.array(RecallGradeSchema) }).passthrough();
export type SelfRating = z.infer<typeof SelfRatingSchema>;
export const AuthoringNoticeSchema = z.object({
  mode: z.enum(["teacher", "self_study"]), author_is_learner: z.boolean(), validated: z.boolean(), judge: z.boolean(), notice: z.string().nullable(),
}).passthrough();
export type AuthoringNotice = z.infer<typeof AuthoringNoticeSchema>;
export const SceneAssetSchema = z.object({
  kind: z.string(), title: z.string().optional(), path: z.string().optional(), payload: z.string().optional(), dataUri: z.string().optional(),
  bundle_ref: z.string().optional(), emphasis: z.enum(["expanded", "normal", "compact"]).optional(),
}).passthrough();
export type SceneAsset = z.infer<typeof SceneAssetSchema>;
export const CompletionSchema = z.object({
  consolidated: z.array(NamedConceptSchema), practised: z.array(NamedConceptSchema.extend({ answers: z.number() })),
  not_measured: z.array(NamedConceptSchema), detours: z.number(), next_review_at: z.number().nullable(),
  due_now: z.number(), actions: z.array(z.enum(["review", "restart", "pick"])),
});
export type Completion = z.infer<typeof CompletionSchema>;
/** Where the learner is (lesson-session-host orientation.ts computes it; this is its wire shape). */
export const OrientationSchema = z.object({
  step: z.object({ index: z.number(), total: z.number(), detour: z.object({ returns_to: z.string() }).optional() }),
  concept: z.object({ id: z.string(), title: z.string(), state: z.enum(["acquired", "to_review", "current", "seen", "upcoming"]) }).optional(),
  minutes_left: z.number().optional(),
  reviews_due: z.number(),
  waiting: z.enum(["read", "answer", "self_rating", "run", "nothing"]),
  last_adaptation: z.object({
    kind: z.string(), reason: z.string(), detail: z.object({ rule_id: z.string(), evidence: z.array(z.string()) }).optional(),
  }).optional(),
  resumed: z.object({ cause: z.enum(["restart", "surface_change", "paused"]), seen_through: z.string() }).optional(),
});
export type Orientation = z.infer<typeof OrientationSchema>;
/** Who speaks: the lesson's author, the author's key, a judge model, or the assistant. */
export const VoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("author"), name: z.string().nullable(), reviewed: z.boolean(), drafted_by: z.enum(["agent", "learner", "teacher"]) }),
  z.object({ kind: z.literal("key") }),
  z.object({ kind: z.literal("judge") }),
  z.object({ kind: z.literal("agent") }),
]);
export type Voice = z.infer<typeof VoiceSchema>;
export const VoicesSchema = z.object({ scene: VoiceSchema, verdict: VoiceSchema.optional() });
export type Voices = z.infer<typeof VoicesSchema>;
export const HelpSchema = z.object({
  rungs: z.array(z.object({
    kind: z.enum(["reread", "hint", "explain", "reference"]), available: z.boolean(), cost: z.string().optional(), why_not: z.string().optional(),
  })),
});
export type Help = z.infer<typeof HelpSchema>;
/** A proposal the learner may accept or dismiss (spec § 2.6): two actions at most. `replan` is the
 * answer to the learner's own « I have N minutes »: asked for, so never counted as a proposal. */
export const PromptSchema = z.object({
  id: z.string(),
  kind: z.enum(["review_due", "break", "next_lesson", "map_offer", "forms_offer", "resume_notice", "adaptation_notice", "replan"]),
  reason: z.string(),
  actions: z.array(z.object({ label: z.string(), action: PanelActionSchema })).max(2),
  expires: z.enum(["scene", "session"]),
});
export type Prompt = z.infer<typeof PromptSchema>;
const SurfaceKindSchema = z.enum(["text", "form", "pane", "panel"]);
/** The surface the lesson is played on, its rank on the ladder (3 panel or pane, 2 forms, 1 text) and
 * the ones the host could use instead. */
export const SurfaceSchema = z.object({ rank: z.union([z.literal(1), z.literal(2), z.literal(3)]), kind: SurfaceKindSchema, available: z.array(SurfaceKindSchema) });
export type Surface = z.infer<typeof SurfaceSchema>;
/** One answer behind a concept's state (spec § 2.7): its scene, the calendar day, who assessed it and
 * with what result, and the hints taken before it. `self` and `rated`: the learner rated their own
 * recall. `none` and `recorded`: nobody assessed the answer and the learner has not rated it. `day`
 * and `hints` are null when the server kept no such fact. */
export const MapEvidenceSchema = z.object({
  scene_id: z.string(), day: z.string().nullable(), assessed_by: z.enum(["key", "judge", "self", "none"]),
  result: z.enum(["right", "wrong", "rated", "recorded"]), hints: z.number().int().nonnegative().nullable(),
});
export type MapEvidence = z.infer<typeof MapEvidenceSchema>;
/** What the learner may contest of a concept (spec § 2.7): the claim its state takes (`unsure` of an
 * acquired concept, `known` of any other), whether it can be made now, how many check questions follow
 * (one: the outcome will be partial), whether its check is under way, and what the last one showed. */
export const MapContestSchema = z.object({
  allowed: z.boolean(), check_pending: z.boolean().optional(), claim: z.enum(["known", "unsure"]),
  questions: z.number().int().nonnegative(), outcome: z.enum(["confirmed", "refuted", "partial"]).optional(),
});
export type MapContest = z.infer<typeof MapContestSchema>;
/** The concept map as a view of the session: each concept with its state, the evidence, what the state
 * establishes and what it does not; the prerequisite links, from a prerequisite to what needs it. */
export const MapViewSchema = z.object({
  concepts: z.array(z.object({
    id: z.string(), title: z.string(), state: z.enum(["acquired", "to_review", "current", "seen", "upcoming"]),
    evidence: z.array(MapEvidenceSchema), establishes: z.string(), does_not_establish: z.string(),
    contest: MapContestSchema.optional(),
  })),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});
export type MapView = z.infer<typeof MapViewSchema>;
export const STATUS_LINE_MAX = 80;
/** The fields version 2 adds; a version-2 view carries every one of them. */
export const PANEL_VIEW_V2_FIELDS = ["orientation", "status_line", "voices", "help", "prompts", "attention", "surface"] as const;

export const PanelViewSchema = z.object({
  schema: z.enum(PANEL_VIEW_SCHEMAS), kind: z.enum(["scene", "done", "notice", "error"]),
  session_id: z.string(), learner_id: z.string(), bundle_ref: z.string(), lesson_title: z.string(),
  locale: z.enum(["fr", "en"]), strings: z.record(z.string()), progress: z.object({ index: z.number(), total: z.number() }),
  scene: PublicSceneSchema.optional(), scene_assets: z.array(SceneAssetSchema), modalityPreference: z.enum(["balanced", "visual", "textual"]),
  verdict: VerdictSchema.nullable().optional(), navigation: NavigationSchema.nullable().optional(), self_rating: SelfRatingSchema.nullable().optional(),
  reviewDue: z.array(NamedConceptSchema), calibration: z.array(z.object({ concept_id: z.string(), band: z.enum(["bien", "sur", "sous"]), message: z.string() })),
  mastery: z.record(z.number().nullable()), authoring: AuthoringNoticeSchema.nullable().optional(), sources: z.array(SourceSchema).optional(),
  explanation: z.union([z.string(), object]).nullable().optional(),
  hint: z.object({ hint: z.string().nullable(), remaining: z.number().optional() }).optional(),
  turn_result: z.object({ reasoning: object.nullable(), tutor: object.nullable() }).optional(),
  recall_rated: z.object({ sceneId: z.string(), grade: RecallGradeSchema }).optional(),
  completion: CompletionSchema.optional(), message: z.string().optional(), actions: z.array(PanelActionNameSchema), pending: z.string().optional(),
  orientation: OrientationSchema.optional(), status_line: z.string().max(STATUS_LINE_MAX).optional(), voices: VoicesSchema.optional(),
  help: HelpSchema.optional(), prompts: z.array(PromptSchema).optional(), attention: AttentionSchema.optional(), surface: SurfaceSchema.optional(),
  /** The concept map, present after the action openMap and until closeMap. */
  map: MapViewSchema.optional(),
}).strict().superRefine((view, ctx) => {
  if (view.schema !== PANEL_VIEW_SCHEMA) return;
  for (const field of PANEL_VIEW_V2_FIELDS) {
    if (view[field] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `a ${PANEL_VIEW_SCHEMA} view carries ${field}` });
  }
});
export type PanelView = z.infer<typeof PanelViewSchema>;
