import { atom, read, update } from "claude-code";
import type {
  ElementConstructor,
  EngineInterface,
  ImageProps,
  Register,
  RenderElement,
  RenderInput,
} from "claude-code";

import type {
  StudiumDeckFlags,
  StudiumPanelAction,
  StudiumPanelView,
  StudiumRecallGrade,
} from "../types/index.js";
import {
  answerAction,
  completionMarkdown,
  errorView,
  feedbackMarkdown,
  isPanelView,
  panelFromMcpResult,
  pngPayload,
  sceneMarkdown,
  sourcesMarkdown,
} from "./panel-model.js";

const PANE_ID = "studium";
const MCP_SERVER = "studium-lesson";
const panelState = atom({ plugin: "studium-panel", key: "panel" } as const, null, {
  shape: "panel-view-1",
});
const endConfirmation = atom(
  { plugin: "studium-panel", key: "endConfirmation" } as const,
  false,
  { shape: "end-confirmation-1" },
);
const deckFlags = atom(
  { plugin: "studium-panel", key: "deckFlags" } as const,
  null,
  { shape: "deck-flags-1" },
);

/** Register the command and native Pane without opening UI at session start. */
export const register: Register = on => {
  on("session.start", async ($, event, next) => {
    await $.command.register({
      name: "studium",
      description: "Open a Studium lesson pane: /studium [bundle_ref] or /studium answer <text>",
    });
    return next(event);
  });

  on("command.run", { command: "studium" }, ($, event) => runStudiumCommand($, event.args));
  on("ui.render", { component: "Pane", requestId: PANE_ID }, ($, event) => renderPane($, event));
};

async function runStudiumCommand($: EngineInterface, rawArgs: string) {
  const args = rawArgs.trim();
  if (args === "answer" || args.startsWith("answer ")) return runTypedAnswer($, args.slice(6).trim());
  try {
    const current = await readPanel($);
    let input: { bundle_ref: string } | { session_id: string };
    if (args) input = { bundle_ref: args };
    else if (current) input = { session_id: current.session_id };
    else return {
      text: "No active Studium lesson. Open one with /studium <bundle_ref>.",
      exitCode: 1,
    };
    // The server cannot detect a native pane: this adapter says it is one (INT-STUDIUM-058 § 2.4).
    const result = await $.mcp.call(MCP_SERVER, "open_lesson_panel", { ...input, surface: "pane" });
    const panel = panelFromMcpResult(result);
    await replacePanel($, panel);
    await $.ui.open({ id: PANE_ID, title: panel.lesson_title });
    return { text: `Opened Studium — ${panel.lesson_title}.` };
  } catch (error) {
    return { text: `Studium could not open the lesson: ${errorMessage(error)}.`, exitCode: 1 };
  }
}

async function runTypedAnswer($: EngineInterface, text: string) {
  const current = await readPanel($);
  if (!current) return { text: "No compatible lesson view. Run /studium <bundle_ref>.", exitCode: 1 };
  try {
    const outcome = await applyAction($, answerAction(current, text), phrase(current, "pane_sending_response", "Sending…", "Envoi…"));
    await $.ui.open({ id: PANE_ID, title: current.lesson_title });
    if (!outcome.ok) return { text: `Studium did not send the answer: ${outcome.message}.`, exitCode: 1 };
    return { text: current.locale === "fr" ? "Réponse Studium envoyée." : "Studium answer sent." };
  } catch (error) {
    return { text: `Studium did not send the answer: ${errorMessage(error)}.`, exitCode: 1 };
  }
}

async function replacePanel($: EngineInterface, panel: StudiumPanelView): Promise<void> {
  await update($, panelState, () => panel);
  await update($, endConfirmation, () => false);
  await update($, deckFlags, () => null);
}

async function applyAction(
  $: EngineInterface,
  action: StudiumPanelAction,
  pending: string,
  armEnd = false,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const current = await readPanel($);
  if (!current) return { ok: false, message: "No compatible lesson view" };
  if (current.pending) return { ok: false, message: "A Studium action is already pending" };
  await update($, panelState, view => view ? { ...view, pending } : view);
  try {
    const result = await $.mcp.call(MCP_SERVER, "panel_action", {
      session_id: current.session_id,
      action,
    });
    await update($, panelState, () => panelFromMcpResult(result));
    await update($, endConfirmation, () => armEnd);
    if (!armEnd) await update($, deckFlags, () => null);
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    await update($, panelState, view => view ? errorView(view, error) : view);
    await update($, endConfirmation, () => false);
    return { ok: false, message };
  }
}

async function toggleDeckFlag($: EngineInterface, sceneId: string, token: string): Promise<void> {
  await update($, deckFlags, current => {
    const tokens = current?.sceneId === sceneId ? current.tokens : [];
    return { sceneId, tokens: tokens.includes(token) ? tokens.filter(one => one !== token) : [...tokens, token] };
  });
}

function phrase(view: StudiumPanelView, key: string, en: string, fr: string): string {
  return view.strings[key] ?? (view.locale === "fr" ? fr : en);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readPanel($: EngineInterface): Promise<StudiumPanelView | null> {
  const value: unknown = await read($, panelState);
  return isPanelView(value) ? value : null;
}

function progressText(view: StudiumPanelView): string {
  const fallback = view.locale === "fr" ? "Étape {position} sur {total}" : "Step {position} of {total}";
  return (view.strings.pane_progress ?? fallback)
    .replace("{position}", String(view.progress.index))
    .replace("{total}", String(view.progress.total));
}

function objectText(value: Record<string, unknown> | null | undefined): string | undefined {
  if (!value) return undefined;
  for (const key of ["text", "message", "reply", "content"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return undefined;
}

async function renderPane($: EngineInterface, event: RenderInput<"Pane">) {
  const { Box, Button, Markdown, Text } = $.ui.resolve(event);
  const view = await readPanel($);
  if (!view) return <Box><Text>No compatible lesson view. Run /studium &lt;bundle_ref&gt;.</Text></Box>;
  const isDimmed = view.pending !== undefined;
  const flags = await read($, deckFlags);
  const isEndArmed = await read($, endConfirmation);
  const image = event.surface === "terminal" ? $.ui.resolve(event).Image : undefined;
  const controls = renderControls($, view, flags, isEndArmed, { Box, Button, Markdown, Text });
  const feedback = feedbackMarkdown(view);
  const sources = sourcesMarkdown(view);
  const tutor = objectText(view.turn_result?.tutor);

  return (
    <Box flexDirection="column" gap={1}>
      <Text size="title" weight="bold" dimColor={isDimmed}>{view.lesson_title}</Text>
      <Text dimColor={isDimmed}>{progressText(view)}</Text>
      {view.pending && <Text color="warning" dimColor>{view.pending}</Text>}
      {view.authoring?.notice && <Text dimColor>{view.authoring.notice}</Text>}
      {renderMainView(view, isDimmed, { Box, Markdown, Text })}
      {renderAssets(view, isDimmed, image, { Box, Text })}
      {feedback && <Markdown text={feedback} dimColor={isDimmed} />}
      {tutor && <Markdown text={tutor} dimColor={isDimmed} />}
      {sources && <Markdown text={sources} dimColor={isDimmed} />}
      {controls}
    </Box>
  );
}

type CommonElements = Pick<ReturnType<EngineInterface["ui"]["resolve"]>, "Box" | "Button" | "Markdown" | "Text">;

function renderMainView(
  view: StudiumPanelView,
  isDimmed: boolean,
  elements: Pick<CommonElements, "Box" | "Markdown" | "Text">,
): RenderElement {
  const { Box, Markdown, Text } = elements;
  if (view.kind === "done") return <Markdown text={completionMarkdown(view)} dimColor={isDimmed} />;
  if (view.kind === "notice") return <Markdown text={view.message ?? ""} dimColor={isDimmed} />;
  if (view.kind === "error") return <Text color="error" dimColor={isDimmed}>{view.message ?? "Studium error"}</Text>;
  const body = sceneMarkdown(view);
  return (
    <Box flexDirection="column" gap={1}>
      {view.scene?.title && <Text size="heading" weight="semibold" dimColor={isDimmed}>{view.scene.title}</Text>}
      {body && <Markdown text={body} dimColor={isDimmed} />}
    </Box>
  );
}

function renderAssets(
  view: StudiumPanelView,
  isDimmed: boolean,
  Image: ElementConstructor<ImageProps> | undefined,
  elements: Pick<CommonElements, "Box" | "Text">,
): RenderElement[] {
  const { Box, Text } = elements;
  return view.scene_assets.map((asset, index) => {
    const png = pngPayload(asset.dataUri);
    const title = asset.title ?? asset.path ?? `${asset.kind} ${index + 1}`;
    return (
      <Box key={`asset-${index}`} flexDirection="column" borderStyle="round" padding={1}>
        <Text weight="medium" dimColor={isDimmed}>{title} · {asset.kind}</Text>
        {Image && png && <Image key={`asset-image-${index}`} source={{ png }} columns={36} rows={10} alt={title} />}
      </Box>
    );
  });
}

function renderControls(
  $: EngineInterface,
  view: StudiumPanelView,
  flags: StudiumDeckFlags | null,
  isEndArmed: boolean,
  elements: CommonElements,
): RenderElement {
  const { Box, Button, Markdown, Text } = elements;
  const dim = view.pending !== undefined;
  const nodes: RenderElement[] = [];
  if (view.kind === "scene" && view.actions.includes("respond")) {
    nodes.push(...responseControls($, view, flags, elements));
  }
  if (view.actions.includes("hint")) nodes.push(actionButton($, view, "hint", { type: "hint" }, dim, Button));
  if (view.actions.includes("reviewNow")) nodes.push(actionButton($, view, "reviewNow", { type: "reviewNow" }, dim, Button));
  if (view.actions.includes("restartLesson")) nodes.push(actionButton($, view, "restartLesson", { type: "restartLesson" }, dim, Button));
  if (view.actions.includes("pickCourse")) nodes.push(pickCourseButton($, view, dim, Button));
  nodes.push(...ratingButtons($, view, dim, Button));
  if (view.actions.includes("end")) nodes.push(endButton($, view, isEndArmed, dim, Button));
  if (nodes.length === 0) return <Text dimColor>{view.locale === "fr" ? "Aucune action disponible." : "No action is available."}</Text>;
  const help = answerHelp(view);
  return <Box flexDirection="column" gap={1}>{nodes}{help && <Markdown text={help} dimColor={dim} />}</Box>;
}

function responseControls(
  $: EngineInterface,
  view: StudiumPanelView,
  flags: StudiumDeckFlags | null,
  elements: CommonElements,
): RenderElement[] {
  const scene = view.scene;
  if (!scene) return [];
  const { Box, Button, Markdown, Text } = elements;
  const dim = view.pending !== undefined;
  if (scene.type === "quiz") return (scene.choices ?? []).map(choice => (
    <Button
      key={`choice-${choice.id}`}
      dimColor={dim}
      onPress={() => applyAction($, { type: "respond", input: { kind: "quiz_choice", choiceId: choice.id } }, pendingAnswer(view))}
    >{choice.text}</Button>
  ));
  if (scene.type === "meta_checkpoint") return [0, 1, 2, 3, 4].map(value => (
    <Button key={`confidence-${value}`} dimColor={dim} onPress={() => applyAction($, { type: "respond", input: { kind: "confidence", value } }, pendingAnswer(view))}>{String(value)}</Button>
  ));
  if (scene.deck?.length) return deckControls($, view, flags, { Box, Button, Markdown, Text });
  if (scene.type === "discussion") return [
    <Button key="finish-discussion" dimColor={dim} onPress={() => applyAction($, { type: "respond", input: { kind: "ack" } }, pendingAnswer(view))}>
      {phrase(view, "pane_finish_discussion", "Finish the conversation", "Terminer l'échange")}
    </Button>,
  ];
  if (FREE_TEXT_SCENES.has(scene.type)) return [];
  return [
    <Button key="continue" variant="primary" dimColor={dim} onPress={() => applyAction($, { type: "respond", input: { kind: "ack" } }, pendingAnswer(view))}>
      {phrase(view, "pane_continue", "Continue", "Continuer")}
    </Button>,
  ];
}

const FREE_TEXT_SCENES = new Set([
  "ai_critique", "spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim",
]);

function deckControls(
  $: EngineInterface,
  view: StudiumPanelView,
  current: StudiumDeckFlags | null,
  elements: CommonElements,
): RenderElement[] {
  const { Button, Markdown } = elements;
  const scene = view.scene!;
  const selected = current?.sceneId === scene.id ? current.tokens : [];
  const rows = (scene.deck ?? []).flatMap(item => [
    <Markdown key={`deck-text-${item.token}`} text={item.text} dimColor={view.pending !== undefined} />,
    <Button key={`deck-${item.token}`} dimColor={view.pending !== undefined} onPress={() => toggleDeckFlag($, scene.id, item.token)}>
      {selected.includes(item.token)
        ? phrase(view, "pane_flagged", "Flagged", "Signalé")
        : phrase(view, "pane_sounds_right", "Sounds right", "Semble correct")}
    </Button>,
  ]);
  rows.push(
    <Button key="deck-submit" variant="primary" dimColor={view.pending !== undefined} onPress={() => submitDeck($, view, selected)}>
      {phrase(view, "pane_validate", "Submit", "Valider")}
    </Button>,
  );
  return rows;
}

async function submitDeck($: EngineInterface, view: StudiumPanelView, selected: string[]): Promise<void> {
  const verdicts = (view.scene?.deck ?? []).map(item => ({ token: item.token, flagged: selected.includes(item.token) }));
  await applyAction($, { type: "respond", input: { kind: "flaw_verdicts", verdicts } }, pendingAnswer(view));
}

function ratingButtons(
  $: EngineInterface,
  view: StudiumPanelView,
  dim: boolean,
  Button: CommonElements["Button"],
): RenderElement[] {
  if (!view.actions.includes("rateRecall") || !view.self_rating) return [];
  const sceneId = view.self_rating.scene_id ?? view.verdict?.scene_id ?? view.scene?.id;
  if (!sceneId) return [];
  return view.self_rating.grades.map(grade => (
    <Button key={`rate-${grade}`} dimColor={dim} onPress={() => rateRecall($, view, sceneId, grade)}>{grade}</Button>
  ));
}

async function rateRecall($: EngineInterface, view: StudiumPanelView, sceneId: string, grade: StudiumRecallGrade) {
  await applyAction($, { type: "rateRecall", sceneId, grade }, phrase(view, "pane_self_rating_pending", "Saving your rating…", "Enregistrement de ta note…"));
}

function actionButton(
  $: EngineInterface,
  view: StudiumPanelView,
  name: "hint" | "reviewNow" | "restartLesson",
  action: StudiumPanelAction,
  dim: boolean,
  Button: CommonElements["Button"],
): RenderElement {
  const labels = {
    hint: phrase(view, "pane_hint", "Hint", "Indice"),
    reviewNow: phrase(view, "pane_review_now", "Review now", "Réviser maintenant"),
    restartLesson: phrase(view, "pane_restart", "Restart lesson", "Revoir le parcours"),
  };
  return <Button key={name} dimColor={dim} onPress={() => applyAction($, action, labels[name])}>{labels[name]}</Button>;
}

function pickCourseButton(
  $: EngineInterface,
  view: StudiumPanelView,
  dim: boolean,
  Button: CommonElements["Button"],
): RenderElement {
  const label = phrase(view, "pane_pick_course", "Choose another course", "Choisir un autre cours");
  const help = view.locale === "fr"
    ? "Ouvre une autre leçon avec /studium <bundle_ref>."
    : "Open another lesson with /studium <bundle_ref>.";
  return <Button key="pickCourse" dimColor={dim} onPress={() => $.ui.toast(help, { timeoutMs: 8_000 })}>{label}</Button>;
}

function endButton(
  $: EngineInterface,
  view: StudiumPanelView,
  armed: boolean,
  dim: boolean,
  Button: CommonElements["Button"],
): RenderElement {
  const label = armed
    ? (view.locale === "fr" ? "Confirmer l'effacement" : "Confirm erasure")
    : phrase(view, "pane_forget", "Forget me", "M'oublier");
  return <Button key="end" dimColor={dim} onPress={() => applyAction($, { type: "end", confirmed: armed }, label, !armed)}>{label}</Button>;
}

function pendingAnswer(view: StudiumPanelView): string {
  return phrase(view, "pane_sending_response", "Sending your response…", "Envoi de ta réponse…");
}

function answerHelp(view: StudiumPanelView): string {
  if (!view.scene || !view.actions.includes("respond")) return "";
  if (view.scene.type === "discussion") return view.locale === "fr"
    ? "Envoie un tour avec `/studium answer <texte>`, puis termine avec le bouton."
    : "Send a turn with `/studium answer <text>`, then finish with the button.";
  if (FREE_TEXT_SCENES.has(view.scene.type)) return view.locale === "fr"
    ? "Réponds avec `/studium answer <texte>`."
    : "Answer with `/studium answer <text>`.";
  return "";
}
