import {
  PANEL_ACTION_NAMES, PANEL_VIEW_SCHEMA_V1, PANEL_VIEW_V2_FIELDS, PanelActionSchema, PanelViewSchema,
  type Orientation, type PanelAction, type PanelView, type Prompt,
} from "./view.js";
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
  delete ctx.mapOpen;
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

/** The locale a view of this context is written in before the lesson's own is known. */
function localeOf(ctx: PanelContext): "fr" | "en" { return ctx.locale ?? ctx.lastView?.locale ?? "fr"; }

/** The panel's own text (labels, status line) exists in French and English. A regional tag keeps its
 * base language; null returns to the lesson's language. The lesson's content is not translated here:
 * only the conversation does that, and the session notes the language for it, whatever it is. For
 * any other language the panel says it has no text of its own. */
async function setLanguage(backend: PanelBackend, ctx: PanelContext, language: string | null): Promise<Partial<PanelView>> {
  await backend.setSessionLanguage?.(ctx.sessionId, language);
  const base = language?.toLowerCase().split(/[-_]/)[0];
  if (language === null) delete ctx.locale;
  else if (base === "fr" || base === "en") ctx.locale = base;
  else return { kind: "notice", message: phrase("panel_language_unsupported", {}, localeOf(ctx)) };
  return {};
}

/** What fits in the minutes the learner has, from where the view places them: the reviews due first,
 * then whether the lesson ends in time. Nothing is cut or skipped: the learner stops when they want. */
function replanReason(minutes: number, o: Orientation | undefined, locale: "fr" | "en"): { reason: string; reviews: number } {
  const left = o?.minutes_left;
  const time = left === undefined ? phrase("panel_replan_open", { minutes }, locale)
    : phrase(left <= minutes ? "panel_replan_fits" : "panel_replan_longer", { minutes, left }, locale);
  const reviews = o?.reviews_due ?? 0;
  const due = reviews === 0 ? "" : phrase(reviews === 1 ? "panel_replan_review_one" : "panel_replan_review_many", { count: reviews }, locale);
  return { reason: due ? `${time} ${due}` : time, reviews };
}

/** « I have N minutes »: a prompt on a view that places the learner, a notice otherwise. Asked again,
 * the prompt is replaced. The session is read afresh: the last view may predate an answer given in
 * the conversation. */
async function replan(backend: PanelBackend, ctx: PanelContext, minutes: number): Promise<Partial<PanelView>> {
  const placed = await presentPanel(backend, ctx);
  const locale = placed.locale;
  const { reason, reviews } = replanReason(minutes, placed.orientation, locale);
  if (!placed.orientation) return { kind: "notice", message: reason };
  const prompt: Prompt = {
    id: "replan", kind: "replan", reason, expires: "scene",
    actions: reviews > 0 ? [{ label: phrase("panel_replan_review_label", {}, locale), action: { type: "reviewNow" } }] : [],
  };
  ctx.prompts = [...(ctx.prompts ?? []).filter(p => p.id !== prompt.id), prompt];
  return {};
}

/** What a contest's check showed, in one sentence: the claim, the answers, and that no step is skipped. */
function contestMessage(settled: { claim?: string; outcome?: string }, locale: "fr" | "en"): string {
  if (settled.outcome === "partial") return phrase("panel_contest_partial", {}, locale);
  const claim = settled.claim === "unsure" ? "unsure" : "known";
  return phrase(`panel_contest_${settled.outcome === "confirmed" ? "confirmed" : "refuted"}_${claim}`, {}, locale);
}

/** The scene changed, or the session did: what was proposed for that scene leaves with it. */
function leaveScene(ctx: PanelContext): void {
  if (ctx.prompts) ctx.prompts = ctx.prompts.filter(p => p.expires !== "scene");
}

async function execute(backend: PanelBackend, ctx: PanelContext, action: PanelAction): Promise<Partial<PanelView>> {
  switch (action.type) {
    case "respond": {
      ctx.transition = await backend.submitResponse(ctx.sessionId, action.input);
      leaveScene(ctx);
      // The answer that ends a contest's check says what the check showed.
      const settled = ctx.transition?.contest as { claim?: string; outcome?: string } | undefined;
      return settled ? { message: contestMessage(settled, localeOf(ctx)) } : {};
    }
    case "turn": {
      const turn = await backend.submitTurn(ctx.sessionId, action.text);
      return { turn_result: { reasoning: turn.reasoning ?? null, tutor: turn.tutor ?? null } };
    }
    case "hint": {
      const hint = await backend.requestHint(ctx.sessionId);
      return { hint: { hint: hint?.hint ?? null, ...(hint?.remaining === undefined ? {} : { remaining: hint.remaining }) } };
    }
    case "rateRecall": return rate(backend, ctx, action);
    case "reviewNow": leaveScene(ctx); return startAgain(backend, ctx, true);
    case "restartLesson": leaveScene(ctx); return startAgain(backend, ctx, false);
    case "setAttention": ctx.attention = action.level; return {};
    case "setLanguage": return setLanguage(backend, ctx, action.presentation_language);
    case "replan": return replan(backend, ctx, action.minutes);
    case "ask": {
      // Nothing is submitted and the scene stays: the learner goes to the conversation and comes back.
      if (action.text === undefined) delete ctx.question; else ctx.question = action.text;
      return { kind: "notice", message: phrase("panel_ask_notice", {}, localeOf(ctx)) };
    }
    case "openMap": {
      // Nothing is submitted: the scene stays, the map shows beside it until closeMap.
      ctx.mapOpen = Boolean(await backend.getConceptMapRecord?.(ctx.sessionId));
      return ctx.mapOpen ? {} : { kind: "notice", message: phrase("panel_map_unavailable", {}, localeOf(ctx)) };
    }
    case "closeMap": delete ctx.mapOpen; return {};
    case "contest": {
      if (!backend.contestConcept) throw new Error("this server cannot check a contested concept");
      const started = await backend.contestConcept(ctx.sessionId, action.concept_id, action.claim);
      // The session is now on the first check question: the previous answer's verdict leaves with its scene.
      delete ctx.transition;
      leaveScene(ctx);
      return { message: phrase(started.questions === 1 ? "panel_contest_one" : "panel_contest_two", {}, localeOf(ctx)) };
    }
    case "prompt": {
      if (!backend.settlePrompt) throw new Error("this server holds no prompt to answer");
      const settled = await backend.settlePrompt(ctx.sessionId, action.id, action.outcome === "accept" ? "accepted" : "dismissed");
      // Dismissed: the outcome is kept and nothing else happens. Accepted: what the proposal said.
      return action.outcome === "accept" ? acceptPrompt(backend, ctx, settled.kind) : {};
    }
    default: return {};
  }
}

/** Do what an accepted proposal said. A review and the map are the panel's own actions; a break, the
 * forms and the next lesson are the learner's to take, so the view says how in one line. */
async function acceptPrompt(backend: PanelBackend, ctx: PanelContext, kind: string): Promise<Partial<PanelView>> {
  if (kind === "review_due") return execute(backend, ctx, { type: "reviewNow" });
  if (kind === "map_offer") return execute(backend, ctx, { type: "openMap" });
  const notice = { break: "panel_prompt_break_notice", forms_offer: "panel_prompt_forms_notice", next_lesson: "panel_prompt_next_notice" } as const;
  const key = notice[kind as keyof typeof notice];
  return key ? { kind: "notice", message: phrase(key, {}, localeOf(ctx)) } : {};
}

/** Read an action, or say in one line why it is refused. */
function readAction(input: unknown): PanelAction {
  const parsed = PanelActionSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const type = typeof input === "object" && input !== null ? (input as { type?: unknown }).type : undefined;
  if (typeof type !== "string") throw new Error("a panel action is an object with a type");
  if (!(PANEL_ACTION_NAMES as readonly string[]).includes(type)) throw new Error(`unknown panel action "${type}"; known: ${PANEL_ACTION_NAMES.join(", ")}`);
  const issue = parsed.error.issues[0];
  throw new Error(`invalid ${type} action: ${[issue?.path.join("."), issue?.message].filter(Boolean).join(" ")}`);
}

/** Validate and apply a learner action. Native picking/confirmation stays with the host. */
export async function applyPanelAction(backend: PanelBackend, ctx: PanelContext, input: PanelAction): Promise<PanelView> {
  const action = readAction(input);
  if (action.type === "end" && action.confirmed) {
    const previous = ctx.lastView ?? await presentPanel(backend, ctx);
    await backend.forgetSession(ctx.sessionId);
    // The session is gone: nothing places the learner any more, so the notice is a version-1 view.
    const notice: PanelView = { ...previous, schema: PANEL_VIEW_SCHEMA_V1, kind: "notice", scene: undefined, scene_assets: [], mastery: {}, actions: ["pickCourse"], message: phrase("extension_forget_done", {}, previous.locale) };
    for (const field of PANEL_VIEW_V2_FIELDS) delete notice[field];
    delete notice.map;
    delete ctx.mapOpen;
    ctx.lastView = notice;
    return PanelViewSchema.parse(ctx.lastView);
  }
  if (action.type !== "end" && action.type !== "pickCourse") ctx.effects = await execute(backend, ctx, action);
  return presentPanel(backend, ctx);
}
