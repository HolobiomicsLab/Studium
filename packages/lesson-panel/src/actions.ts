import { PANEL_VIEW_SCHEMA_V1, PANEL_VIEW_V2_FIELDS, PanelActionSchema, PanelViewSchema, type PanelAction, type PanelView } from "./view.js";
import type { PanelBackend, PanelContext, Payload } from "./backend.js";
import { presentPanel } from "./present.js";
import { reviewContext } from "./pane-messages.js";
import { lessonNextReviewAfterRating } from "./completion.js";
import { phrase } from "./phrases.js";

function reviewNotice(reply: Payload, locale: "fr" | "en"): string {
  if (reply.status !== "nothing_due") return reply.display_markdown || phrase("panel_review_unavailable", {}, locale);
  if (typeof reply.next_review_at !== "number") return phrase("panel_review_unscheduled", {}, locale);
  const date = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "full" }).format(reply.next_review_at);
  return phrase("panel_review_due", { date }, locale);
}

async function startAgain(backend: PanelBackend, ctx: PanelContext, review: boolean): Promise<Partial<PanelView>> {
  const reply = review ? await backend.startReviewSession(ctx.learnerId) : await backend.startLessonSession(ctx.bundleRef, ctx.learnerId);
  if (review && reply.status !== "started") return { kind: reply.status === "nothing_due" ? "notice" : "error", message: reviewNotice(reply, ctx.lastView?.locale ?? ctx.locale ?? "fr") };
  ctx.sessionId = reply.session_id;
  ctx.review = review ? reviewContext(reply) : null;
  delete ctx.transition;
  return {};
}

async function rate(backend: PanelBackend, ctx: PanelContext, action: Extract<PanelAction, { type: "rateRecall" }>): Promise<Partial<PanelView>> {
  const rated = await backend.rateRecall(ctx.sessionId, action.sceneId, action.grade);
  if (ctx.transition?.kind === "complete") {
    const next = lessonNextReviewAfterRating(ctx.transition.review_plan, rated);
    if (next !== undefined) ctx.transition.review_plan = { ...ctx.transition.review_plan, next_due_at: next };
  }
  if (ctx.transition?.self_rating?.scene_id === action.sceneId) delete ctx.transition.self_rating;
  return { recall_rated: { sceneId: action.sceneId, grade: action.grade } };
}

async function execute(backend: PanelBackend, ctx: PanelContext, action: PanelAction): Promise<Partial<PanelView>> {
  switch (action.type) {
    case "respond": ctx.transition = await backend.submitResponse(ctx.sessionId, action.input); return {};
    case "turn": {
      const turn = await backend.submitTurn(ctx.sessionId, action.text);
      return { turn_result: { reasoning: turn.reasoning ?? null, tutor: turn.tutor ?? null } };
    }
    case "hint": {
      const hint = await backend.requestHint(ctx.sessionId);
      return { hint: { hint: hint?.hint ?? null, ...(hint?.remaining === undefined ? {} : { remaining: hint.remaining }) } };
    }
    case "rateRecall": return rate(backend, ctx, action);
    case "reviewNow": return startAgain(backend, ctx, true);
    case "restartLesson": return startAgain(backend, ctx, false);
    default: return {};
  }
}

/** Validate and apply a learner action. Native picking/confirmation stays with the host. */
export async function applyPanelAction(backend: PanelBackend, ctx: PanelContext, input: PanelAction): Promise<PanelView> {
  const action = PanelActionSchema.parse(input);
  if (action.type === "end" && action.confirmed) {
    const previous = ctx.lastView ?? await presentPanel(backend, ctx);
    await backend.forgetSession(ctx.sessionId);
    // The session is gone: nothing places the learner any more, so the notice is a version-1 view.
    const notice: PanelView = { ...previous, schema: PANEL_VIEW_SCHEMA_V1, kind: "notice", scene: undefined, scene_assets: [], mastery: {}, actions: ["pickCourse"], message: phrase("extension_forget_done", {}, previous.locale) };
    for (const field of PANEL_VIEW_V2_FIELDS) delete notice[field];
    ctx.lastView = notice;
    return PanelViewSchema.parse(ctx.lastView);
  }
  if (action.type !== "end" && action.type !== "pickCourse") ctx.effects = await execute(backend, ctx, action);
  return presentPanel(backend, ctx);
}
