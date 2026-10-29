// chat.ts — the @studium chat participant. Puts the judge-the-AI loop in the editor's OWN Copilot/Claude
// chat panel: the learner types `@studium` to run a lesson turn-by-turn, or `/hint` and `/discuss`. It
// reuses the exact lesson-mcp plumbing (connectLessonMcp) and streams the SERVER-authored, redacted scene +
// tutor move — no client LLM, so the answer key stays server-side (publicScene). Chat is text-only, so rich
// artifacts (3D / KaTeX) still need the webview; the verdict deck works here via numbers.
import * as vscode from "vscode";
import { resolve, join } from "node:path";
import { connectLessonMcp, resolveServerLaunch, type LessonMcp } from "./mcp-connect.js";
import { formatSceneForChat, replyToInput, type ChatScene } from "./chat-format.js";
import { phrase, type Locale } from "./phrases.js";

// One active chat lesson at a time (mirrors the single-active-lesson model of the panel).
let chatLesson: { mcp: LessonMcp; sid: string; scene: ChatScene; locale: Locale } | null = null;

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
  const bundlesRoot = get<string>("bundlesRoot", join(repoRoot, "fixtures"));
  const env: Record<string, string> = { ...process.env as any, BUNDLES_ROOT: bundlesRoot };
  if (get<boolean>("telemetryConsent", false)) { env["STUDIUM_DATA_DIR"] = join(bundlesRoot, "data"); env["STUDIUM_TELEMETRY_CONSENT"] = "granted"; }
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
  const locale = chatLesson.locale;
  const input = replyToInput(chatLesson.scene, prompt || "");
  if (!input) { stream.markdown(`${phrase("chat_unrecognized", {}, locale)}\n\n` + formatSceneForChat(chatLesson.scene, undefined, locale)); return; }
  const t = (await chatLesson.mcp.call("submit_response", { session_id: chatLesson.sid, input })).transition;
  if (t.kind === "complete") {
    stream.markdown(phrase("chat_complete", { count: t.summary?.scenesCompleted ?? "?" }, locale));
    chatLesson.mcp.close();
    chatLesson = null;
    return;
  }
  if (t.verdict?.feedback) stream.markdown(`${t.verdict.correct === false ? "✗" : "✓"} ${t.verdict.feedback}\n\n`);
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
