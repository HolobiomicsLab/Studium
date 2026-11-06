import { expect, test } from "claude-code/testing";
import type { StudiumPanelView } from "../types/index.js";

const PANE = {
  plugin: "studium-panel",
  component: "Pane",
  requestId: "studium",
  props: {
    title: "Studium",
    isFocused: false,
    bodyColumns: 60,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const;

const PANEL: StudiumPanelView = {
  schema: "studium/panel-view/1",
  kind: "scene",
  session_id: "session-1",
  learner_id: "learner-1",
  bundle_ref: "atomistique-l1/lesson.json",
  lesson_title: "Atomistique",
  locale: "fr",
  strings: { pane_hint: "Indice" },
  progress: { index: 2, total: 9 },
  scene: {
    id: "s1-quiz-fer",
    type: "quiz",
    title: "Quiz : l'atome de fer (Z=26)",
    question: "L'isotope ⁵⁶Fe a Z=26. Combien contient-il de neutrons ?",
    choices: [
      { id: "a", text: "26" },
      { id: "b", text: "30" },
      { id: "c", text: "56" },
      { id: "d", text: "82" },
    ],
  },
  scene_assets: [],
  modalityPreference: "balanced",
  reviewDue: [],
  calibration: [],
  mastery: {},
  actions: ["respond", "hint", "end"],
};

test("the pane draws the P1 quiz view on every Claude Code surface", async ($, on) => {
  on("state.get", () => ({
    value: { value: { shape: "panel-view-1", value: PANEL }, version: 1 },
  }));

  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Markdown", text: /Combien contient-il/ })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "choice-b" })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "hint" })).toBeDefined();
    await ui.unmount();
  }
});

// INT-STUDIUM-058, task 2.5: a version-2 view shows its status line, its voices, its help ladder and
// the gesture that hands over to the assistant.
test("the pane draws the status line, the voices, the help ladder and the ask button of a version-2 view", async ($, on) => {
  const V2: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2",
    actions: ["respond", "hint", "end", "ask"],
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
  on("state.get", () => ({
    value: { value: { shape: "panel-view-1", value: V2 }, version: 1 },
  }));

  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Text", text: /étape 2\/9 · 12 min/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Leçon validée par Prof\. Test/ })).toBeDefined();
    for (const key of ["help-reread", "help-hint", "help-explain", "help-reference", "ask"]) {
      expect(await ui.find({ type: "Button", key })).toBeDefined();
    }
    await ui.unmount();
  }
});

// INT-STUDIUM-058, task 4.3: the concept map as a list, its button, a claim button and the view's message.
test("the pane draws the map as a list, with its button, a claim button and the message of the scene", async ($, on) => {
  const OPEN: StudiumPanelView = {
    ...PANEL, actions: ["respond", "end", "closeMap", "contest"],
    message: "Deux questions de contrôle sur cette notion.",
    map: {
      concepts: [{
        id: "c-particules", title: "Particules", state: "acquired",
        establishes: "Ta dernière réponse notée était juste.", does_not_establish: "Cela ne dit pas que tu t'en souviendras.",
        evidence: [{ scene_id: "s1-quiz-fer", day: "2026-11-06", assessed_by: "key", result: "right", hints: 0 }],
        contest: { allowed: true, claim: "unsure", questions: 2 },
      }],
      edges: [],
    },
  };
  on("state.get", () => ({
    value: { value: { shape: "panel-view-1", value: OPEN }, version: 1 },
  }));

  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Markdown", text: /\*\*Particules\*\* : acquise/ })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "map" })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "contest-c-particules" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Deux questions de contrôle sur cette notion/ })).toBeDefined();
    await ui.unmount();
  }
});

test("a stored value with an older shape is declined cleanly", async ($, on) => {
  on("state.get", () => ({ value: { value: PANEL, version: 1 } }));
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });

  expect((await ui.find({ type: "Text", text: /No compatible lesson view/ }))?.text)
    .toBe("No compatible lesson view. Run /studium <bundle_ref>.");
  await ui.unmount();
});

test("a malformed value with the current shape is declined cleanly", async ($, on) => {
  on("state.get", () => ({
    value: { value: { shape: "panel-view-1", value: { ...PANEL, progress: null } }, version: 1 },
  }));
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });

  expect((await ui.find({ type: "Text", text: /No compatible lesson view/ }))?.text)
    .toBe("No compatible lesson view. Run /studium <bundle_ref>.");
  await ui.unmount();
});
