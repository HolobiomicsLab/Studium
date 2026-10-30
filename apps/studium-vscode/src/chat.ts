// chat.ts — the @studium chat participant. Puts the judge-the-AI loop in the editor's OWN Copilot/Claude
// chat panel: the learner types `@studium` to run a lesson turn-by-turn, or `/hint` and `/discuss`. It
// reuses the exact lesson-mcp plumbing (connectLessonMcp) and streams the SERVER-authored, redacted scene +
// tutor move — no client LLM, so the answer key stays server-side (publicScene). Chat is text-only, so rich
// artifacts (3D / KaTeX) still need the webview; the verdict deck works here via numbers.
import * as vscode from "vscode";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { connectLessonMcp, lessonMcpEnv, resolveServerLaunch, type LessonMcp } from "./mcp-connect.js";
import { defaultBundlesRoot } from "./data-paths.js";
import { formatSceneForChat, replyToInput, verdictForChat, recallGradeOf, type ChatScene } from "./chat-format.js";
import { phrase, type Locale } from "./phrases.js";

// One active chat lesson at a time (mirrors the single-active-lesson model of the panel). `rating` is the
// self-rating the last verdict asked for (C4): a bare grade as the next reply is that rating. `ended`
// keeps a completed lesson open only for that rating.
interface ChatLesson {
  mcp: LessonMcp; sid: string; scene: ChatScene; locale: Locale;
  rating?: { sceneId: string; grades: readonly string[] }; ended?: boolean;
}
let chatLesson: ChatLesson | null = null;
const RECALL_GRADES = ["again", "hard", "good", "easy"] as const;

export function registerStudiumChat(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant("studium.tutor",
    async (request, _ctx, stream, _token) => { await handle(context, request, stream); });
  participant.iconPath = vscode.Uri.file(join(context.extensionPath, "media", "studium-icon.svg"));
  // Reap an abandoned chat lesson's lesson-mcp subprocess when the extension deactivates (it is not tied
  // to the participant's own lifetime, so it would otherwise linger until the next /start).
  context.subscriptions.push(participant, { dispose: () => { chatLesson?.mcp.close(); chatLesson = null; } });
}

async function handle(context: vscode.ExtensionContext, request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<void> {
  try {
    const cmd = request.command;
    if (cmd === "hint") return await doHint(stream);
    if (cmd === "discuss") return await doDiscuss(stream, request.prompt);
    if (chatLesson?.ended && !(chatLesson.rating && recallGradeOf(request.prompt || "", chatLesson.rating.grades))) {
      chatLesson.mcp.close();
      chatLesson = null;
    }
    if (cmd === "start" || !chatLesson) return await doStart(context, stream);
    await doAnswer(stream, request.prompt);
  } catch (e: any) {
    stream.markdown(`\n\n⚠ Studium : ${e.message}`);
  }
}

/** Read the lesson-mcp launch config from the studium.* settings (defaults run zero-config from the clone). */
function launch(context: vscode.ExtensionContext) {
  const get = <T>(key: string, fb: T): T => {
    const v = vscode.workspace.getConfiguration("studium").get<T>(key);
    return v === undefined || v === "" ? fb : v;
  };
  const repoRoot = get<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  const bundlesRoot = get<string>("bundlesRoot", defaultBundlesRoot({ repoRoot, exists: existsSync, env: process.env, homedir: homedir() }));
  // Learner state goes to VS Code's own storage whatever the telemetry setting says; consent only governs sending (ENG-03).
  const storageDir = context.globalStorageUri.fsPath;
  try { mkdirSync(storageDir, { recursive: true }); } catch { /* the server reports an unwritable dir itself */ }
  const env = lessonMcpEnv({
    baseEnv: process.env, bundlesRoot, storageDir, telemetryConsent: get<boolean>("telemetryConsent", false),
  });
  return {
    serverLaunch: resolveServerLaunch(context.extensionPath, repoRoot),
    env,
    bundleRef: get<string>("bundleRef", "atomistique-l1/lesson.json"),
    learnerId: get<string>("learnerId", "vscode-learner"),
  };
}

async function doStart(context: vscode.ExtensionContext, stream: vscode.ChatResponseStream): Promise<void> {
  if (chatLesson) { chatLesson.mcp.close(); chatLesson = null; }
  const { serverLaunch, env, bundleRef, learnerId } = launch(context);
  const mcp = await connectLessonMcp({ launch: serverLaunch, env });
  const started = await mcp.call("start_lesson_session", { bundle_ref: bundleRef, learner_id: learnerId });
  const locale = started.presentation?.locale === "en" ? "en" : "fr";
  chatLesson = { mcp, sid: started.session_id, scene: {}, locale };
  stream.markdown(`${phrase("chat_started", { bundle: bundleRef }, locale)}\n\n`);
  present(stream, started.presentation);
}

/** Store the redacted scene (to interpret the next reply) and stream it as chat markdown. */
function present(stream: vscode.ChatResponseStream, presentation: any): void {
  if (!chatLesson) return;
  if (presentation.locale === "en" || presentation.locale === "fr") chatLesson.locale = presentation.locale;
  chatLesson.scene = (presentation.scene || {}) as ChatScene;
  stream.markdown(formatSceneForChat(
    chatLesson.scene,
    { index: (presentation.index ?? 0) + 1, total: presentation.total },
    chatLesson.locale,
  ));
}

async function doAnswer(stream: vscode.ChatResponseStream, prompt: string): Promise<void> {
  if (!chatLesson) return;
  const lesson = chatLesson;
  const locale = lesson.locale;
  // A bare grade right after a verdict that asked for it is the learner's self-rating (rate_recall): it
  // schedules the next review and never changes mastery. Any other reply is an answer; the request lapses.
  const pending = lesson.rating;
  lesson.rating = undefined;
  const grade = pending ? recallGradeOf(prompt || "", pending.grades) : null;
  if (pending && grade) {
    const r = await lesson.mcp.call("rate_recall", { session_id: lesson.sid, scene_id: pending.sceneId, grade });
    if (r.display_markdown) stream.markdown(`${r.display_markdown}\n\n`);
    if (lesson.ended) { lesson.mcp.close(); chatLesson = null; return; }
    stream.markdown(formatSceneForChat(lesson.scene, undefined, locale));
    return;
  }
  const input = replyToInput(lesson.scene, prompt || "");
  if (!input) { stream.markdown(`${phrase("chat_unrecognized", {}, locale)}\n\n` + formatSceneForChat(lesson.scene, undefined, locale)); return; }
  const t = (await lesson.mcp.call("submit_response", { session_id: lesson.sid, input })).transition;
  // The verdict's own text (I-1): the served display_markdown, or the feedback and the reference.
  const verdict = verdictForChat(t.verdict, locale);
  if (verdict) stream.markdown(`${verdict}\n\n`);
  if (t.self_rating?.requested && t.self_rating.scene_id) {
    lesson.rating = { sceneId: String(t.self_rating.scene_id), grades: Array.isArray(t.self_rating.grades) ? t.self_rating.grades : RECALL_GRADES };
  }
  if (t.kind === "complete") {
    stream.markdown(phrase("chat_complete", { count: t.summary?.scenesCompleted ?? "?" }, locale));
    if (lesson.rating) { lesson.ended = true; return; }
    lesson.mcp.close();
    chatLesson = null;
    return;
  }
  if (t.kind === "replay" || t.kind === "remediate_alt" || t.kind === "remediate") {
    stream.markdown(`${phrase("chat_review", { reason: t.reason || "" }, locale)}\n\n`);
  }
  present(stream, t.presentation);
}

async function doHint(stream: vscode.ChatResponseStream): Promise<void> {
  if (!chatLesson) { stream.markdown(phrase("chat_no_active_start")); return; }
  const h = (await chatLesson.mcp.call("request_hint", { session_id: chatLesson.sid })).hint;
  stream.markdown(h?.hint
    ? `💡 ${h.hint}${h.remaining != null ? phrase("chat_hint_remaining", { count: h.remaining }, chatLesson.locale) : ""}`
    : phrase("chat_no_hint", {}, chatLesson.locale));
}

async function doDiscuss(stream: vscode.ChatResponseStream, text: string): Promise<void> {
  if (!chatLesson) { stream.markdown(phrase("chat_no_active")); return; }
  const r = await chatLesson.mcp.call("submit_turn", { session_id: chatLesson.sid, text: text || "" });
  if (r.tutor?.text) stream.markdown(phrase("chat_tutor", { text: r.tutor.text }, chatLesson.locale));
  if (r.reasoning) stream.markdown(`\n\n${phrase("chat_reasoning_signal", {
    signal: r.reasoning.signal,
    confidence: r.reasoning.confidence != null ? ` (${r.reasoning.confidence.toFixed(2)})` : "",
  }, chatLesson.locale)}`);
}
