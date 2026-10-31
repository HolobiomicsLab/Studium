// chat-format.ts — pure formatting for the @studium chat participant and the notebook (no vscode import,
// unit-testable). The host serves its own chat text (presentation / transition / verdict display_markdown) and
// the chat streams it as it is (CQ-3); these formatters are the fallback for an older server that does not.
// Turns a REDACTED scene (the PublicScene the host already stripped of answer keys) into chat markdown. Replies
// are NOT parsed here: the chat sends the learner's words as {kind: "reply", text} and the host maps them, or
// refuses them in one line (L-10, packages/lesson-session-host/src/reply-mapping.ts).
import { phrase, type Locale, type PhraseKey } from "./phrases.js";
import { FREE_TEXT_KIND } from "./scene-io.js";

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
  graded?: boolean;
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
  // CQ-6 / L-7: ✓ only when correct === true, ✗ only when false; a graded answer nobody assessed says so.
  const mark = verdict.correct === true ? "✓ " : verdict.correct === false ? "✗ " : "";
  const recorded = verdict.correct === undefined && verdict.graded === true ? phrase("chat_verdict_recorded", {}, locale) : "";
  const feedback = typeof verdict.feedback === "string" && verdict.feedback.trim() ? `${mark}${verdict.feedback}` : "";
  return [recorded, feedback, referenceForChat(verdict, locale)].filter(Boolean).join("\n\n");
}

/** The verdict's reference under its own headings. MIRRORS referenceMarkdown in
 * packages/lesson-session-host/src/chat-display.ts (the extension cannot import the host package);
 * chat-format.driver.ts pins the headings against that source. */
export function referenceForChat(verdict: ChatVerdict, locale: Locale = "fr"): string {
  const audit = verdict.reference_kind === "planted_flaws";
  const heading = audit ? "chat_reference_planted_flaws"
    : verdict.reference_kind === "flawed_claims" ? "chat_reference_flawed_claims"
    : verdict.reference_kind === "correct_choice" ? "chat_reference_correct_choice" : "chat_reference_key_points";
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

// UX-10: the words a learner may rate with — the API grade, the pane's button label and the host's gloss, in
// both languages (« good (bien) », « Je ne savais pas »). Compared without case, accents or surrounding marks.
const GRADE_WORDS: Record<string, readonly string[]> = {
  again: ["again", "a revoir", "je ne savais pas", "i didn't know", "i did not know"],
  hard: ["hard", "difficile"],
  good: ["good", "bien"],
  easy: ["easy", "facile"],
};
function plainWords(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’]/g, "'")
    .replace(/^[\s"'«»“”*_`.!?:;,()[\]-]+|[\s"'«»“”*_`.!?:;,()[\]-]+$/g, "").replace(/\s+/g, " ");
}

/** A reply that is one of the self-rating grades the transition offered (again / hard / good / easy, or their
 * French and English labels), or null: after a verdict that asks the learner to rate their recall, a bare
 * grade is that rating. */
export function recallGradeOf(reply: string, grades: readonly string[]): string | null {
  const word = plainWords(reply);
  if (!word) return null;
  return grades.find((grade) => (GRADE_WORDS[grade] ?? [grade]).includes(word)) ?? null;
}

const GRADE_LABEL: Record<string, PhraseKey> = {
  again: "pane_grade_again", hard: "pane_grade_hard", good: "pane_grade_good", easy: "pane_grade_easy",
};

/** UX-10 / L-5: the prompt asking again for a self-rating, the grades named as the pane's buttons name them, in
 * the learner's language and in the running sentence's case (« je ne savais pas / difficile / bien / facile »);
 * each name is one recallGradeOf reads back as that grade. A grade without a label keeps its API code. */
export function ratingAgainPrompt(grades: readonly string[], locale: Locale): string {
  const names = grades.map((grade) => {
    const key = GRADE_LABEL[grade];
    if (!key) return grade;
    const label = phrase(key, {}, locale);
    return /^I\b/.test(label) ? label : label.charAt(0).toLocaleLowerCase(locale) + label.slice(1);
  });
  return phrase("chat_rating_again", { grades: names.join(" / ") }, locale);
}

const NAVIGATION_PHRASE: Record<string, PhraseKey> = {
  replay: "chat_nav_replay",
  remediate_alt: "chat_nav_remediate_alt",
  remediate: "chat_nav_remediate",
};

/** UX-04 / L-6: where the lesson goes next, worded from navigation.kind alone — never the engine's reason
 * code or rule id — and empty for an ordinary advance. For an older server that serves no display text. */
export function navigationNote(navigation: { kind?: unknown; [key: string]: unknown } | null | undefined, locale: Locale = "fr"): string {
  const key = typeof navigation?.kind === "string" ? NAVIGATION_PHRASE[navigation.kind] : undefined;
  return key ? phrase(key, {}, locale) : "";
}

const REASONING_SIGNALS = new Set(["justification", "hypothesis", "question", "counterexample", "synthesis"]);

/** The kind of reasoning a discussion turn showed, in words (the pane's pane_signal_* names), never its
 * raw code or a decimal confidence; empty for a signal the pane does not name. */
export function reasoningNote(reasoning: { signal?: unknown; [key: string]: unknown } | null | undefined, locale: Locale = "fr"): string {
  const signal = typeof reasoning?.signal === "string" ? reasoning.signal : "";
  if (!REASONING_SIGNALS.has(signal)) return "";
  return phrase("chat_reasoning_signal", { signal: phrase(`pane_signal_${signal}` as PhraseKey, {}, locale) }, locale);
}

function choiceList(choices?: Array<{ id: string; text: string }>): string {
  return (choices || []).map((c) => `- **${c.id})** ${c.text}`).join("\n");
}
function deckList(deck?: Array<{ token: string; text: string }>): string {
  return (deck || []).map((d, i) => `${i + 1}. ${d.text}`).join("\n");
}
function md(s?: string): string { return s ? String(s) : ""; }
function flag(s: string): string { return `**${s}**`; }
