import type { ModalityPreference } from "./modality.js";
import type { ReviewContext, RecallGrade } from "./pane-messages.js";
import type { Attention, Help, Orientation, PanelView, Prompt, SceneAsset, Surface, Voices } from "./view.js";
import type { MapRecord } from "./map.js";

/** Transport payloads stay server-side until the presenter projects a PanelView. */
export type Payload = Record<string, any>;
export interface PanelBackend {
  getCurrentScene(sessionId: string): Promise<Payload>;
  getSceneArtifacts(sessionId: string): Promise<SceneAsset[]>;
  getSessionState(sessionId: string): Promise<Payload>;
  /** `expectedSceneId`: the scene the learner answered; a backend refuses the answer when another is on
   * screen (audit 2026-11-10 D2). A backend that cannot check it ignores it. */
  submitResponse(sessionId: string, input: unknown, expectedSceneId?: string): Promise<Payload>;
  submitTurn(sessionId: string, text: string): Promise<Payload>;
  requestHint(sessionId: string): Promise<Payload | null>;
  rateRecall(sessionId: string, sceneId: string, grade: RecallGrade): Promise<Payload>;
  startReviewSession(learnerId: string): Promise<Payload>;
  startLessonSession(bundleRef: string, learnerId: string): Promise<Payload>;
  forgetSession(sessionId: string): Promise<unknown>;
  getNextReinforcement(sessionId: string): Promise<Payload>;
  inlineImage(asset: SceneAsset, bundleRef: string): SceneAsset | Promise<SceneAsset>;
  /** INT-STUDIUM-058: where the learner is, the same in one line, who speaks and which help is open
   * (lesson-session-host orientation.ts). `verdict` is the verdict of the answer just given, whose
   * voice is told. A backend without this method writes version-1 views. */
  getOrientation?(sessionId: string, ask: { locale: "fr" | "en"; lessonTitle: string; verdict: Payload | null }): Promise<PanelOrientation>;
  /** The language the conversation presents the session in (null: the lesson's own). A panel only
   * has French and English text of its own; the session notes any language. */
  setSessionLanguage?(sessionId: string, language: string | null): Promise<unknown>;
  /** The record behind the session's concept map (studium/concept-map-record/v1), or null when the
   * session has no map (a review session, a lesson with fewer than two concepts). A backend without
   * this method offers no map. */
  getConceptMapRecord?(sessionId: string): Promise<MapRecord | null>;
  /** The learner contests a concept: the session moves to the first check question; `questions` says
   * how many follow (two, or one when the lesson has a single key-graded scene on the concept). Throws,
   * with one line, when the contest is refused. A backend without this method takes no contest. */
  contestConcept?(sessionId: string, conceptId: string, claim: "known" | "unsure"): Promise<{ questions: number }>;
  /** What the session proposes to the learner now (spec § 2.6). The rules are the server's: nothing
   * while an answer is owed, a budget set by `attention`, each proposal made once. The view adds the
   * label and the action of each. A backend without this method proposes nothing. */
  getPrompts?(sessionId: string, ask: { attention: Attention; surface: Surface; locale: "fr" | "en" }): Promise<ServedPrompt[]>;
  /** The learner accepted or dismissed a proposal: the server keeps the outcome and says the kind of
   * the prompt. Throws, with one line, when no such proposal is open. */
  settlePrompt?(sessionId: string, promptId: string, outcome: "accepted" | "dismissed"): Promise<{ kind: string }>;
}

/** A prompt as the server's rules hold it: its kind and its reason, no label and no action. */
export interface ServedPrompt {
  id: string;
  kind: string;
  reason: string;
  expires: "scene" | "session";
}

/** What a backend adds to a view to make it version 2. */
export interface PanelOrientation { orientation: Orientation; status_line: string; voices: Voices; help: Help }

/** Host-owned mutable context: actions replace session/transition and retain completion for ratings. */
export interface PanelContext {
  sessionId: string;
  learnerId: string;
  bundleRef: string;
  lessonTitle: string;
  conceptTitles?: Record<string, string>;
  review?: ReviewContext | null;
  locale?: "fr" | "en";
  showMastery?: boolean;
  modalityPreference?: ModalityPreference;
  transition?: Payload;
  lastView?: PanelView;
  effects?: Partial<Pick<PanelView, "hint" | "turn_result" | "recall_rated" | "kind" | "message">>;
  now?: () => number;
  /** The surface the host plays the lesson on; a panel when the host does not say. */
  surface?: Surface;
  /** How much the session may propose; `normal` when the host does not say. */
  attention?: Attention;
  /** What the view proposes now. A prompt that expires with its scene leaves at the next answer. */
  prompts?: Prompt[];
  /** The learner opened the concept map (openMap) and has not closed it: each view carries it. */
  mapOpen?: boolean;
  /** The question of the learner's last `ask`, for the companion's brief; absent when none was written. */
  question?: string;
}
