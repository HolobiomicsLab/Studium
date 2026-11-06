import { describe, expect, test } from "vitest";

import type { StudiumPanelView } from "../types/index.js";
import {
  answerAction,
  askControl,
  completionMarkdown,
  errorView,
  feedbackMarkdown,
  headerLine,
  helpControls,
  isPanelView,
  panelFromMcpResult,
  pngPayload,
  sceneMarkdown,
  sourcesMarkdown,
  voiceChip,
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

  // INT-STUDIUM-058: the server writes version 2; the pane reads both versions.
  const V2: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2",
    orientation: { step: { index: 2, total: 9 }, reviews_due: 0, waiting: "answer" },
    status_line: "Atomistique · étape 2/9 · à toi de répondre",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
    help: { rungs: [{ kind: "reread", available: true }, { kind: "explain", available: false, why_not: "essaie d'abord de répondre" }] },
    prompts: [], attention: "normal", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
  };

  test("accepts a version-2 view", () => {
    expect(isPanelView(V2)).toBe(true);
    expect(panelFromMcpResult({ structuredContent: { panel: V2 } })).toEqual(V2);
  });

  // Task 2.2: a version-2 scene offers four more actions; a pane that refused them would go blank.
  test("accepts a version-2 view that offers ask, setLanguage, setAttention and replan, and a replan prompt", () => {
    const offered = {
      ...V2, actions: [...V2.actions, "ask", "setLanguage", "setAttention", "replan"],
      prompts: [{ id: "replan", kind: "replan", reason: "Tu as 10 min.", actions: [{ label: "Réviser maintenant", action: { type: "reviewNow" } }], expires: "scene" }],
    };
    expect(isPanelView(offered)).toBe(true);
    expect(isPanelView({ ...V2, actions: [...V2.actions, "teleport"] })).toBe(false);
  });

  // INT-STUDIUM-058 § 2.7: a view may offer the concept map and carry it once opened.
  test("accepts a view that offers the map, and one that carries it", () => {
    expect(isPanelView({ ...V2, actions: [...V2.actions, "openMap"] })).toBe(true);
    const map = {
      concepts: [{
        id: "c-a", title: "Notion", state: "acquired", establishes: "Établi.", does_not_establish: "Pas établi.",
        evidence: [{ scene_id: "s1", day: "2026-11-06", assessed_by: "key", result: "right", hints: 0 }],
      }],
      edges: [],
    };
    expect(isPanelView({ ...V2, actions: [...V2.actions, "closeMap"], map })).toBe(true);
  });

  test.each([
    ["orientation", { ...V2, orientation: { step: { index: "2", total: 9 }, reviews_due: 0, waiting: "answer" } }],
    ["waiting", { ...V2, orientation: { ...V2.orientation, waiting: "sleeping" } }],
    ["status line", { ...V2, status_line: 7 }],
    ["voice", { ...V2, voices: { scene: { kind: "narrator" } } }],
    ["help rung", { ...V2, help: { rungs: [{ kind: "reread", available: "yes" }] } }],
    ["missing orientation", { ...V2, orientation: undefined }],
  ])("rejects a version-2 view with a malformed %s", (_name, value) => {
    expect(isPanelView(value)).toBe(false);
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

// INT-STUDIUM-058, task 2.5: what the pane shows of a version-2 view — where the learner is, who
// speaks in each block, which help is open, and the gesture that hands over to the assistant.
describe("pane model of a version-2 view", () => {
  const V2: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2",
    actions: ["respond", "hint", "end", "ask", "setLanguage", "setAttention", "replan"],
    orientation: { step: { index: 2, total: 9 }, reviews_due: 0, waiting: "answer" },
    status_line: "Atomistique · étape 2/9 · 12 min · à toi de répondre",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
    help: { rungs: [
      { kind: "reread", available: true },
      { kind: "hint", available: true, cost: "un indice réduit le crédit de cette réponse" },
      { kind: "explain", available: false, why_not: "essaie d'abord de répondre" },
      { kind: "reference", available: false, why_not: "la référence s'affiche après ta réponse" },
    ] },
    prompts: [], attention: "normal", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
  };

  test("the header is the status line; a version-1 view keeps its step", () => {
    expect(headerLine(V2)).toBe("Atomistique · étape 2/9 · 12 min · à toi de répondre");
    expect(headerLine(PANEL)).toBe("Étape 2 sur 9");
    expect(headerLine({ ...PANEL, strings: { pane_progress: "Écran {position}/{total}" } })).toBe("Écran 2/9");
  });

  test("one voice chip per block: the lesson's author on the scene, the assessor on the verdict", () => {
    expect(voiceChip(V2, "scene")).toBe("Leçon validée par Prof. Test");
    expect(voiceChip(V2, "verdict")).toBe(""); // nobody assessed anything yet
    expect(voiceChip({ ...V2, voices: { ...V2.voices!, verdict: { kind: "key" } } }, "verdict")).toBe("Évalué par la clé de l'auteur");
    expect(voiceChip({ ...V2, voices: { ...V2.voices!, verdict: { kind: "judge" } } }, "verdict")).toBe("Évalué par un juge (modèle)");
    expect(voiceChip({ ...V2, voices: { scene: { kind: "author", name: null, reviewed: false, drafted_by: "agent" } } }, "scene"))
      .toBe("Leçon rédigée par l'IA, non relue par un enseignant");
    expect(voiceChip({ ...V2, voices: { scene: { kind: "author", name: null, reviewed: false, drafted_by: "learner" } } }, "scene"))
      .toBe("Leçon que tu as rédigée, non relue par un enseignant");
    expect(voiceChip({ ...V2, voices: { scene: { kind: "author", name: null, reviewed: true, drafted_by: "teacher" } } }, "scene"))
      .toBe("Leçon validée par un enseignant");
    expect(voiceChip({ ...V2, voices: { scene: { kind: "author", name: "Prof. Test", reviewed: false, drafted_by: "teacher" } } }, "scene"))
      .toBe("Leçon modifiée depuis sa validation");
    expect(voiceChip({ ...V2, locale: "en", voices: { scene: { kind: "agent" } } }, "scene")).toBe("Assistant's text, not part of the lesson");
    expect(voiceChip({ ...V2, strings: { pane_voice_validated_by: "Signée {name}" } }, "scene")).toBe("Signée Prof. Test"); // the view's own words win
    expect(voiceChip(PANEL, "scene")).toBe(""); // version 1 says nothing of voices
  });

  test("the help ladder: each rung a control, a closed rung with its reason, an open hint with its cost", () => {
    expect(helpControls(V2)).toEqual([
      { kind: "reread", label: "Relire", available: true, note: "Le texte de cet écran est au-dessus." },
      { kind: "hint", label: "Indice", available: true, note: "un indice réduit le crédit de cette réponse", action: { type: "hint" } },
      { kind: "explain", label: "Explication", available: false, note: "essaie d'abord de répondre" },
      { kind: "reference", label: "Référence", available: false, note: "la référence s'affiche après ta réponse" },
    ]);
    expect(helpControls(PANEL)).toEqual([]); // version 1: the pane keeps its single hint button
  });

  test("an open explanation hands over to the assistant with the learner's request; an open reference says where it is", () => {
    const tried: StudiumPanelView = { ...V2, help: { rungs: [
      { kind: "explain", available: true }, { kind: "reference", available: true },
    ] } };
    expect(helpControls(tried)).toEqual([
      { kind: "explain", label: "Explication", available: true, action: { type: "ask", text: "Explique-moi cet écran." } },
      { kind: "reference", label: "Référence", available: true, note: "La référence est affichée avec le verdict." },
    ]);
    // A view that does not offer the action gives a rung nothing to send.
    expect(helpControls({ ...tried, actions: ["respond"] })[0]).toEqual({ kind: "explain", label: "Explication", available: true });
    expect(helpControls({ ...V2, actions: ["respond"] })[1])
      .toEqual({ kind: "hint", label: "Indice", available: true, note: "un indice réduit le crédit de cette réponse" });
  });

  test("« Poser une question » sends the ask action, where the view offers it", () => {
    expect(askControl(V2)).toEqual({ label: "Poser une question", action: { type: "ask" } });
    expect(askControl({ ...V2, locale: "en" })).toEqual({ label: "Ask a question", action: { type: "ask" } });
    expect(askControl(PANEL)).toBeUndefined();
  });
});
