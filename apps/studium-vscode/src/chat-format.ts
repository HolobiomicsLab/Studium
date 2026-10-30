// chat-format.ts — pure formatting for the @studium chat participant (no vscode import, unit-testable).
// Turns a REDACTED scene (the PublicScene the host already stripped of answer keys) into chat markdown, and
// maps a learner's chat reply back to the ResponseInput the graders expect. Chat is text-only, so rich
// artifacts (KaTeX / 3D / the interactive verdict deck) still need the webview — but the verdict deck works
// here too, via numbers.
import { phrase, type Locale } from "./phrases.js";

/** A redacted scene as it arrives over MCP (a plain object; only learner-facing fields are present). */
export interface ChatScene {
  type?: string;
  title?: string;
  question?: string;
  pre_question?: string;
  scale_labels?: string[];
  choices?: Array<{ id: string; text: string }>;
  markdown?: string;
  prompt?: string;
  flawed_content?: string;
  deck?: Array<{ token: string; text: string }>;
  steps?: Array<{ instruction: string }>;
  topic?: string;
  seed_claim?: string;
  artifact_a?: string;
  artifact_b?: string;
  source_content?: string;
  ai_summary?: string;
  task?: string;
  scenario?: string;
  starter_prompt?: string;
}

export interface ChatInput { kind: string; [k: string]: unknown }

// free-text scene type → the ResponseInput kind its grader requires (mirrors artifact-pane.js FREE_TEXT).
const FREE_TEXT_KIND: Record<string, string> = {
  ai_critique: "critique",
  spot_the_flaw: "flaw_report",
  explain_back: "explanation",
  comparison: "comparison",
  summary_audit: "summary_audit",
  prompt_practice: "prompt_submission",
  communication_sim: "communication",
};

/** Render a scene as chat markdown, including how the learner should reply. Only redacted fields are read. */
export function formatSceneForChat(
  scene: ChatScene,
  progress?: { index: number; total: number },
  locale: Locale = "fr",
): string {
  const head = `### ${scene.title || scene.type || "Scene"}${progress ? `  _(${progress.index}/${progress.total})_` : ""}`;
  return [head, sceneBody(scene, locale), replyHint(scene, locale)].filter(Boolean).join("\n\n");
}

/** The scene's learner-facing content (no answer keys — those are stripped server-side). */
function sceneBody(scene: ChatScene, locale: Locale): string {
  const t = scene.type;
  if (t === "quiz") return [md(scene.question), choiceList(scene.choices)].filter(Boolean).join("\n\n");
  if (t === "meta_checkpoint") return md(scene.pre_question);
  if (t === "spot_the_flaw") return [flag(phrase("chat_audit_reading", {}, locale)), md(scene.flawed_content), deckList(scene.deck)].filter(Boolean).join("\n\n");
  if (t === "comparison") return [md(scene.prompt), scene.artifact_a && `**A**\n\n${scene.artifact_a}`, scene.artifact_b && `**B**\n\n${scene.artifact_b}`].filter(Boolean).join("\n\n");
  if (t === "summary_audit") return [scene.source_content && `${phrase("chat_source", {}, locale)}\n\n${scene.source_content}`, scene.ai_summary && `${phrase("chat_ai_summary", {}, locale)}\n\n${scene.ai_summary}`].filter(Boolean).join("\n\n");
  if (t === "communication_sim") return [scene.scenario && `${phrase("chat_situation", {}, locale)}\n\n${scene.scenario}`, md(scene.prompt)].filter(Boolean).join("\n\n");
  if (t === "prompt_practice") return [scene.task && `${phrase("chat_task", {}, locale)}\n\n${scene.task}`, scene.starter_prompt && `\`\`\`\n${scene.starter_prompt}\n\`\`\``].filter(Boolean).join("\n\n");
  if (t === "reproduction") return [flag(phrase("chat_protocol", {}, locale)), (scene.steps || []).map((s, i) => `${i + 1}. ${s.instruction}`).join("\n")].filter(Boolean).join("\n\n");
  if (t === "discussion") return [scene.topic && phrase("chat_discussion", { topic: scene.topic }, locale), md(scene.seed_claim)].filter(Boolean).join("\n\n");
  return md(scene.prompt || scene.markdown); // intro / concept / explain_back
}

/** Tell the learner exactly how to respond in chat for this scene type. */
function replyHint(scene: ChatScene, locale: Locale): string {
  const t = scene.type;
  if (t === "quiz") return phrase("chat_reply_quiz", {}, locale);
  if (t === "meta_checkpoint") return phrase("chat_reply_meta", {}, locale);
  if (t === "spot_the_flaw" && scene.deck?.length) return phrase("chat_reply_deck", {}, locale);
  if (t === "reproduction") return phrase("chat_reply_reproduction", {}, locale);
  if (t === "discussion") return phrase("chat_reply_discussion", {}, locale);
  if (t && FREE_TEXT_KIND[t]) return phrase("chat_reply_text", {}, locale);
  return phrase("chat_reply_continue", {}, locale);
}

/** A verdict as it arrives over MCP: the engine's Verdict (packages/lesson-session types.ts) plus the
 * host's `display_markdown`. Since lead decision I-1 the reference — key points, planted flaws or a
 * critique's flawed claims, and the model answer — is data on the verdict, and an offline key-point
 * verdict may carry no feedback text at all. */
export interface ChatVerdict {
  correct?: boolean;
  feedback?: string;
  key_points?: string[];
  key_points_missing?: string[];
  model_answer?: string;
  reference_kind?: string;
  display_markdown?: string;
  [k: string]: unknown;
}

/** What the learner earned by answering, as chat markdown: the served `verdict.display_markdown` as it is
 * (it already holds the verdict, the feedback, the reference, the cited passages and any self-rating
 * request); without it, the feedback with its mark, then the reference built from the fields. */
export function verdictForChat(verdict: ChatVerdict | undefined, locale: Locale = "fr"): string {
  if (!verdict) return "";
  if (typeof verdict.display_markdown === "string" && verdict.display_markdown.trim()) return verdict.display_markdown;
  const feedback = typeof verdict.feedback === "string" && verdict.feedback.trim()
    ? `${verdict.correct === false ? "✗" : "✓"} ${verdict.feedback}` : "";
  return [feedback, referenceForChat(verdict, locale)].filter(Boolean).join("\n\n");
}

/** The verdict's reference under its own headings. MIRRORS referenceMarkdown in
 * packages/lesson-session-host/src/chat-display.ts (the extension cannot import the host package);
 * chat-format.driver.ts pins the headings against that source. */
export function referenceForChat(verdict: ChatVerdict, locale: Locale = "fr"): string {
  const audit = verdict.reference_kind === "planted_flaws";
  const heading = audit ? "chat_reference_planted_flaws"
    : verdict.reference_kind === "flawed_claims" ? "chat_reference_flawed_claims" : "chat_reference_key_points";
  const points = (Array.isArray(verdict.key_points) ? verdict.key_points : [])
    .filter((point): point is string => typeof point === "string" && point.trim() !== "");
  const missing = new Set(Array.isArray(verdict.key_points_missing) ? verdict.key_points_missing : []);
  const blocks: string[] = [];
  if (points.length) {
    blocks.push(phrase(heading, {}, locale), points
      .map((point) => `- ${point}${missing.has(point) ? ` ${phrase("chat_key_point_missing", {}, locale)}` : ""}`).join("\n"));
  }
  if (typeof verdict.model_answer === "string" && verdict.model_answer.trim()) {
    blocks.push(phrase(audit ? "chat_model_correction" : "chat_model_answer", {}, locale), verdict.model_answer);
  }
  return blocks.join("\n\n");
}

/** A reply that is one of the self-rating grades the transition offered (again / hard / good / easy), or
 * null: after a verdict that asks the learner to rate their recall, a bare grade is that rating. */
export function recallGradeOf(reply: string, grades: readonly string[]): string | null {
  const word = reply.trim().toLowerCase();
  return grades.includes(word) ? word : null;
}

/** Map a learner's chat reply to the ResponseInput its grader expects, or null if it can't be interpreted. */
export function replyToInput(scene: ChatScene, reply: string): ChatInput | null {
  const t = scene.type;
  const text = reply.trim();
  if (t === "quiz") {
    const choice = (scene.choices || []).find((c) => new RegExp(`^${escapeRe(c.id)}\\b`, "i").test(text));
    return choice ? { kind: "quiz_choice", choiceId: choice.id } : null;
  }
  if (t === "meta_checkpoint") {
    const n = text.match(/[0-4]/);
    return n ? { kind: "confidence", value: Number(n[0]) } : null;
  }
  if (t === "spot_the_flaw" && scene.deck?.length) return deckVerdicts(scene.deck, text);
  if (t && FREE_TEXT_KIND[t]) return text ? { kind: FREE_TEXT_KIND[t]!, text } : null;
  return { kind: "ack" }; // intro / concept / reproduction ack
}

/** Parse a "1,3" style reply into per-token flag/sound verdicts over the deck (numbers are 1-based). */
function deckVerdicts(deck: Array<{ token: string; text: string }>, reply: string): ChatInput {
  const flagged = new Set((reply.match(/\d+/g) || []).map((n) => Number(n) - 1));
  return { kind: "flaw_verdicts", verdicts: deck.map((d, i) => ({ token: d.token, flagged: flagged.has(i) })) };
}

function choiceList(choices?: Array<{ id: string; text: string }>): string {
  return (choices || []).map((c) => `- **${c.id})** ${c.text}`).join("\n");
}
function deckList(deck?: Array<{ token: string; text: string }>): string {
  return (deck || []).map((d, i) => `${i + 1}. ${d.text}`).join("\n");
}
function md(s?: string): string { return s ? String(s) : ""; }
function flag(s: string): string { return `**${s}**`; }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
