import type {
  StudiumHelpRung,
  StudiumMapConcept,
  StudiumMapEvidence,
  StudiumPanelAction,
  StudiumPrompt,
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
  // The concept map (INT-STUDIUM-058 § 2.7). This pane does not draw it yet: a view that offers it,
  // or carries it, is still a view it shows.
  "openMap", "closeMap", "contest", "prompt",
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

const MAP_STATES = new Set(["acquired", "to_review", "current", "seen", "upcoming"]);
const MAP_ASSESSORS = new Set(["key", "judge", "self", "none"]);
const MAP_RESULTS = new Set(["right", "wrong", "rated", "recorded"]);
const MAP_OUTCOMES = new Set(["confirmed", "refuted", "partial"]);

function isMapEvidence(value: unknown): boolean {
  return isRecord(value) && typeof value.scene_id === "string"
    && (value.day === null || typeof value.day === "string")
    && MAP_ASSESSORS.has(String(value.assessed_by)) && MAP_RESULTS.has(String(value.result))
    && (value.hints === null || typeof value.hints === "number");
}

function isMapContest(value: unknown): boolean {
  return isRecord(value) && typeof value.allowed === "boolean" && (value.claim === "known" || value.claim === "unsure")
    && typeof value.questions === "number"
    && (value.check_pending === undefined || typeof value.check_pending === "boolean")
    && (value.outcome === undefined || MAP_OUTCOMES.has(String(value.outcome)));
}

function isMapConcept(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && MAP_STATES.has(String(value.state))
    && typeof value.establishes === "string" && typeof value.does_not_establish === "string"
    && Array.isArray(value.evidence) && value.evidence.every(isMapEvidence)
    && (value.contest === undefined || isMapContest(value.contest));
}

/** Prompts are optional; each one shown is read whole: its reason, and the label and action of each answer. */
function hasValidPrompts(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.every(prompt => (
    isRecord(prompt) && typeof prompt.id === "string" && typeof prompt.kind === "string" && typeof prompt.reason === "string"
    && Array.isArray(prompt.actions) && prompt.actions.every(answer => (
      isRecord(answer) && typeof answer.label === "string" && isRecord(answer.action) && typeof answer.action.type === "string"
    ))
  ));
}

/** The map is optional; one that is sent is read whole, so it is checked whole. */
function hasValidMap(value: unknown): boolean {
  if (value === undefined) return true;
  return isRecord(value) && Array.isArray(value.concepts) && value.concepts.every(isMapConcept)
    && Array.isArray(value.edges) && value.edges.every(edge => isRecord(edge) && typeof edge.from === "string" && typeof edge.to === "string");
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
  if (value.attention !== undefined && !ATTENTION_LEVELS.includes(value.attention as Attention)) return false;
  return hasValidActions(value.actions) && hasValidFeedback(value) && hasValidMap(value.map) && hasValidPrompts(value.prompts);
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

function phraseOf(view: StudiumPanelView, key: string, fr: string, en: string): string {
  return view.strings[key] ?? (view.locale === "fr" ? fr : en);
}

/** The step of the lesson, for a version-1 view. */
export function progressText(view: StudiumPanelView): string {
  return phraseOf(view, "pane_progress", "Étape {position} sur {total}", "Step {position} of {total}")
    .replace("{position}", String(view.progress.index))
    .replace("{total}", String(view.progress.total));
}

/** The line under the lesson's title (INT-STUDIUM-058): the status line of a version-2 view, which
 * says the step, the time left, the reviews due and what is expected; else the step alone. */
export function headerLine(view: StudiumPanelView): string {
  if (view.status_line) return view.status_line;
  // A version-1 view has no status line: the reviews due go beside the step, as the HTML panel's chip does.
  const due = view.reviewDue.length;
  if (due === 0) return progressText(view);
  return `${progressText(view)} · ${phraseOf(view, "pane_due_review", "{count} à réviser", "{count} to review").replace("{count}", String(due))}`;
}

/** Who speaks in a block of the pane, as a short chip: the lesson's author over the scene, who
 * assessed the answer over its verdict. Empty for a version-1 view and for a verdict nobody assessed. */
export function voiceChip(view: StudiumPanelView, block: "scene" | "verdict"): string {
  const voice = view.voices?.[block];
  if (!voice) return "";
  // A key verdict says whose key it is, as the conversation does (walkthrough 2026-11-07).
  const drafted = view.voices?.scene?.kind === "author" ? view.voices.scene.drafted_by : undefined;
  if (voice.kind === "key" && drafted === "agent") {
    return phraseOf(view, "pane_voice_key_ai", "Évalué par la clé rédigée par l'IA — vérifie-la avec le passage cité", "Assessed by the AI-drafted key — check it against the cited passage");
  }
  // A classmate's contribution (teacher mode, drafted by a learner): the key is not the reader's own.
  const classmate = view.voices?.scene?.kind === "author" && view.voices.scene.from_classmate === true;
  if (voice.kind === "key" && classmate) {
    return phraseOf(view, "pane_voice_key_classmate", "Évalué par la clé rédigée par une personne de la classe", "Assessed by the key written by a classmate");
  }
  if (voice.kind === "key" && drafted === "learner") return phraseOf(view, "pane_voice_key_own", "Évalué par la clé que tu as rédigée", "Assessed by the key you wrote");
  if (voice.kind === "key") return phraseOf(view, "pane_voice_key", "Évalué par la clé de l'auteur", "Assessed by the author's key");
  if (voice.kind === "judge") return phraseOf(view, "pane_voice_judge", "Évalué par un juge (modèle)", "Assessed by a judge (model)");
  if (voice.kind === "agent") return phraseOf(view, "pane_voice_agent", "Texte de l'assistant, hors leçon", "Assistant's text, not part of the lesson");
  if (voice.from_classmate === true) {
    if (voice.reviewed && voice.name) {
      return phraseOf(view, "pane_voice_classmate_validated_by", "Leçon proposée par une personne de la classe, validée par {name}",
        "Lesson contributed by a classmate, validated by {name}").replace("{name}", voice.name);
    }
    if (voice.reviewed) return phraseOf(view, "pane_voice_validated", "Leçon validée par un enseignant", "Lesson validated by a teacher");
    return voice.name
      ? phraseOf(view, "pane_voice_classmate_changed", "Leçon proposée par une personne de la classe. Modifiée depuis sa validation.",
        "Lesson contributed by a classmate. Changed since its validation.")
      : phraseOf(view, "pane_voice_classmate_unreviewed", "Leçon proposée par une personne de la classe. Aucune approbation enregistrée pour cette leçon.",
        "Lesson contributed by a classmate. No approval is recorded for this lesson.");
  }
  if (voice.reviewed) {
    return voice.name
      ? phraseOf(view, "pane_voice_validated_by", "Leçon validée par {name}", "Lesson validated by {name}").replace("{name}", voice.name)
      : phraseOf(view, "pane_voice_validated", "Leçon validée par un enseignant", "Lesson validated by a teacher");
  }
  if (voice.name) return phraseOf(view, "pane_voice_changed", "Leçon modifiée depuis sa validation", "Lesson changed since its validation");
  if (voice.drafted_by === "agent") {
    return phraseOf(view, "pane_voice_ai_unreviewed", "Leçon rédigée par l'IA, non relue par un enseignant", "AI-drafted lesson, not reviewed by a teacher");
  }
  if (voice.drafted_by === "learner") {
    return phraseOf(view, "pane_voice_learner_unreviewed", "Leçon que tu as rédigée, non relue par un enseignant", "Lesson you wrote, not reviewed by a teacher");
  }
  // A teacher-drafted lesson without an approval record (C5): say only that none is recorded.
  return phraseOf(view, "pane_voice_unreviewed", "Aucune approbation enregistrée pour cette leçon", "No approval is recorded for this lesson");
}

/** One rung of the help ladder as the pane draws it. `note`: what taking it costs, why it is closed,
 * or where to look. `action`: what pressing it sends; a rung without one only says its note. */
export type HelpControl = {
  kind: StudiumHelpRung["kind"];
  label: string;
  available: boolean;
  note?: string;
  action?: StudiumPanelAction;
};

/** The help ladder of a version-2 view, in the order to try the rungs. An open hint asks for the
 * authored hint; an open explanation hands over to the assistant with the learner's request. Reading
 * again and the reference need no server call: the text is in the pane. */
export function helpControls(view: StudiumPanelView): HelpControl[] {
  return (view.help?.rungs ?? []).map(rung => {
    const note = rung.available ? rung.cost ?? openNote(view, rung.kind) : rung.why_not;
    const action = rung.available ? rungAction(view, rung.kind) : undefined;
    return {
      kind: rung.kind, label: rungLabel(view, rung.kind), available: rung.available,
      ...(note ? { note } : {}), ...(action ? { action } : {}),
    };
  });
}

function rungLabel(view: StudiumPanelView, kind: StudiumHelpRung["kind"]): string {
  if (kind === "reread") return phraseOf(view, "pane_help_reread", "Relire", "Read again");
  if (kind === "hint") return phraseOf(view, "pane_hint", "Indice", "Hint");
  if (kind === "explain") return phraseOf(view, "pane_help_explain", "Explication", "Explanation");
  return phraseOf(view, "pane_help_reference", "Référence", "Reference");
}

function openNote(view: StudiumPanelView, kind: StudiumHelpRung["kind"]): string | undefined {
  if (kind === "reread") return phraseOf(view, "pane_help_reread_note", "Le texte de cet écran est au-dessus.", "This screen's text is above.");
  if (kind === "reference") return phraseOf(view, "pane_help_reference_note", "La référence est affichée avec le verdict.", "The reference is shown with the verdict.");
  return undefined;
}

function rungAction(view: StudiumPanelView, kind: StudiumHelpRung["kind"]): StudiumPanelAction | undefined {
  if (kind === "hint" && view.actions.includes("hint")) return { type: "hint" };
  if (kind === "explain" && view.actions.includes("ask")) {
    return { type: "ask", text: phraseOf(view, "pane_help_explain_question", "Explique-moi cet écran.", "Explain this screen to me.") };
  }
  return undefined;
}

/** « Poser une question »: the gesture that hands over to the assistant, where the view offers it. */
export function askControl(view: StudiumPanelView): { label: string; action: StudiumPanelAction } | undefined {
  if (!view.actions.includes("ask")) return undefined;
  return { label: phraseOf(view, "pane_ask", "Poser une question", "Ask a question"), action: { type: "ask" } };
}

/** One proposal of the server as the pane draws it: its reason and one button per answer. A notice has
 * no button. */
export type PromptControl = { id: string; kind: StudiumPrompt["kind"]; reason: string; buttons: StudiumPrompt["actions"] };

/** What the server proposes, as the pane shows it under its controls (spec § 2.6). The server decides
 * what is proposed and how often; while an answer or a self-rating is owed the pane shows notices
 * only, and a proposal made at an earlier pause waits for the next one. A button whose action the view
 * does not offer is left out. */
export function promptControls(view: StudiumPanelView): PromptControl[] {
  const waiting = view.orientation?.waiting;
  const busy = waiting === "answer" || waiting === "self_rating";
  return (view.prompts ?? [])
    .filter(prompt => !busy || prompt.actions.length === 0)
    .map(prompt => ({
      id: prompt.id, kind: prompt.kind, reason: prompt.reason,
      buttons: prompt.actions.filter(answer => view.actions.includes(answer.action.type)),
    }));
}

/** The button that opens the concept map, or closes it, where the view offers one. */
export function mapControl(view: StudiumPanelView): { label: string; open: boolean; action: StudiumPanelAction } | undefined {
  if (view.actions.includes("closeMap")) {
    return { label: phraseOf(view, "pane_map_close", "Fermer la carte", "Close the map"), open: true, action: { type: "closeMap" } };
  }
  if (view.actions.includes("openMap")) {
    return { label: phraseOf(view, "pane_map_open", "Carte des notions", "Concept map"), open: false, action: { type: "openMap" } };
  }
  return undefined;
}

type Attention = NonNullable<StudiumPanelView["attention"]>;
const ATTENTION_LEVELS: readonly Attention[] = ["quiet", "normal", "coached"];
const ATTENTION_WORDS: Record<Attention, [string, string]> = {
  quiet: ["Silencieux", "Quiet"], normal: ["Normal", "Normal"], coached: ["Accompagné", "Coached"],
};
// Language names are not translated: the code the panel has text in, as the learner reads it anywhere.
const PANEL_LANGUAGES = ["fr", "en"] as const;
const REPLAN_MINUTES = { min: 1, max: 600 };

/** One setting button: `pressed` says it is the current choice. */
export type SettingControl = { key: string; label: string; pressed: boolean; action: StudiumPanelAction };
/** The learner's settings (INT-STUDIUM-058 F8), each drawn only when the view offers its action: how
 * much the lesson may propose, the panel's language, and the field where the learner types the
 * minutes they have. They answer nothing, so a pane keeps them while an answer is owed. */
export type SettingsControls = { attention: SettingControl[]; languages: SettingControl[]; replan?: { label: string; submit: string } };

export function settingsControls(view: StudiumPanelView): SettingsControls {
  const current = view.attention ?? "normal";
  const attention = view.actions.includes("setAttention") ? ATTENTION_LEVELS.map(level => ({
    key: `attention-${level}`, label: phraseOf(view, `pane_attention_${level}`, ...ATTENTION_WORDS[level]), pressed: level === current,
    action: { type: "setAttention", level } as StudiumPanelAction,
  })) : [];
  const languages = view.actions.includes("setLanguage") ? PANEL_LANGUAGES.map(code => ({
    key: `language-${code}`, label: code.toUpperCase(), pressed: view.locale === code,
    action: { type: "setLanguage", presentation_language: code } as StudiumPanelAction,
  })) : [];
  const replan = view.actions.includes("replan")
    ? { label: phraseOf(view, "pane_replan_minutes", "Minutes disponibles", "Minutes available"), submit: phraseOf(view, "pane_replan", "Replanifier", "Replan") }
    : undefined;
  return { attention, languages, ...(replan ? { replan } : {}) };
}

/** The minutes typed in the replan field as the action, or a one-line refusal: the server takes a
 * whole number of minutes from 1 to 600. */
export function replanAction(view: StudiumPanelView, raw: string): StudiumPanelAction {
  const text = raw.trim();
  const minutes = Number(text);
  if (!/^\d+$/.test(text) || minutes < REPLAN_MINUTES.min || minutes > REPLAN_MINUTES.max) {
    throw new Error(view.locale === "fr"
      ? `Indique un nombre entier de minutes, de ${REPLAN_MINUTES.min} à ${REPLAN_MINUTES.max}.`
      : `Give a whole number of minutes, from ${REPLAN_MINUTES.min} to ${REPLAN_MINUTES.max}.`);
  }
  return { type: "replan", minutes };
}

/** A label and what follows it, with the colon of the view's language. */
function labelled(view: StudiumPanelView, label: string, rest: string): string {
  return `${label}${view.locale === "fr" ? " : " : ": "}${rest}`;
}

const MAP_STATE_WORDS: Record<StudiumMapConcept["state"], [string, string]> = {
  acquired: ["acquise", "acquired"], to_review: ["à revoir", "to review"], current: ["en cours", "in progress"],
  seen: ["vue, pas encore évaluée", "seen, not assessed yet"], upcoming: ["à venir", "upcoming"],
};
const MAP_ASSESSOR_WORDS: Record<StudiumMapEvidence["assessed_by"], [string, string]> = {
  key: ["notée avec la clé de l'auteur", "graded against the author's key"], judge: ["évaluée par un modèle juge", "assessed by a judge model"],
  self: ["évaluée par toi", "rated by you"], none: ["évaluée par personne", "assessed by nobody"],
};
const MAP_RESULT_WORDS: Record<StudiumMapEvidence["result"], [string, string]> = {
  right: ["juste", "right"], wrong: ["fausse", "wrong"], rated: ["rappel auto-évalué", "recall self-rated"], recorded: ["enregistrée", "recorded"],
};
const MAP_OUTCOME_WORDS: Record<"confirmed" | "refuted" | "partial", [string, string]> = {
  confirmed: ["Dernier contrôle : déclaration confirmée", "Last check: claim confirmed"],
  refuted: ["Dernier contrôle : déclaration non confirmée", "Last check: claim not confirmed"],
  partial: ["Dernier contrôle : résultat partiel", "Last check: partial result"],
};

function evidenceLine(view: StudiumPanelView, fact: StudiumMapEvidence): string {
  const hints = fact.hints ?? 0;
  return [
    fact.day ?? phraseOf(view, "pane_map_day_unknown", "jour inconnu", "day unknown"),
    phraseOf(view, `pane_map_by_${fact.assessed_by}`, ...MAP_ASSESSOR_WORDS[fact.assessed_by]),
    phraseOf(view, `pane_map_result_${fact.result}`, ...MAP_RESULT_WORDS[fact.result]),
    hints === 1 ? phraseOf(view, "pane_map_hints_one", "1 indice", "1 hint")
      : hints > 1 ? phraseOf(view, "pane_map_hints_many", "{count} indices", "{count} hints").replace("{count}", String(hints)) : "",
  ].filter(Boolean).join(" · ");
}

/** The open concept map as a list in words, for Claude Code's Markdown element: each concept with its
 * state, what it needs, its checks, what the state establishes and what it does not, and the answers
 * behind it. Empty when the view carries no map. Nothing here is computed from the lesson. */
export function mapMarkdown(view: StudiumPanelView): string {
  const map = view.map;
  if (!map || map.concepts.length === 0) return "";
  const titles = new Map(map.concepts.map(concept => [concept.id, concept.title]));
  const lines = [`**${phraseOf(view, "pane_map_open", "Carte des notions", "Concept map")}**`, ""];
  for (const concept of map.concepts) {
    lines.push(`- ${labelled(view, `**${concept.title}**`, phraseOf(view, `pane_map_state_${concept.state}`, ...MAP_STATE_WORDS[concept.state]))}`);
    const needs = map.edges.filter(edge => edge.to === concept.id).map(edge => titles.get(edge.from)).filter((title): title is string => !!title);
    if (needs.length > 0) lines.push(`  - ${phraseOf(view, "pane_map_needs", "Prérequis : {list}", "Needs: {list}").replace("{list}", needs.join(", "))}`);
    if (concept.contest?.check_pending) lines.push(`  - ${phraseOf(view, "pane_map_check_pending", "Contrôle en cours", "Check under way")}`);
    const outcome = concept.contest?.outcome;
    if (outcome) lines.push(`  - ${phraseOf(view, `pane_map_outcome_${outcome}`, ...MAP_OUTCOME_WORDS[outcome])}`);
    lines.push(`  - ${labelled(view, phraseOf(view, "pane_map_establishes", "Ce que cet état établit", "What this state establishes"), concept.establishes)}`);
    lines.push(`  - ${labelled(view, phraseOf(view, "pane_map_not_established", "Ce qu'il n'établit pas", "What it does not establish"), concept.does_not_establish)}`);
    if (concept.evidence.length === 0) {
      lines.push(`  - ${phraseOf(view, "pane_map_no_evidence", "Aucune réponse sur cette notion pour l'instant.", "No answer on this concept yet.")}`);
    } else lines.push(...concept.evidence.map(fact => `  - ${evidenceLine(view, fact)}`));
  }
  return lines.join("\n");
}

/** One claim the learner may make on a concept of the open map: the server then asks its check questions. */
export type ContestControl = { concept_id: string; label: string; note: string; action: StudiumPanelAction };

/** A claim button per concept the server lets the learner contest, where the view offers the action. */
export function contestControls(view: StudiumPanelView): ContestControl[] {
  if (!view.map || !view.actions.includes("contest")) return [];
  return view.map.concepts.flatMap(concept => {
    const contest = concept.contest;
    if (!contest?.allowed) return [];
    const claim = contest.claim === "known"
      ? phraseOf(view, "pane_map_claim_known", "Je la connais", "I know it")
      : phraseOf(view, "pane_map_claim_unsure", "J'ai un doute", "I am not sure");
    const note = contest.questions >= 2
      ? phraseOf(view, "pane_map_contest_two", "Deux questions de contrôle suivront.", "Two check questions will follow.")
      : phraseOf(view, "pane_map_contest_one", "Une seule question de contrôle suivra : le résultat sera partiel.", "One check question will follow: the result will be partial.");
    return [{ concept_id: concept.id, label: labelled(view, concept.title, claim), note, action: { type: "contest", concept_id: concept.id, claim: contest.claim } }];
  });
}

/** The scene prose rendered through Claude Code's native Markdown element. */
export function sceneMarkdown(view: StudiumPanelView): string {
  const scene = view.scene;
  if (!scene) return view.message ?? "";
  const extra = [scene.markdown, scene.question, scene.prompt]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return extra.join("\n\n");
}

const REFERENCE_LABELS: Record<string, [string, string, string]> = {
  key_points: ["pane_key_points", "Points clés", "Key points"],
  planted_flaws: ["pane_planted_flaws", "Défauts plantés", "Planted flaws"],
  flawed_claims: ["pane_flawed_claims", "Affirmations qui cachaient un défaut", "Claims that hid a flaw"],
  correct_choice: ["pane_correct_choice", "La bonne réponse", "The right answer"],
};

/** Whether the verdict carries its parts as data (feedback, reference). Then the pane draws those parts and
 * not `display_markdown`, which holds the same words: one source, never both (audit A13). */
export function feedbackIsStructured(view: StudiumPanelView): boolean {
  const verdict = view.verdict;
  if (!verdict) return false;
  return [verdict.feedback, verdict.model_answer].some(part => typeof part === "string" && part.trim() !== "")
    || (verdict.key_points ?? []).length > 0;
}

/** Earned feedback, reference and hint, kept separate from the next scene. The structured fields when the
 * view carries them, else `display_markdown` alone. */
export function feedbackMarkdown(view: StudiumPanelView): string {
  const verdict = view.verdict;
  const lines: Array<string | undefined> = [];
  if (verdict && feedbackIsStructured(view)) {
    const kind = typeof verdict.reference_kind === "string" && verdict.reference_kind in REFERENCE_LABELS ? verdict.reference_kind : "key_points";
    const [key, fr, en] = REFERENCE_LABELS[kind]!;
    const missing = new Set(verdict.key_points_missing ?? []);
    const marker = phraseOf(view, "pane_key_point_missing", "(manquant selon le juge)", "(missing, per the judge)");
    lines.push(verdict.feedback);
    const points = (verdict.key_points ?? []).filter(item => item.trim() !== "");
    if (points.length) lines.push(`**${phraseOf(view, key, fr, en)}**\n${points.map(item => `- ${item}${missing.has(item) ? ` ${marker}` : ""}`).join("\n")}`);
    const modelAnswer = view.strings.pane_model_answer ?? (view.locale === "fr" ? "Réponse modèle" : "Model answer");
    const heading = kind === "planted_flaws" ? phraseOf(view, "pane_model_correction", "Correction modèle", "Model correction") : modelAnswer;
    if (verdict.model_answer) lines.push(`**${heading}**\n${verdict.model_answer}`);
  } else lines.push(verdict?.display_markdown);
  const hintHeading = view.strings.pane_hint_heading ?? (view.locale === "fr" ? "Indice :" : "Hint:");
  if (view.hint?.hint) lines.push(`**${hintHeading}** ${view.hint.hint}`);
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n\n");
}

// Why this scene is shown: the HTML panel's cards (artifact-pane.js NAV_CARDS), title and reason in one line.
const NAV_PHRASES: Record<string, [string, string, string, string, string, string]> = {
  replay: ["pane_gate_replay", "On refait cette étape ensemble", "Let's do this step again together", "pane_nav_replay_why",
    "Une deuxième tentative aide à fixer la notion. Ce n'est pas une sanction : relis tranquillement avant de répondre.",
    "A second attempt helps the idea settle. It is not a penalty: take your time before answering."],
  remediate_alt: ["pane_gate_remediate", "On reprend cette notion autrement", "Let's take this concept another way", "pane_nav_remediate_alt_why",
    "La même notion, présentée sous un autre angle.", "The same concept, from another angle."],
  remediate: ["pane_nav_detour", "Petit détour", "A short detour", "pane_nav_detour_why_generic",
    "On revoit d'abord une notion dont la suite a besoin, puis on reprend où tu en étais.",
    "First a concept the next steps rely on, then back to where you were."],
  gate_passed: ["pane_nav_return", "Retour au parcours", "Back on track", "pane_nav_return_why",
    "Le détour est terminé : on reprend là où tu en étais.", "The detour is over: you continue where you left off."],
  gate_released: ["pane_nav_onward", "On avance", "Moving on", "pane_nav_released_why",
    "Cette notion n'est pas encore acquise ; on avance quand même, et tu pourras y revenir.",
    "This concept is not yet acquired; you move on anyway, and can come back to it."],
  gate_unassessable: ["pane_nav_onward", "On avance", "Moving on", "pane_nav_unassessable_why",
    "Aucune étape de cette leçon ne permet de revoir cette notion maintenant : on avance.",
    "No step of this lesson can revisit this concept now: you move on."],
  skip_concept: ["pane_nav_next_concept", "Notion suivante", "Next concept", "pane_nav_next_concept_why",
    "Tes réponses montrent que tu maîtrises cette notion : on passe à la suivante.",
    "Your answers show you master this concept, so you move to the next one."],
};

/** The reason the learner is on a detour, a replay or a skipped stretch, in one line, with the HTML panel's
 * wording. Empty when the view carries no navigation worth saying. The detour's return title is not in
 * the view, so the generic wording is used. */
export function navigationLine(view: StudiumPanelView): string {
  const kind = view.navigation?.kind;
  if (kind === "skip_mastered") {
    const count = view.navigation?.skipped_scene_ids?.length ?? 0;
    const why = count > 1 ? phraseOf(view, "pane_nav_skip_many", "{count} étapes que tu maîtrises déjà ont été passées.", "{count} steps you already master were skipped.").replace("{count}", String(count))
      : count === 1 ? phraseOf(view, "pane_nav_skip_one", "Une étape que tu maîtrises déjà a été passée.", "One step you already master was skipped.")
        : phraseOf(view, "pane_nav_skip_generic", "Tu maîtrises déjà ce qui précède : on passe directement à cette étape.", "You already master what came before, so you go straight to this step.");
    return labelled(view, phraseOf(view, "pane_nav_skip", "On avance plus vite", "Moving faster"), why);
  }
  const phrases = kind ? NAV_PHRASES[kind] : undefined;
  if (!phrases) return "";
  const [titleKey, titleFr, titleEn, whyKey, whyFr, whyEn] = phrases;
  return labelled(view, phraseOf(view, titleKey, titleFr, titleEn), phraseOf(view, whyKey, whyFr, whyEn));
}

/** The calibration mirror (only the actionable bands, at most two, no number), one line each. The HTML
 * panel keeps those of the answered scene's concepts; the view does not say which, so the pane shows what the
 * view carries. */
export function calibrationLines(view: StudiumPanelView): string[] {
  return view.calibration.filter(item => item.band === "sur" || item.band === "sous").slice(0, 2).map(item => {
    const band = item.band === "sur"
      ? phraseOf(view, "pane_overconfidence", "Surconfiance", "Overconfidence")
      : phraseOf(view, "pane_underconfidence", "Sous-confiance", "Underconfidence");
    return `**${band}${view.locale === "fr" ? "\u00a0:" : ":"}** ${item.message}`;
  });
}

/** The completion screen's review line: reviews due now, else the date of the next one, else nothing. */
export function reviewLine(view: StudiumPanelView): string {
  const completion = view.completion;
  if (!completion) return "";
  if (completion.due_now > 0) {
    return phraseOf(view, "pane_completion_due_now", "Révisions à faire dès maintenant : {count}", "Reviews due now: {count}").replace("{count}", String(completion.due_now));
  }
  if (completion.next_review_at == null) return "";
  const date = new Date(completion.next_review_at);
  if (Number.isNaN(date.getTime())) return "";
  const words = new Intl.DateTimeFormat(view.locale, { weekday: "long", day: "numeric", month: "long" }).format(date);
  return phraseOf(view, "pane_completion_next", "Prochaine révision : {date}", "Next review: {date}").replace("{date}", words);
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
    reviewLine(view),
  ].filter(Boolean).join("\n\n");
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

/** Whether an error says the server no longer knows the session (it restarted, or the session was closed): the host's
 * message starts with « session not found ». Only that prefix is read; the tool's JSON envelope ({"error": "…"}, as
 * panelFromMcpResult passes it on) is opened first. */
function isSessionLost(message: string | undefined): boolean {
  let reason = (message ?? "").trim();
  if (reason.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(reason);
      reason = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : "";
    } catch { reason = ""; }
  }
  return reason.startsWith("session not found");
}

/** What the pane shows instead of the stale scene when an action reached a lost session (walkthrough 2026-11-07): the
 * notice, the reopen button's label, the command that does the same from the prompt, and the open the button sends
 * (the same lesson for the same learner, on this native pane). Undefined for any other view. */
export function sessionLostNotice(view: StudiumPanelView): {
  notice: string; button: string; command: string;
  open: { bundle_ref: string; learner_id: string; surface: "pane" };
} | undefined {
  if (view.kind !== "error" || !isSessionLost(view.message)) return undefined;
  return {
    notice: phraseOf(view, "pane_session_lost",
      "Séance perdue (le serveur a redémarré ou la séance a été fermée). Rouvre la leçon : ta progression est conservée.",
      "Session lost (the server restarted or the session was closed). Reopen the lesson: your progress is kept."),
    button: phraseOf(view, "pane_reopen_lesson", "Rouvrir la leçon", "Reopen the lesson"),
    command: phraseOf(view, "pane_reopen_command", "Pour la rouvrir : {command}", "To reopen it: {command}")
      .replace("{command}", `/studium ${view.bundle_ref}`),
    open: { bundle_ref: view.bundle_ref, learner_id: view.learner_id, surface: "pane" },
  };
}
