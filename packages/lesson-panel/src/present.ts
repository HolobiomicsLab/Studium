// Projection only: image IO is injected; redaction remains the existing host rule.
import { publicScene } from "../../lesson-session-host/src/public-scene.js";
import { browserPhrases, phrase } from "./phrases.js";
import { calibrationVerdicts } from "./calibration.js";
import { reviewDueConcepts } from "./review-fsrs.js";
import { selectRenderOrder } from "./modality.js";
import { assetBundleRef } from "./pane-messages.js";
import { completionSplit } from "./completion.js";
import {
  PANEL_VIEW_SCHEMA, PANEL_VIEW_SCHEMA_V1, PanelViewSchema, PublicSceneSchema,
  type PublicScene, type PanelView, type NamedConcept, type Prompt, type Surface,
} from "./view.js";
import type { PanelBackend, PanelContext, Payload, ServedPrompt } from "./backend.js";
import { mapView } from "./map.js";

const FORBIDDEN_FIELDS = new Set(["answer", "correct", "expected", "key", "solution"]);

/** Reject unexpected answer metadata; never invent a second stripping policy. */
export function assertPublicContent(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) throw new Error(`Unexpected answer field in panel content: ${key}`);
    assertPublicContent(child);
  }
}

function projectScene(scene: Payload, locale: "fr" | "en"): PublicScene {
  // A transport may already have projected its verdict deck.
  const projected = publicScene({ ...scene, ...(scene.deck && !scene.claims ? { verdict_deck: false } : {}) } as never) as Payload;
  if (scene.deck && !scene.claims) projected.verdict_deck = scene.verdict_deck;
  // An ai_critique scene has no field of its own for the claims, and the pane already draws `markdown`:
  // the claims the learner critiques go there, numbered, under their label.
  if (projected.type === "ai_critique" && Array.isArray(projected.claims_to_critique) && !projected.markdown) {
    const texts = projected.claims_to_critique.flatMap((c: unknown) =>
      c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? [(c as { text: string }).text] : []);
    if (texts.length) projected.markdown = `**${phrase("pane_ai_claims", {}, locale)}**\n\n${texts.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`;
  }
  assertPublicContent(projected);
  return PublicSceneSchema.parse(projected);
}

function named(ctx: PanelContext, ids: string[]): NamedConcept[] {
  return ids.map(id => {
    const bare = id.replace(/^concept:/, "");
    return { id, label: ctx.review?.titles[id] ?? ctx.review?.titles[bare] ?? ctx.conceptTitles?.[id] ?? ctx.conceptTitles?.[bare] ?? bare };
  });
}

/** Count every due category, including weak and self-rated concepts. */
export async function reviewSchedule(backend: PanelBackend, sessionId: string): Promise<number> {
  try {
    const status = await backend.getNextReinforcement(sessionId);
    return ["due", "relearn", "unmeasured"].reduce((n, key) => n + (status[key]?.length ?? 0), 0);
  } catch { return 0; }
}

function baseView(ctx: PanelContext, presentation: Payload): PanelView {
  const locale = ctx.locale ?? (presentation.locale === "en" ? "en" : "fr");
  return {
    schema: PANEL_VIEW_SCHEMA_V1, kind: "scene", session_id: ctx.sessionId, learner_id: ctx.learnerId,
    bundle_ref: ctx.bundleRef, lesson_title: ctx.lessonTitle, locale, strings: browserPhrases(locale),
    progress: { index: (presentation.index ?? 0) + 1, total: presentation.total ?? ctx.lastView?.progress.total ?? 0 },
    scene_assets: [], modalityPreference: ctx.modalityPreference ?? "balanced", reviewDue: [], calibration: [],
    mastery: ctx.showMastery ? presentation.learnerSnapshot?.conceptMastery ?? {} : {},
    authoring: presentation.authoring ?? ctx.lastView?.authoring ?? null,
    actions: ["respond", "hint", "reviewNow", "restartLesson", "end", "pickCourse"],
  };
}

async function sceneView(backend: PanelBackend, ctx: PanelContext): Promise<PanelView> {
  const presentation = await backend.getCurrentScene(ctx.sessionId);
  const view = baseView(ctx, presentation);
  view.scene = projectScene(presentation.scene, view.locale);
  const assets = await backend.getSceneArtifacts(ctx.sessionId);
  assertPublicContent(assets);
  view.scene_assets = selectRenderOrder(await Promise.all(assets.map(asset =>
    backend.inlineImage(asset, assetBundleRef({ bundle_ref: asset.bundle_ref }, presentation.scene.id, ctx.review ?? null, ctx.bundleRef)))), view.modalityPreference);
  try {
    const state = await backend.getSessionState(ctx.sessionId);
    view.reviewDue = named(ctx, reviewDueConcepts(state, ctx.now?.()));
    view.calibration = calibrationVerdicts(state, view.locale);
  } catch { /* Review cues are best effort. */ }
  view.explanation = presentation.explanation ?? null;
  if (view.scene.type === "discussion") view.actions.push("turn");
  return view;
}

async function doneView(backend: PanelBackend, ctx: PanelContext): Promise<PanelView> {
  const t = ctx.transition!;
  const view = baseView(ctx, { locale: ctx.lastView?.locale });
  const split = completionSplit(t);
  const due = await reviewSchedule(backend, ctx.sessionId);
  view.kind = "done";
  view.progress.index = view.progress.total;
  view.calibration = calibrationVerdicts(t.summary?.finalState ?? {}, view.locale);
  view.message = phrase("extension_done", { count: t.summary?.scenesCompleted ?? 0 }, view.locale);
  view.actions = ["reviewNow", "restartLesson", "pickCourse", "end"];
  view.completion = {
    consolidated: named(ctx, split.consolidated), practised: split.practised.map(p => ({ ...named(ctx, [p.id])[0]!, answers: p.answers })),
    not_measured: named(ctx, split.not_measured), detours: Object.values(t.summary?.scenes_detoured ?? {}).reduce<number>((n, x) => n + Number(x), 0),
    next_review_at: t.review_plan?.next_due_at ?? null, due_now: due, actions: [...(due ? ["review" as const] : []), "restart", "pick"],
  };
  return view;
}

/** How each kind of proposal is answered: the words of « yes » and of « no » (spec § 2.6: two actions
 * at most, refusing always possible). A notice has none: it asks nothing. */
const PROMPT_LABELS: Partial<Record<Prompt["kind"], readonly [accept: Parameters<typeof phrase>[0], dismiss: Parameters<typeof phrase>[0]]>> = {
  review_due: ["panel_prompt_review_accept", "panel_prompt_later"],
  break: ["panel_prompt_break_accept", "panel_prompt_break_dismiss"],
  next_lesson: ["panel_prompt_next_accept", "panel_prompt_later"],
  map_offer: ["panel_prompt_map_accept", "panel_prompt_later"],
  forms_offer: ["panel_prompt_forms_accept", "panel_prompt_forms_dismiss"],
};
const NOTICE_PROMPTS: ReadonlySet<string> = new Set(["resume_notice", "adaptation_notice"]);

/** A served prompt as the view shows it: both answers go back to the server as a `prompt` action, so
 * the outcome is kept whichever the learner picks. A kind this view has no words for is left out. */
function promptOf(served: ServedPrompt, locale: "fr" | "en"): Prompt[] {
  const kind = served.kind as Prompt["kind"];
  const base = { id: served.id, kind, reason: served.reason, expires: served.expires };
  if (NOTICE_PROMPTS.has(served.kind)) return [{ ...base, actions: [] }];
  const labels = PROMPT_LABELS[kind];
  if (!labels) return [];
  return [{ ...base, actions: [
    { label: phrase(labels[0], {}, locale), action: { type: "prompt", id: served.id, outcome: "accept" } },
    { label: phrase(labels[1], {}, locale), action: { type: "prompt", id: served.id, outcome: "dismiss" } },
  ] }];
}

/** The surface a view is composed for until the host says which one it plays on: a panel, with the
 * conversation text always there to fall back on. */
const DEFAULT_SURFACE: Surface = { rank: 3, kind: "panel", available: ["text", "panel"] };

/** Compose a complete public view; only earned transition feedback may carry correctness. With a
 * backend that gives the orientation the view is version 2: where the learner is, who speaks, which
 * help is open, no prompt yet, the attention level and the surface. */
export async function presentPanel(backend: PanelBackend, ctx: PanelContext): Promise<PanelView> {
  const view = ctx.transition?.kind === "complete" ? await doneView(backend, ctx) : await sceneView(backend, ctx);
  view.verdict = ctx.transition?.verdict ?? null;
  view.navigation = ctx.transition?.navigation ?? null;
  view.self_rating = ctx.transition?.self_rating ?? null;
  if (view.self_rating?.requested) view.actions.push("rateRecall");
  if (backend.getOrientation) {
    const placed = await backend.getOrientation(ctx.sessionId, {
      locale: view.locale, lessonTitle: view.lesson_title, verdict: ctx.transition?.verdict ?? null,
    });
    const attention = ctx.attention ?? "normal";
    const surface = ctx.surface ?? DEFAULT_SURFACE;
    // The server's proposals first, then the answer to the learner's own « I have N minutes ».
    const served = backend.getPrompts ? await backend.getPrompts(ctx.sessionId, { attention, surface, locale: view.locale }) : [];
    const prompts = [...served.flatMap(prompt => promptOf(prompt, view.locale)), ...(ctx.prompts ?? [])];
    Object.assign(view, placed, { schema: PANEL_VIEW_SCHEMA, prompts, attention, surface });
    if (prompts.some(prompt => prompt.actions.some(offered => offered.action.type === "prompt"))) view.actions.push("prompt");
    // What a placed learner can do on any scene without a model turn (applyPanelAction).
    if (view.kind === "scene") view.actions.push("ask", "setLanguage", "setAttention", "replan");
    // The map (spec § 2.7): on request, from forms upwards, for a lesson (a review session has none).
    // A closed map is not read: it costs the fast lane nothing.
    if (backend.getConceptMapRecord && !ctx.review && (view.surface?.rank ?? 3) >= 2) {
      const record = ctx.mapOpen ? await backend.getConceptMapRecord(ctx.sessionId) : null;
      if (record) view.map = mapView(record, view.locale);
      view.actions.push(view.map ? "closeMap" : "openMap");
      // The contest buttons live on the map: offered with it, on a scene, when the backend can check.
      if (view.map && view.kind === "scene" && backend.contestConcept) view.actions.push("contest");
    }
  }
  ctx.lastView = PanelViewSchema.parse({ ...view, ...ctx.effects });
  return ctx.lastView;
}
