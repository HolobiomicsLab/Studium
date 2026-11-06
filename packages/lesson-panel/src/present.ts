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
  type PublicScene, type PanelView, type NamedConcept, type Surface,
} from "./view.js";
import type { PanelBackend, PanelContext, Payload } from "./backend.js";
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

function projectScene(scene: Payload): PublicScene {
  // A transport may already have projected its verdict deck.
  const projected = publicScene({ ...scene, ...(scene.deck && !scene.claims ? { verdict_deck: false } : {}) } as never) as Payload;
  if (scene.deck && !scene.claims) projected.verdict_deck = scene.verdict_deck;
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
  view.scene = projectScene(presentation.scene);
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
    Object.assign(view, placed, {
      schema: PANEL_VIEW_SCHEMA, prompts: ctx.prompts ?? [], attention: ctx.attention ?? "normal", surface: ctx.surface ?? DEFAULT_SURFACE,
    });
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
