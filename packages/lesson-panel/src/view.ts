import { z } from "zod";

export const PANEL_VIEW_SCHEMA = "studium/panel-view/1" as const;
export const RecallGradeSchema = z.enum(["again", "hard", "good", "easy"]);
export const PanelActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond"), input: z.unknown() }).strict(),
  z.object({ type: z.literal("turn"), text: z.string() }).strict(),
  z.object({ type: z.literal("hint") }).strict(),
  z.object({ type: z.literal("rateRecall"), sceneId: z.string().min(1), grade: RecallGradeSchema }).strict(),
  z.object({ type: z.literal("reviewNow") }).strict(),
  z.object({ type: z.literal("restartLesson") }).strict(),
  z.object({ type: z.literal("end"), confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal("pickCourse") }).strict(),
]);
export type PanelAction = z.infer<typeof PanelActionSchema>;
export type PanelActionName = PanelAction["type"];
export const PanelActionNameSchema = z.enum(["respond", "turn", "hint", "rateRecall", "reviewNow", "restartLesson", "end", "pickCourse"]);
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
export const PanelViewSchema = z.object({
  schema: z.literal(PANEL_VIEW_SCHEMA), kind: z.enum(["scene", "done", "notice", "error"]),
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
}).strict();
export type PanelView = z.infer<typeof PanelViewSchema>;
