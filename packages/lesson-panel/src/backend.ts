import type { ModalityPreference } from "./modality.js";
import type { ReviewContext, RecallGrade } from "./pane-messages.js";
import type { PanelView, SceneAsset } from "./view.js";

/** Transport payloads stay server-side until the presenter projects a PanelView. */
export type Payload = Record<string, any>;
export interface PanelBackend {
  getCurrentScene(sessionId: string): Promise<Payload>;
  getSceneArtifacts(sessionId: string): Promise<SceneAsset[]>;
  getSessionState(sessionId: string): Promise<Payload>;
  submitResponse(sessionId: string, input: unknown): Promise<Payload>;
  submitTurn(sessionId: string, text: string): Promise<Payload>;
  requestHint(sessionId: string): Promise<Payload | null>;
  rateRecall(sessionId: string, sceneId: string, grade: RecallGrade): Promise<Payload>;
  startReviewSession(learnerId: string): Promise<Payload>;
  startLessonSession(bundleRef: string, learnerId: string): Promise<Payload>;
  forgetSession(sessionId: string): Promise<unknown>;
  getNextReinforcement(sessionId: string): Promise<Payload>;
  inlineImage(asset: SceneAsset, bundleRef: string): SceneAsset | Promise<SceneAsset>;
}

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
}
