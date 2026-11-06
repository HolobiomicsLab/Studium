import type {
  StudiumPanelAction,
  StudiumPanelActionName,
  StudiumPanelView,
  StudiumPublicScene,
} from "../types/index.js";

/** Version 1 and version 2 (INT-STUDIUM-058) are both read; version 2 adds fields and retypes none. */
const PANEL_SCHEMAS = new Set(["studium/panel-view/1", "studium/panel-view/2"]);
const PANEL_SCHEMA_V2 = "studium/panel-view/2";
const WAITING = new Set(["read", "answer", "self_rating", "run", "nothing"]);
const VOICE_KINDS = new Set(["author", "key", "judge", "agent"]);
const HELP_KINDS = new Set(["reread", "hint", "explain", "reference"]);
const PANEL_KINDS = new Set(["scene", "done", "notice", "error"]);
const ACTIONS = new Set<StudiumPanelActionName>([
  "respond", "turn", "hint", "rateRecall", "reviewNow", "restartLesson", "end", "pickCourse",
  "ask", "setAttention", "setLanguage", "replan",
]);
const FREE_TEXT_KINDS: Record<string, string> = {
  ai_critique: "critique",
  spot_the_flaw: "flaw_report",
  explain_back: "explanation",
  comparison: "comparison",
  summary_audit: "summary_audit",
  prompt_practice: "prompt_submission",
  communication_sim: "communication",
};

type McpResult = { content?: unknown; isError?: unknown; structuredContent?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === "string");
}

function isNamedConcept(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isScene(value: unknown): value is StudiumPublicScene {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") return false;
  if (![value.title, value.question, value.prompt, value.markdown].every(isOptionalString)) return false;
  if (value.choices !== undefined && (!Array.isArray(value.choices) || !value.choices.every(isChoice))) return false;
  return value.deck === undefined || (Array.isArray(value.deck) && value.deck.every(isDeckItem));
}

function isChoice(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.text === "string";
}

function isDeckItem(value: unknown): boolean {
  return isRecord(value) && typeof value.token === "string" && typeof value.text === "string";
}

function isAsset(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  return [value.title, value.path, value.payload, value.dataUri]
    .every(isOptionalString);
}

function hasValidProgress(value: unknown): boolean {
  return isRecord(value)
    && typeof value.index === "number" && Number.isFinite(value.index)
    && typeof value.total === "number" && Number.isFinite(value.total);
}

function hasValidActions(value: unknown): boolean {
  return Array.isArray(value) && value.every(action => typeof action === "string" && ACTIONS.has(action as StudiumPanelActionName));
}

function hasValidFeedback(panel: Record<string, unknown>): boolean {
  if (!isVerdict(panel.verdict) || !isHint(panel.hint) || !isCompletion(panel.completion)) return false;
  if (!isOptionalString(panel.message) || !isOptionalString(panel.pending)) return false;
  if (!isSelfRating(panel.self_rating) || !isAuthoring(panel.authoring)) return false;
  if (!isSources(panel.sources) || !isTurnResult(panel.turn_result)) return false;
  return true;
}

function isVerdict(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value) || typeof value.scene_id !== "string" || typeof value.graded !== "boolean") return false;
  if (![value.display_markdown, value.feedback, value.model_answer].every(isOptionalString)) return false;
  if (value.key_points !== undefined && !isStringArray(value.key_points)) return false;
  return isSources(value.sources);
}

function isHint(value: unknown): boolean {
  return value === undefined || (isRecord(value) && isOptionalNullableString(value.hint));
}

function isCompletion(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.consolidated) || !value.consolidated.every(isNamedConcept)) return false;
  if (!Array.isArray(value.practised) || !value.practised.every(item => isNamedConcept(item) && isRecord(item) && typeof item.answers === "number")) return false;
  return Array.isArray(value.not_measured) && value.not_measured.every(isNamedConcept);
}

function isSelfRating(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value) || value.requested !== true || !isOptionalString(value.scene_id)) return false;
  return Array.isArray(value.grades) && value.grades.every(grade => ["again", "hard", "good", "easy"].includes(String(grade)));
}

function isAuthoring(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value) && isOptionalNullableString(value.notice));
}

function isSources(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(source => (
    isRecord(source)
    && typeof source.title === "string"
    && [source.url, source.quote, source.license].every(isOptionalString)
  )));
}

function isTurnResult(value: unknown): boolean {
  if (value === undefined) return true;
  return isRecord(value) && (value.tutor === null || isRecord(value.tutor));
}

function isCalibration(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => (
    isRecord(item)
    && typeof item.concept_id === "string"
    && ["bien", "sur", "sous"].includes(String(item.band))
    && typeof item.message === "string"
  ));
}

function isMastery(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(score => score === null || (typeof score === "number" && Number.isFinite(score)));
}

function isVoice(value: unknown): boolean {
  if (!isRecord(value) || !VOICE_KINDS.has(String(value.kind))) return false;
  return value.kind !== "author" || ((value.name === null || typeof value.name === "string") && typeof value.reviewed === "boolean");
}

/** What version 2 adds: where the learner is, the same in one line, who speaks, which help is open. */
function hasValidOrientation(value: Record<string, unknown>): boolean {
  const { orientation, voices, help } = value;
  if (!isRecord(orientation) || !hasValidProgress(orientation.step) || !WAITING.has(String(orientation.waiting))) return false;
  if (typeof orientation.reviews_due !== "number" || typeof value.status_line !== "string") return false;
  if (!isRecord(voices) || !isVoice(voices.scene) || (voices.verdict !== undefined && !isVoice(voices.verdict))) return false;
  return isRecord(help) && Array.isArray(help.rungs) && help.rungs.every(rung => (
    isRecord(rung) && HELP_KINDS.has(String(rung.kind)) && typeof rung.available === "boolean"
    && [rung.cost, rung.why_not].every(isOptionalString)
  ));
}

/** Validate every PanelView field the mod reads before accepting an MCP result. */
export function isPanelView(value: unknown): value is StudiumPanelView {
  if (!isRecord(value) || !PANEL_SCHEMAS.has(String(value.schema)) || !PANEL_KINDS.has(String(value.kind))) return false;
  if (value.schema === PANEL_SCHEMA_V2 && !hasValidOrientation(value)) return false;
  if (![value.session_id, value.learner_id, value.bundle_ref, value.lesson_title].every(item => typeof item === "string")) return false;
  if ((value.locale !== "fr" && value.locale !== "en") || !isStringRecord(value.strings)) return false;
  if (!hasValidProgress(value.progress) || !Array.isArray(value.scene_assets) || !value.scene_assets.every(isAsset)) return false;
  if (!(["balanced", "visual", "textual"] as unknown[]).includes(value.modalityPreference)) return false;
  if ((value.kind === "scene" && !isScene(value.scene)) || (value.scene !== undefined && !isScene(value.scene))) return false;
  if (!Array.isArray(value.reviewDue) || !value.reviewDue.every(isNamedConcept)) return false;
  if (!isCalibration(value.calibration) || !isMastery(value.mastery)) return false;
  return hasValidActions(value.actions) && hasValidFeedback(value);
}

function errorText(result: McpResult): string {
  if (!Array.isArray(result.content)) return "The Studium server returned an error.";
  const text = result.content.find(block => isRecord(block) && typeof block.text === "string");
  return isRecord(text) && typeof text.text === "string" ? text.text : "The Studium server returned an error.";
}

/** Extract and validate the public panel from a direct Claude Code MCP call. */
export function panelFromMcpResult(value: unknown): StudiumPanelView {
  if (!isRecord(value)) throw new Error("The Studium server returned no MCP result.");
  if (value.isError === true) throw new Error(errorText(value));
  const structured = value.structuredContent;
  const panel = isRecord(structured) ? structured.panel : undefined;
  if (!isPanelView(panel)) throw new Error("The Studium server returned an incompatible lesson view.");
  return panel;
}

/** Map `/studium answer …` to the response kind required by the active scene. */
export function answerAction(view: StudiumPanelView, raw: string): StudiumPanelAction {
  const scene = view.scene;
  const answer = raw.trim();
  if (!scene || !answer) throw new Error("Give an answer after `/studium answer`.");
  if (scene.type === "quiz") return quizAction(scene, answer);
  if (scene.type === "meta_checkpoint") return confidenceAction(answer);
  if (scene.type === "discussion") return { type: "turn", text: answer };
  const kind = FREE_TEXT_KINDS[scene.type];
  if (kind) return { type: "respond", input: { kind, text: answer } };
  if (answer.toLowerCase() === "next") return { type: "respond", input: { kind: "ack" } };
  throw new Error("This scene uses its pane buttons; use `/studium answer next` to continue.");
}

function quizAction(scene: StudiumPublicScene, answer: string): StudiumPanelAction {
  const choices = scene.choices ?? [];
  const index = /^[a-z]$/i.test(answer) ? answer.toLowerCase().charCodeAt(0) - 97 : -1;
  const choice = choices.find(item => item.id.toLowerCase() === answer.toLowerCase()) ?? choices[index];
  if (!choice) throw new Error("Choose one of the answer ids shown in the pane.");
  return { type: "respond", input: { kind: "quiz_choice", choiceId: choice.id } };
}

function confidenceAction(answer: string): StudiumPanelAction {
  const value = Number(answer);
  if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error("Choose a confidence value from 0 to 4.");
  return { type: "respond", input: { kind: "confidence", value } };
}

/** The scene prose rendered through Claude Code's native Markdown element. */
export function sceneMarkdown(view: StudiumPanelView): string {
  const scene = view.scene;
  if (!scene) return view.message ?? "";
  const extra = [scene.markdown, scene.question, scene.prompt]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return extra.join("\n\n");
}

/** Earned feedback, model answer and hint, kept separate from the next scene. */
export function feedbackMarkdown(view: StudiumPanelView): string {
  const verdict = view.verdict;
  const lines = [verdict?.display_markdown, verdict?.feedback];
  const keyPoints = view.strings.pane_key_points ?? (view.locale === "fr" ? "Points clés" : "Key points");
  const modelAnswer = view.strings.pane_model_answer ?? (view.locale === "fr" ? "Réponse modèle" : "Model answer");
  if (verdict?.key_points?.length) lines.push(`**${keyPoints}**\n${verdict.key_points.map(item => `- ${item}`).join("\n")}`);
  if (verdict?.model_answer) lines.push(`**${modelAnswer}**\n${verdict.model_answer}`);
  const hintHeading = view.strings.pane_hint_heading ?? (view.locale === "fr" ? "Indice :" : "Hint:");
  if (view.hint?.hint) lines.push(`**${hintHeading}** ${view.hint.hint}`);
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n\n");
}

/** Human-readable completion summary for the native Pane. */
export function completionMarkdown(view: StudiumPanelView): string {
  const completion = view.completion;
  if (!completion) return view.message ?? "";
  const names = (items: Array<{ label: string }>) => items.map(item => item.label).join(", ") || "—";
  const labels = view.locale === "fr"
    ? { consolidated: "Notions consolidées", practised: "Notions pratiquées", notMeasured: "Pas encore mesuré" }
    : { consolidated: "Concepts consolidated", practised: "Concepts practised", notMeasured: "Not measured yet" };
  return [
    `**${view.strings.pane_completion_consolidated ?? labels.consolidated}:** ${names(completion.consolidated)}`,
    `**${view.strings.pane_completion_practised ?? labels.practised}:** ${names(completion.practised)}`,
    `**${view.strings.pane_completion_not_measured ?? labels.notMeasured}:** ${names(completion.not_measured)}`,
  ].join("\n\n");
}

/** Preserve each source's provenance fields in the compact native rendering. */
export function sourcesMarkdown(view: StudiumPanelView): string {
  const sources = [...(view.sources ?? []), ...(view.verdict?.sources ?? [])];
  return sources.map(source => {
    const title = source.url ? `[${source.title}](${source.url})` : source.title;
    const quote = source.quote ? ` — “${source.quote}”` : "";
    const license = source.license ? ` _(${source.license})_` : "";
    return `- ${title}${quote}${license}`;
  }).join("\n");
}

/** Return base64 PNG bytes when the native terminal Image can draw the asset. */
export function pngPayload(dataUri: string | undefined): string | undefined {
  const match = dataUri?.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  return match?.[1];
}

/** Make an action failure visible while retaining the session identity and recovery actions. */
export function errorView(view: StudiumPanelView, error: unknown): StudiumPanelView {
  return {
    ...view,
    kind: "error",
    pending: undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}
