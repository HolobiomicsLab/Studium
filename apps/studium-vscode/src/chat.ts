// chat.ts — the @studium chat participant. Puts the judge-the-AI loop in the editor's OWN Copilot/Claude
// chat panel: the learner types `@studium` to run a lesson turn-by-turn, or `/hint` and `/discuss`. It
// reuses the exact lesson-mcp plumbing (connectLessonMcp) on the pane's learner storage (lesson-server.ts) and
// streams the SERVER-authored, redacted text — no client LLM, so the answer key stays server-side.
//
// CQ-3: what the learner reads is the host's own chat text (presentation.display_markdown, then after an
// answer verdict.display_markdown and transition.display_markdown), so the chat shows the authoring notice,
// the not-durable warning, the cited sources and the completion lists exactly as any MCP harness does. The
// chat-format.ts formatters are only the fallback for an older server that serves no display text.
// CQ-4 / L-10: the learner's words go to the host as {kind: "reply", text}; the host maps them to the scene's
// input or refuses them in one line, which the chat shows with how this scene is answered.
import * as vscode from "vscode";
import { join } from "node:path";
import { connectLessonMcp, resolveLogSink, type LessonMcp } from "./mcp-connect.js";
import { lessonServerConfig } from "./lesson-server.js";
import { formatSceneForChat, navigationNote, ratingAgainPrompt, reasoningNote, recallGradeOf, verdictForChat, type ChatScene } from "./chat-format.js";
import { phrase, type Locale } from "./phrases.js";

type Json = Record<string, any>;

// One active chat lesson at a time (mirrors the single-active-lesson model of the panel). `rating` is the
// self-rating the last verdict asked for (C4): a grade as the next reply is that rating. `ended` keeps a
// completed lesson open only for that rating.
interface ChatLesson {
  mcp: LessonMcp; sid: string; presentation: Json; locale: Locale;
  rating?: { sceneId: string; grades: readonly string[] }; ended?: boolean;
}
let chatLesson: ChatLesson | null = null;
const RECALL_GRADES = ["again", "hard", "good", "easy"] as const;
/** Scenes whose only input is an acknowledgement: a reply there that is not a grade cannot be an answer. */
const ACK_SCENES = new Set(["intro", "concept", "reproduction"]);
const MOVE_ON = /^(?:continuer|continue|suivant|suite|next|ok|okay|d'accord|passer|on continue|skip)$/u;

/** The participant's handler, exported for the extension-host driver (it drives it under a fake `vscode`). */
export type StudiumChatHandler = (request: { command?: string; prompt: string }, stream: { markdown(text: string): void }) => Promise<void>;

export function registerStudiumChat(context: vscode.ExtensionContext): StudiumChatHandler {
  const handler: StudiumChatHandler = (request, stream) => handle(context, request, stream);
  const participant = vscode.chat.createChatParticipant("studium.tutor",
    async (request, _ctx, stream, _token) => { await handler(request, stream); });
  participant.iconPath = vscode.Uri.file(join(context.extensionPath, "media", "studium-icon.svg"));
  // Reap an abandoned chat lesson's lesson-mcp subprocess when the extension deactivates (it is not tied
  // to the participant's own lifetime, so it would otherwise linger until the next /start).
  context.subscriptions.push(participant, { dispose: () => { void chatLesson?.mcp.close(); chatLesson = null; } });
  return handler;
}

async function handle(context: vscode.ExtensionContext, request: { command?: string; prompt: string }, stream: { markdown(text: string): void }): Promise<void> {
  try {
    // A lesson whose server was closed under it (« Oublier mes données » closes them all) is over.
    if (chatLesson?.mcp.isClosed()) chatLesson = null;
    const cmd = request.command;
    if (cmd === "hint") return await doHint(stream);
    if (cmd === "discuss") return await doDiscuss(stream, request.prompt);
    if (chatLesson?.ended && !(chatLesson.rating && recallGradeOf(request.prompt || "", chatLesson.rating.grades))) {
      void chatLesson.mcp.close();
      chatLesson = null;
    }
    if (cmd === "start" || !chatLesson) return await doStart(context, stream);
    await doAnswer(stream, request.prompt);
  } catch (e: any) {
    stream.markdown(`\n\n⚠ Studium : ${e.message}`);
  }
}

async function doStart(context: vscode.ExtensionContext, stream: { markdown(text: string): void }): Promise<void> {
  if (chatLesson) { void chatLesson.mcp.close(); chatLesson = null; }
  const { serverLaunch, env, bundleRef, learnerId } = lessonServerConfig(context);
  const mcp = await connectLessonMcp({ launch: serverLaunch, env });
  let started: Json;
  try {
    started = await mcp.call("start_lesson_session", { bundle_ref: bundleRef, learner_id: learnerId });
  } catch (e) {
    void mcp.close();
    throw e;
  }
  const locale = started.presentation?.locale === "en" ? "en" : "fr";
  chatLesson = { mcp, sid: started.session_id, presentation: started.presentation ?? {}, locale };
  stream.markdown(`${phrase("chat_started", { bundle: bundleRef }, locale)}\n\n`);
  stream.markdown(presentationText(started.presentation ?? {}, locale));
}

/** The served text of a presentation, else the extension's own rendering of its redacted scene. */
function presentationText(presentation: Json, locale: Locale): string {
  if (typeof presentation.display_markdown === "string" && presentation.display_markdown.trim()) return presentation.display_markdown;
  return formatSceneForChat(
    (presentation.scene || {}) as ChatScene,
    presentation.total ? { index: (presentation.index ?? 0) + 1, total: presentation.total } : undefined,
    locale,
  );
}

/** Remember the presentation now on screen (its scene decides how the next reply is read). */
function remember(lesson: ChatLesson, presentation: Json | undefined): void {
  if (!presentation) return;
  lesson.presentation = presentation;
  if (presentation.locale === "en" || presentation.locale === "fr") lesson.locale = presentation.locale;
}

async function doAnswer(stream: { markdown(text: string): void }, prompt: string): Promise<void> {
  if (!chatLesson) return;
  const lesson = chatLesson;
  const locale = lesson.locale;
  const text = prompt || "";
  const scene = (lesson.presentation.scene || {}) as ChatScene;
  // A grade right after a verdict that asked for it is the learner's self-rating (rate_recall): it schedules
  // the next review and never changes mastery. UX-10: on a scene that only takes an acknowledgement, a reply
  // that is neither a grade nor « continuer » is asked again instead of lapsing the rating.
  const pending = lesson.rating;
  const grade = pending ? recallGradeOf(text, pending.grades) : null;
  if (pending && grade) {
    lesson.rating = undefined;
    const r = await lesson.mcp.call("rate_recall", { session_id: lesson.sid, scene_id: pending.sceneId, grade });
    if (r.display_markdown) stream.markdown(`${r.display_markdown}\n\n`);
    if (lesson.ended) { void lesson.mcp.close(); chatLesson = null; return; }
    stream.markdown(presentationText(lesson.presentation, locale));
    return;
  }
  if (pending && ACK_SCENES.has(String(scene.type)) && !MOVE_ON.test(text.trim().toLowerCase())) {
    stream.markdown(ratingAgainPrompt(pending.grades, locale));
    return;
  }
  let t: Json;
  try {
    t = (await lesson.mcp.call("submit_response", { session_id: lesson.sid, input: { kind: "reply", text } })).transition;
  } catch (e: any) {
    // A discussion argument typed without /discuss is a turn of that discussion, not the end of it.
    if (scene.type === "discussion" && text.trim()) { await doDiscuss(stream, text); return; }
    // The host could not read the reply: say so in the learner's language, then how this scene is answered. The
    // host's reason is addressed to an agent (English, API fields): it goes to the output channel, not the chat.
    resolveLogSink()(`@studium: reply refused: ${String(e?.message ?? e)}`);
    stream.markdown(`${phrase("chat_refused", {}, locale)}\n\n${replyHintOnly(lesson)}`);
    return;
  }
  lesson.rating = undefined;
  // The verdict's own text (I-1): the served display_markdown, or the feedback and the reference.
  const verdict = verdictForChat(t.verdict, locale);
  if (verdict) stream.markdown(`${verdict}\n\n`);
  if (t.self_rating?.requested && t.self_rating.scene_id) {
    lesson.rating = { sceneId: String(t.self_rating.scene_id), grades: Array.isArray(t.self_rating.grades) ? t.self_rating.grades : RECALL_GRADES };
  }
  remember(lesson, t.presentation);
  if (typeof t.display_markdown === "string" && t.display_markdown.trim()) {
    // The host's text: where the lesson goes (in words), the completion lists at the end, then the next scene.
    stream.markdown(t.display_markdown);
  } else {
    const nav = navigationNote(t.navigation, locale);
    if (nav) stream.markdown(`${nav}\n\n`);
    if (t.kind === "complete") stream.markdown(phrase("chat_complete", { count: t.summary?.scenesCompleted ?? "?" }, locale));
    else if (t.presentation) stream.markdown(presentationText(t.presentation, locale));
  }
  if (t.kind === "complete") {
    if (lesson.rating) { lesson.ended = true; return; }
    void lesson.mcp.close();
    chatLesson = null;
  }
}

/** How the scene on screen is answered (the last block of its served text, else the extension's own hint). */
function replyHintOnly(lesson: ChatLesson): string {
  const served = typeof lesson.presentation.display_markdown === "string" ? lesson.presentation.display_markdown.trim() : "";
  if (served) return served.split("\n\n").at(-1) ?? served;
  return formatSceneForChat((lesson.presentation.scene || {}) as ChatScene, undefined, lesson.locale).split("\n\n").at(-1) ?? "";
}

async function doHint(stream: { markdown(text: string): void }): Promise<void> {
  if (!chatLesson) { stream.markdown(phrase("chat_no_active_start")); return; }
  const h = (await chatLesson.mcp.call("request_hint", { session_id: chatLesson.sid })).hint;
  stream.markdown(h?.hint
    ? `💡 ${h.hint}${h.remaining != null ? phrase("chat_hint_remaining", { count: h.remaining }, chatLesson.locale) : ""}`
    : phrase("chat_no_hint", {}, chatLesson.locale));
}

async function doDiscuss(stream: { markdown(text: string): void }, text: string): Promise<void> {
  if (!chatLesson) { stream.markdown(phrase("chat_no_active")); return; }
  const r = await chatLesson.mcp.call("submit_turn", { session_id: chatLesson.sid, text: text || "" });
  if (r.tutor?.text) stream.markdown(phrase("chat_tutor", { text: r.tutor.text }, chatLesson.locale));
  // UX-04: the kind of reasoning in words, never the raw signal code or a decimal.
  const signal = reasoningNote(r.reasoning, chatLesson.locale);
  if (signal) stream.markdown(`\n\n${signal}`);
}
