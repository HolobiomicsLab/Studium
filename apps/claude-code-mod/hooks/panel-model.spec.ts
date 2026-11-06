import { describe, expect, test } from "vitest";

import type { StudiumPanelView } from "../types/index.js";
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

const PANEL: StudiumPanelView = {
  schema: "studium/panel-view/1",
  kind: "scene",
  session_id: "session-1",
  learner_id: "learner-1",
  bundle_ref: "atomistique-l1/lesson.json",
  lesson_title: "Atomistique",
  locale: "fr",
  strings: { pane_hint_heading: "Indice :" },
  progress: { index: 2, total: 9 },
  scene: {
    id: "s1-quiz-fer",
    type: "quiz",
    title: "Quiz : l'atome de fer",
    question: "Combien contient-il de neutrons ?",
    choices: [{ id: "a", text: "26" }, { id: "b", text: "30" }],
  },
  scene_assets: [],
  modalityPreference: "balanced",
  reviewDue: [],
  calibration: [],
  mastery: {},
  actions: ["respond", "hint", "end"],
};

describe("PanelView boundary", () => {
  test("accepts a P1 view and extracts it from a direct MCP result", () => {
    expect(isPanelView(PANEL)).toBe(true);
    expect(panelFromMcpResult({ structuredContent: { panel: PANEL } })).toEqual(PANEL);
  });

  test.each([
    ["schema", { ...PANEL, schema: "studium/panel-view/0" }],
    ["progress", { ...PANEL, progress: { index: "2", total: 9 } }],
    ["quiz choice", { ...PANEL, scene: { ...PANEL.scene, choices: [{ id: "a" }] } }],
    ["asset", { ...PANEL, scene_assets: [{ kind: "image", dataUri: 7 }] }],
    ["action", { ...PANEL, actions: ["invented"] }],
    ["feedback", { ...PANEL, verdict: { scene_id: "s1", graded: true, key_points: [7] } }],
  ])("rejects a malformed %s field even with the current schema", (_name, value) => {
    expect(isPanelView(value)).toBe(false);
    expect(() => panelFromMcpResult({ structuredContent: { panel: value } }))
      .toThrow("incompatible lesson view");
  });

  test("surfaces an MCP error message", () => {
    expect(() => panelFromMcpResult({ isError: true, content: [{ type: "text", text: "lesson unavailable" }] }))
      .toThrow("lesson unavailable");
  });
});

describe("pane behavior model", () => {
  test("maps quiz ids, letters, free text, discussion, confidence and acknowledgement", () => {
    expect(answerAction(PANEL, "b")).toEqual({ type: "respond", input: { kind: "quiz_choice", choiceId: "b" } });
    expect(answerAction(PANEL, "A")).toEqual({ type: "respond", input: { kind: "quiz_choice", choiceId: "a" } });
    expect(answerAction({ ...PANEL, scene: { id: "explain", type: "explain_back" } }, "My explanation"))
      .toEqual({ type: "respond", input: { kind: "explanation", text: "My explanation" } });
    expect(answerAction({ ...PANEL, scene: { id: "talk", type: "discussion" } }, "Bonjour"))
      .toEqual({ type: "turn", text: "Bonjour" });
    expect(answerAction({ ...PANEL, scene: { id: "meta", type: "meta_checkpoint" } }, "4"))
      .toEqual({ type: "respond", input: { kind: "confidence", value: 4 } });
    expect(answerAction({ ...PANEL, scene: { id: "intro", type: "exposition" } }, "next"))
      .toEqual({ type: "respond", input: { kind: "ack" } });
  });

  test("builds scene, feedback, completion and PNG render data", () => {
    expect(sceneMarkdown(PANEL)).toBe("Combien contient-il de neutrons ?");
    expect(feedbackMarkdown({
      ...PANEL,
      verdict: { scene_id: "s1", graded: true, feedback: "Bien", key_points: ["Z reste fixe"] },
      hint: { hint: "Soustrais Z" },
    })).toContain("Soustrais Z");
    expect(completionMarkdown({
      ...PANEL,
      kind: "done",
      completion: {
        consolidated: [{ id: "c1", label: "Isotopes" }],
        practised: [],
        not_measured: [],
        detours: 0,
        next_review_at: null,
        due_now: 0,
        actions: [],
      },
    })).toContain("Notions consolidées");
    expect(sourcesMarkdown({
      ...PANEL,
      sources: [{ title: "Source A", url: "https://example.test/a", quote: "passage exact", license: "CC BY 4.0" }],
    })).toBe("- [Source A](https://example.test/a) — “passage exact” _(CC BY 4.0)_");
    expect(pngPayload("data:image/png;base64,aGVsbG8=")).toBe("aGVsbG8=");
    expect(pngPayload("data:image/jpeg;base64,aGVsbG8=")).toBeUndefined();
    expect(errorView(PANEL, new Error("offline"))).toMatchObject({ kind: "error", message: "offline", pending: undefined });
  });
});
