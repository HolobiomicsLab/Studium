// chat-format.ts — pure formatting for the @studium chat participant (no vscode import, unit-testable).
// Turns a REDACTED scene (the PublicScene the host already stripped of answer keys) into chat markdown, and
// maps a learner's chat reply back to the ResponseInput the graders expect. Chat is text-only, so rich
// artifacts (KaTeX / 3D / the interactive verdict deck) still need the webview — but the verdict deck works
// here too, via numbers.

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
export function formatSceneForChat(scene: ChatScene, progress?: { index: number; total: number }): string {
  const head = `### ${scene.title || scene.type || "Scene"}${progress ? `  _(${progress.index}/${progress.total})_` : ""}`;
  return [head, sceneBody(scene), replyHint(scene)].filter(Boolean).join("\n\n");
}

/** The scene's learner-facing content (no answer keys — those are stripped server-side). */
function sceneBody(scene: ChatScene): string {
  const t = scene.type;
  if (t === "quiz") return [md(scene.question), choiceList(scene.choices)].filter(Boolean).join("\n\n");
  if (t === "meta_checkpoint") return md(scene.pre_question);
  if (t === "spot_the_flaw") return [flag("⚠️ Audite cette lecture IA — juge chaque affirmation"), md(scene.flawed_content), deckList(scene.deck)].filter(Boolean).join("\n\n");
  if (t === "comparison") return [md(scene.prompt), scene.artifact_a && `**A**\n\n${scene.artifact_a}`, scene.artifact_b && `**B**\n\n${scene.artifact_b}`].filter(Boolean).join("\n\n");
  if (t === "summary_audit") return [scene.source_content && `**Source**\n\n${scene.source_content}`, scene.ai_summary && `**Résumé IA à auditer**\n\n${scene.ai_summary}`].filter(Boolean).join("\n\n");
  if (t === "communication_sim") return [scene.scenario && `**Situation**\n\n${scene.scenario}`, md(scene.prompt)].filter(Boolean).join("\n\n");
  if (t === "prompt_practice") return [scene.task && `**Tâche**\n\n${scene.task}`, scene.starter_prompt && `\`\`\`\n${scene.starter_prompt}\n\`\`\``].filter(Boolean).join("\n\n");
  if (t === "reproduction") return [flag("Protocole"), (scene.steps || []).map((s, i) => `${i + 1}. ${s.instruction}`).join("\n")].filter(Boolean).join("\n\n");
  if (t === "discussion") return [scene.topic && `**Discussion : ${scene.topic}**`, md(scene.seed_claim)].filter(Boolean).join("\n\n");
  return md(scene.prompt || scene.markdown); // intro / concept / explain_back
}

/** Tell the learner exactly how to respond in chat for this scene type. */
function replyHint(scene: ChatScene): string {
  const t = scene.type;
  if (t === "quiz") return "_Réponds avec la lettre de ton choix (ex: `a`)._";
  if (t === "meta_checkpoint") return "_Réponds avec un chiffre de 0 à 4._";
  if (t === "spot_the_flaw" && scene.deck?.length) return "_Réponds avec les numéros des affirmations que tu juges erronées (ex: `1,3`) — laisse vide si toutes te semblent correctes._";
  if (t === "reproduction") return "_Lance « Studium: Run reproduction », puis reviens ici._";
  if (t === "discussion") return "_Argumente avec `/discuss <ton argument>`, ou `/answer` pour terminer._";
  if (t && FREE_TEXT_KIND[t]) return "_Réponds avec ton texte._";
  return "_Réponds pour continuer._";
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
