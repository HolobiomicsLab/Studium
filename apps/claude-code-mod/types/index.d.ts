export type StudiumLocale = "fr" | "en";
export type StudiumRecallGrade = "again" | "hard" | "good" | "easy";
export type StudiumPanelActionName =
  | "respond"
  | "turn"
  | "hint"
  | "rateRecall"
  | "reviewNow"
  | "restartLesson"
  | "end"
  | "pickCourse";

export type StudiumPanelAction =
  | { type: "respond"; input: unknown }
  | { type: "turn"; text: string }
  | { type: "hint" }
  | { type: "rateRecall"; sceneId: string; grade: StudiumRecallGrade }
  | { type: "reviewNow" }
  | { type: "restartLesson" }
  | { type: "end"; confirmed: boolean }
  | { type: "pickCourse" };

export type StudiumNamedConcept = { id: string; label: string };
export type StudiumSource = {
  title: string;
  quote?: string;
  url?: string;
  license?: string;
};

export type StudiumPublicScene = {
  id: string;
  type: string;
  title?: string;
  question?: string;
  prompt?: string;
  markdown?: string;
  concept_refs?: string[];
  choices?: Array<{ id: string; text: string; [field: string]: unknown }>;
  deck?: Array<{ token: string; text: string; [field: string]: unknown }>;
  [field: string]: unknown;
};

export type StudiumSceneAsset = {
  kind: string;
  title?: string;
  path?: string;
  payload?: string;
  dataUri?: string;
  bundle_ref?: string;
  emphasis?: "expanded" | "normal" | "compact";
  [field: string]: unknown;
};

export type StudiumVerdict = {
  scene_id: string;
  graded: boolean;
  correct?: boolean;
  signal?: string;
  assessed_by?: "key" | "judge" | "none";
  feedback?: string;
  key_points?: string[];
  key_points_missing?: string[];
  model_answer?: string;
  display_markdown?: string;
  sources?: StudiumSource[];
  [field: string]: unknown;
};

export type StudiumNavigation = {
  kind:
    | "advance"
    | "replay"
    | "remediate_alt"
    | "remediate"
    | "gate_passed"
    | "gate_released"
    | "gate_unassessable"
    | "skip_mastered"
    | "skip_concept"
    | "calibration"
    | "complete";
  scene_id?: string | null;
  rule_id?: string | null;
  reason?: string | null;
  modulator?: string | null;
  returns_to?: string;
  skipped_scene_ids?: string[];
  [field: string]: unknown;
};

export type StudiumCompletion = {
  consolidated: StudiumNamedConcept[];
  practised: Array<StudiumNamedConcept & { answers: number }>;
  not_measured: StudiumNamedConcept[];
  detours: number;
  next_review_at: number | null;
  due_now: number;
  actions: Array<"review" | "restart" | "pick">;
};

export type StudiumPanelView = {
  schema: "studium/panel-view/1";
  kind: "scene" | "done" | "notice" | "error";
  session_id: string;
  learner_id: string;
  bundle_ref: string;
  lesson_title: string;
  locale: StudiumLocale;
  strings: Record<string, string>;
  progress: { index: number; total: number };
  scene?: StudiumPublicScene;
  scene_assets: StudiumSceneAsset[];
  modalityPreference: "balanced" | "visual" | "textual";
  verdict?: StudiumVerdict | null;
  navigation?: StudiumNavigation | null;
  self_rating?: {
    requested: true;
    scene_id?: string;
    grades: StudiumRecallGrade[];
    [field: string]: unknown;
  } | null;
  reviewDue: StudiumNamedConcept[];
  calibration: Array<{ concept_id: string; band: "bien" | "sur" | "sous"; message: string }>;
  mastery: Record<string, number | null>;
  authoring?: {
    mode: "teacher" | "self_study";
    author_is_learner: boolean;
    validated: boolean;
    judge: boolean;
    notice: string | null;
    [field: string]: unknown;
  } | null;
  sources?: StudiumSource[];
  explanation?: string | Record<string, unknown> | null;
  hint?: { hint: string | null; remaining?: number };
  turn_result?: {
    reasoning: Record<string, unknown> | null;
    tutor: Record<string, unknown> | null;
  };
  recall_rated?: { sceneId: string; grade: StudiumRecallGrade };
  completion?: StudiumCompletion;
  message?: string;
  actions: StudiumPanelActionName[];
  pending?: string;
};

export type StudiumDeckFlags = { sceneId: string; tokens: string[] };

declare module "claude-code" {
  interface PluginState {
    "studium-panel": {
      panel: Shaped<StudiumPanelView | null>;
      endConfirmation: Shaped<boolean>;
      deckFlags: Shaped<StudiumDeckFlags | null>;
    };
  }
}
