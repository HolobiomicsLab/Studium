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
