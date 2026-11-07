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

// INT-STUDIUM-058 § 2.6, task 5.2: a proposal of the server is a reason and one button per answer.
test("the pane draws a proposal with its reason and a button per answer", async ($, on) => {
  const answer = (outcome: "accept" | "dismiss") => ({ type: "prompt" as const, id: "review_due:start", outcome });
  const PROPOSING: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2", actions: ["respond", "end", "prompt"],
    scene: { id: "s0-intro", type: "concept", title: "Une page", markdown: "À lire." },
    orientation: { step: { index: 1, total: 9 }, reviews_due: 3, waiting: "read" },
    status_line: "Atomistique · étape 1/9 · à lire",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
    help: { rungs: [] }, attention: "normal", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
    prompts: [{
      id: "review_due:start", kind: "review_due", reason: "3 notions à revoir aujourd'hui", expires: "scene",
      actions: [{ label: "Réviser maintenant", action: answer("accept") }, { label: "Plus tard", action: answer("dismiss") }],
    }],
  };
  on("state.get", () => ({
    value: { value: { shape: "panel-view-1", value: PROPOSING }, version: 1 },
  }));

  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Text", text: /3 notions à revoir aujourd'hui/ })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "prompt-review_due:start-0" })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "prompt-review_due:start-1" })).toBeDefined();
    await ui.unmount();
  }
});

// INT-STUDIUM-058 F8: the learner's settings, after the help ladder and before the proposals.
test("the pane draws the attention levels, the languages and the replan field a view offers", async ($, on) => {
  const SETTINGS: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2", actions: ["respond", "end", "setLanguage", "setAttention", "replan"],
    orientation: { step: { index: 2, total: 9 }, reviews_due: 0, waiting: "answer" },
    status_line: "Atomistique · étape 2/9 · à toi de répondre",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
    help: { rungs: [] }, prompts: [], attention: "quiet", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
  };
  on("state.get", () => ({
    value: { value: { shape: "panel-view-1", value: SETTINGS }, version: 1 },
  }));

  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    for (const key of ["attention-quiet", "attention-normal", "attention-coached", "language-fr", "language-en"]) {
      expect(await ui.find({ type: "Button", key })).toBeDefined();
    }
    // The mobile app draws no text field: the pane names the command instead.
    if (surface === "mobile") expect(await ui.find({ type: "Text", text: /\/studium replan <minutes>/ })).toBeDefined();
    else expect(await ui.find({ type: "Input", key: "replan" })).toBeDefined();
    await ui.unmount();
  }
});

// Walkthrough 2026-11-07: an action on a session the server lost shows the notice, the reopen button and the command,
// in place of the stale scene; any other action error keeps its error line.
test("a lost session shows the notice, a reopen button and the command; another error keeps its line", async ($, on) => {
  const LOST: StudiumPanelView = {
    ...PANEL, kind: "error", message: "session not found: sid-42 (the server may have restarted, or the session was closed): call start_lesson_session…",
  };
  let stored: StudiumPanelView = LOST;
  on("state.get", () => ({ value: { value: { shape: "panel-view-1", value: stored }, version: 1 } }));

  for (const surface of ["terminal", "desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Text", text: /^Séance perdue \(le serveur a redémarré ou la séance a été fermée\)\./ })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "reopen" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /\/studium atomistique-l1\/lesson\.json/ })).toBeDefined();
    expect(await ui.find({ type: "Button", key: "hint" })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /sid-42/ })).toBeUndefined();
    await ui.unmount();
  }

  stored = { ...PANEL, kind: "error", message: "offline" };
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
  expect(await ui.find({ type: "Text", text: /^offline$/ })).toBeDefined();
  expect(await ui.find({ type: "Button", key: "reopen" })).toBeUndefined();
  await ui.unmount();
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
