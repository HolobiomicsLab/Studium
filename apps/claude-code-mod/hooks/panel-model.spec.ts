import { describe, expect, test } from "vitest";

import type { StudiumPanelView } from "../types/index.js";
import {
  answerAction,
  askControl,
  completionMarkdown,
  contestControls,
  errorView,
  calibrationLines,
  feedbackIsStructured,
  feedbackMarkdown,
  navigationLine,
  reviewLine,
  headerLine,
  helpControls,
  isPanelView,
  mapControl,
  mapMarkdown,
  panelFromMcpResult,
  pngPayload,
  promptControls,
  replanAction,
  settingsControls,
  sceneMarkdown,
  sessionLostNotice,
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
    // A view that carries a proposal offers the `prompt` action (task 5.2): it is read, not refused.
    expect(isPanelView({ ...V2, actions: [...V2.actions, "prompt"] })).toBe(true);
    const map = {
      concepts: [{
        id: "c-a", title: "Notion", state: "acquired", establishes: "Établi.", does_not_establish: "Pas établi.",
        evidence: [{ scene_id: "s1", day: "2026-11-06", assessed_by: "key", result: "right", hints: 0 }],
      }],
      edges: [],
    };
    expect(isPanelView({ ...V2, actions: [...V2.actions, "closeMap", "contest"], map })).toBe(true);
  });

  test.each([
    ["orientation", { ...V2, orientation: { step: { index: "2", total: 9 }, reviews_due: 0, waiting: "answer" } }],
    ["waiting", { ...V2, orientation: { ...V2.orientation, waiting: "sleeping" } }],
    ["status line", { ...V2, status_line: 7 }],
    ["voice", { ...V2, voices: { scene: { kind: "narrator" } } }],
    ["help rung", { ...V2, help: { rungs: [{ kind: "reread", available: "yes" }] } }],
    ["missing orientation", { ...V2, orientation: undefined }],
    ["prompts list", { ...V2, prompts: "none" }],
    ["prompt without a reason", { ...V2, prompts: [{ id: "break:1", kind: "break", actions: [] }] }],
    ["prompt answer", { ...V2, prompts: [{ id: "break:1", kind: "break", reason: "26 minutes", actions: [{ label: 3, action: { type: "prompt" } }] }] }],
    // The pane presses the current level: a level it does not know would press none (walkthrough of 7 Nov).
    ["attention", { ...V2, attention: "loud" }],
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

// Walkthrough 2026-11-07: after a server restart, an action on the old session_id fails with « session not found ».
// The pane says the session is lost, how to reopen it, and offers the open of the same lesson for the same learner.
describe("a lost session", () => {
  const LOST = "session not found: sid-42 (the server may have restarted, or the session was closed): call start_lesson_session…";

  test("an action error that starts with « session not found » is a lost session, with the notice, the command and the open", () => {
    const lost = errorView(PANEL, new Error(LOST));
    expect(sessionLostNotice(lost)).toEqual({
      notice: "Séance perdue (le serveur a redémarré ou la séance a été fermée). Rouvre la leçon : ta progression est conservée.",
      button: "Rouvrir la leçon",
      command: "Pour la rouvrir : /studium atomistique-l1/lesson.json",
      open: { bundle_ref: "atomistique-l1/lesson.json", learner_id: "learner-1", surface: "pane" },
    });
    expect(sessionLostNotice({ ...lost, locale: "en" })?.notice)
      .toBe("Session lost (the server restarted or the session was closed). Reopen the lesson: your progress is kept.");
  });

  test("the tool's JSON error envelope is opened; any other error, or a view that is no error, is not a lost session", () => {
    expect(sessionLostNotice(errorView(PANEL, new Error(JSON.stringify({ error: LOST }))))).toBeDefined();
    expect(sessionLostNotice(errorView(PANEL, new Error("offline")))).toBeUndefined();
    expect(sessionLostNotice(errorView(PANEL, new Error("the tool said: session not found")))).toBeUndefined();
    expect(sessionLostNotice({ ...PANEL, message: LOST })).toBeUndefined();
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
    // Walkthrough 2026-11-07: a key verdict says whose key it is, as the conversation does.
    const keyOf = (drafted_by: "agent" | "learner" | "teacher") => ({ ...V2, voices: { scene: { kind: "author" as const, name: null, reviewed: false, drafted_by }, verdict: { kind: "key" as const } } });
    expect(voiceChip(keyOf("agent"), "verdict")).toBe("Évalué par la clé rédigée par l'IA — vérifie-la avec le passage cité");
    expect(voiceChip({ ...keyOf("agent"), locale: "en" }, "verdict")).toBe("Assessed by the AI-drafted key — check it against the cited passage");
    expect(voiceChip(keyOf("learner"), "verdict")).toBe("Évalué par la clé que tu as rédigée");
    expect(voiceChip(keyOf("teacher"), "verdict")).toBe("Évalué par la clé de l'auteur");
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

// INT-STUDIUM-058, task 4.3: the concept map in the pane, as a list in words.
describe("the concept map of a pane", () => {
  const MAP: NonNullable<StudiumPanelView["map"]> = {
    concepts: [
      { id: "a", title: "Particules", state: "acquired", establishes: "Ta dernière réponse notée était juste.", does_not_establish: "Cela ne dit pas que tu t'en souviendras.",
        evidence: [
          { scene_id: "q1", day: "2026-11-05", assessed_by: "key", result: "right", hints: 1 },
          { scene_id: "w1", day: "2026-11-06", assessed_by: "self", result: "rated", hints: 0 },
        ],
        contest: { allowed: true, claim: "unsure", questions: 2, outcome: "refuted" } },
      { id: "b", title: "Orbitales", state: "current", establishes: "C'est la notion de ton étape.", does_not_establish: "La carte ne conclut rien encore.",
        evidence: [{ scene_id: "q2", day: null, assessed_by: "none", result: "recorded", hints: null }],
        contest: { allowed: true, claim: "known", questions: 1 } },
      { id: "c", title: "Spectres", state: "upcoming", establishes: "Pas encore montrée.", does_not_establish: "La carte n'en sait rien.", evidence: [],
        contest: { allowed: false, check_pending: true, claim: "known", questions: 0 } },
    ],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }],
  };
  const CLOSED: StudiumPanelView = { ...PANEL, actions: ["respond", "end", "openMap"] };
  const OPEN: StudiumPanelView = { ...PANEL, actions: ["respond", "end", "closeMap", "contest"], map: MAP };

  test("a view that offers the map has one control for it, which opens or closes it", () => {
    expect(mapControl(PANEL)).toBeUndefined();
    expect(mapControl(CLOSED)).toEqual({ label: "Carte des notions", open: false, action: { type: "openMap" } });
    expect(mapControl(OPEN)).toEqual({ label: "Fermer la carte", open: true, action: { type: "closeMap" } });
    expect(mapControl({ ...OPEN, locale: "en" })).toMatchObject({ label: "Close the map" });
    // The server's words win over the mod's own.
    expect(mapControl({ ...CLOSED, strings: { pane_map_open: "Carte" } })).toMatchObject({ label: "Carte" });
  });

  test("an open map is a list in words: state, prerequisites, checks, scope and answers", () => {
    expect(mapMarkdown(CLOSED)).toBe("");
    expect(mapMarkdown(OPEN)).toBe([
      "**Carte des notions**",
      "",
      "- **Particules** : acquise",
      "  - Dernier contrôle : déclaration non confirmée",
      "  - Ce que cet état établit : Ta dernière réponse notée était juste.",
      "  - Ce qu'il n'établit pas : Cela ne dit pas que tu t'en souviendras.",
      "  - 2026-11-05 · notée avec la clé de l'auteur · juste · 1 indice",
      "  - 2026-11-06 · évaluée par toi · rappel auto-évalué",
      "- **Orbitales** : en cours",
      "  - Prérequis : Particules",
      "  - Ce que cet état établit : C'est la notion de ton étape.",
      "  - Ce qu'il n'établit pas : La carte ne conclut rien encore.",
      "  - jour inconnu · évaluée par personne · enregistrée",
      "- **Spectres** : à venir",
      "  - Prérequis : Particules, Orbitales",
      "  - Contrôle en cours",
      "  - Ce que cet état établit : Pas encore montrée.",
      "  - Ce qu'il n'établit pas : La carte n'en sait rien.",
      "  - Aucune réponse sur cette notion pour l'instant.",
    ].join("\n"));
    expect(mapMarkdown({ ...OPEN, locale: "en" })).toContain("- **Orbitales**: in progress\n  - Needs: Particules");
  });

  test("each concept that can be checked has a claim button, with what the check will be", () => {
    expect(contestControls(CLOSED)).toEqual([]);
    expect(contestControls(OPEN)).toEqual([
      { concept_id: "a", label: "Particules : J'ai un doute", note: "Deux questions de contrôle suivront.", action: { type: "contest", concept_id: "a", claim: "unsure" } },
      { concept_id: "b", label: "Orbitales : Je la connais", note: "Une seule question de contrôle suivra : le résultat sera partiel.", action: { type: "contest", concept_id: "b", claim: "known" } },
    ]);
    // A map without the contest action (an older server) offers no claim.
    expect(contestControls({ ...OPEN, actions: ["respond", "closeMap"] })).toEqual([]);
  });

  test("a view whose map is not a map is refused", () => {
    expect(isPanelView(OPEN)).toBe(true);
    expect(isPanelView({ ...OPEN, map: { concepts: [{ id: "a" }], edges: [] } })).toBe(false);
    expect(isPanelView({ ...OPEN, map: { concepts: MAP.concepts, edges: [{ from: "a" }] } })).toBe(false);
    expect(isPanelView({ ...OPEN, map: { concepts: [{ ...MAP.concepts[0], state: "mastered" }], edges: [] } })).toBe(false);
  });
});

// INT-STUDIUM-058 § 2.6, task 5.2: the server's proposals in the pane.
describe("the proposals of a pane", () => {
  const answer = (id: string, outcome: "accept" | "dismiss") => ({ type: "prompt" as const, id, outcome });
  const REVIEW = {
    id: "review_due:start", kind: "review_due" as const, reason: "3 notions à revoir aujourd'hui", expires: "scene" as const,
    actions: [{ label: "Réviser maintenant", action: answer("review_due:start", "accept") }, { label: "Plus tard", action: answer("review_due:start", "dismiss") }],
  };
  const NOTICE = { id: "adaptation_notice:s1", kind: "adaptation_notice" as const, reason: "Retour sur un prérequis.", expires: "scene" as const, actions: [] };
  const V2: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2", actions: ["respond", "end", "prompt"],
    orientation: { step: { index: 2, total: 9 }, reviews_due: 3, waiting: "read" },
    status_line: "Atomistique · étape 2/9 · à lire",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
    help: { rungs: [] }, prompts: [REVIEW, NOTICE], attention: "normal", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
  };

  test("at a pause each proposal is a reason and one button per answer; a notice is a reason alone", () => {
    expect(promptControls(V2)).toEqual([
      { id: "review_due:start", kind: "review_due", reason: "3 notions à revoir aujourd'hui", buttons: REVIEW.actions },
      { id: "adaptation_notice:s1", kind: "adaptation_notice", reason: "Retour sur un prérequis.", buttons: [] },
    ]);
    expect(promptControls(PANEL)).toEqual([]);                        // a version-1 view carries none
  });

  test("while an answer or a self-rating is owed only notices show", () => {
    for (const waiting of ["answer", "self_rating"] as const) {
      const busy = { ...V2, orientation: { ...V2.orientation!, waiting } };
      expect(promptControls(busy).map(prompt => prompt.kind)).toEqual(["adaptation_notice"]);
    }
  });

  test("a view that does not offer the action a button sends shows the reason without the button", () => {
    expect(promptControls({ ...V2, actions: ["respond", "end"] }).map(prompt => prompt.buttons)).toEqual([[], []]);
  });
});

// INT-STUDIUM-058 F8 (walkthrough of 7 Nov, finding 3): the learner's settings, drawn only from the
// actions the view offers: the attention level, the panel's language, « I have N minutes ».
describe("the settings of a pane", () => {
  const V2: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2",
    actions: ["respond", "end", "ask", "setLanguage", "setAttention", "replan"],
    orientation: { step: { index: 2, total: 9 }, reviews_due: 0, waiting: "answer" },
    status_line: "Atomistique · étape 2/9 · à toi de répondre",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
    help: { rungs: [] }, prompts: [], attention: "quiet", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
  };

  test("the three attention levels, then the two languages, each pressed where the view stands", () => {
    const controls = settingsControls(V2);
    expect(controls.attention).toEqual([
      { key: "attention-quiet", label: "Silencieux", pressed: true, action: { type: "setAttention", level: "quiet" } },
      { key: "attention-normal", label: "Normal", pressed: false, action: { type: "setAttention", level: "normal" } },
      { key: "attention-coached", label: "Accompagné", pressed: false, action: { type: "setAttention", level: "coached" } },
    ]);
    expect(controls.languages).toEqual([
      { key: "language-fr", label: "FR", pressed: true, action: { type: "setLanguage", presentation_language: "fr" } },
      { key: "language-en", label: "EN", pressed: false, action: { type: "setLanguage", presentation_language: "en" } },
    ]);
    expect(controls.replan).toEqual({ label: "Minutes disponibles", submit: "Replanifier" });
    expect(settingsControls({ ...V2, locale: "en", strings: {} }).attention.map(control => control.label)).toEqual(["Quiet", "Normal", "Coached"]);
  });

  test("a setting the view does not offer is not drawn", () => {
    const attentionOnly = settingsControls({ ...V2, actions: ["respond", "setAttention"] });
    expect(attentionOnly.attention).toHaveLength(3);
    expect(attentionOnly.languages).toEqual([]);
    expect(attentionOnly.replan).toBeUndefined();
    expect(settingsControls(PANEL)).toEqual({ attention: [], languages: [] });
  });

  test("the minutes typed for a replan become the action, or are refused in one line", () => {
    expect(replanAction(V2, " 15 ")).toEqual({ type: "replan", minutes: 15 });
    for (const raw of ["", "0", "601", "dix", "2.5"]) expect(() => replanAction(V2, raw)).toThrow(/1.*600/);
  });
});

// Fix 2026-11-10 (A13, B16): one source for the feedback, the reason of a detour or a replay, and the
// facts the view validates (reviews due, next review, calibration).
describe("pane model: one source for feedback, navigation reason, review and calibration facts", () => {
  const WRONG: StudiumPanelView = {
    ...PANEL, locale: "en", strings: {},
    verdict: {
      scene_id: "s1", graded: true, correct: false, feedback: "Not quite.", key_points: ["30 neutrons"],
      model_answer: "A + Z", reference_kind: "correct_choice",
      display_markdown: "**Wrong.** Not quite.\n\n**The right answer:**\n- 30 neutrons",
    },
  };

  test("structured fields: the feedback once, the reference under the label of its kind, never display_markdown", () => {
    const text = feedbackMarkdown(WRONG);
    expect(feedbackIsStructured(WRONG)).toBe(true);
    expect(text.match(/Not quite\./g)).toHaveLength(1);
    expect(text).toContain("**The right answer**\n- 30 neutrons");
    expect(text).not.toContain("Key points");
    expect(text).not.toContain("**Wrong.**");
    expect(text).toContain("A + Z");
  });

  test.each([
    ["key_points", "Key points"], ["planted_flaws", "Planted flaws"],
    ["flawed_claims", "Claims that hid a flaw"], [undefined, "Key points"],
  ])("reference_kind %s is labelled %s", (kind, label) => {
    const view = { ...WRONG, verdict: { ...WRONG.verdict!, reference_kind: kind } };
    expect(feedbackMarkdown(view)).toContain(`**${label}**`);
  });

  test("a judge's missing key point is marked once, in the list", () => {
    const view = { ...WRONG, verdict: { ...WRONG.verdict!, reference_kind: "key_points", key_points_missing: ["30 neutrons"] } };
    expect(feedbackMarkdown(view).match(/missing, per the judge/g)).toHaveLength(1);
  });

  test("without structured fields display_markdown stands alone", () => {
    const view = { ...PANEL, verdict: { scene_id: "s1", graded: true, display_markdown: "**Bravo.** Tout est dit." } };
    expect(feedbackIsStructured(view)).toBe(false);
    expect(feedbackMarkdown(view)).toBe("**Bravo.** Tout est dit.");
  });

  test("navigation: the detour and the replay say why, in the HTML panel's words", () => {
    const detour = { ...WRONG, navigation: { kind: "remediate" as const, returns_to: "s9" } };
    expect(navigationLine(detour)).toBe("A short detour: First a concept the next steps rely on, then back to where you were.");
    const replay = { ...PANEL, navigation: { kind: "replay" as const } };
    expect(navigationLine(replay)).toBe("On refait cette étape ensemble : Une deuxième tentative aide à fixer la notion. Ce n'est pas une sanction : relis tranquillement avant de répondre.");
    expect(navigationLine({ ...PANEL, navigation: { kind: "advance" as const } })).toBe("");
    expect(navigationLine(PANEL)).toBe("");
    expect(navigationLine({ ...PANEL, strings: { pane_gate_replay: "A", pane_nav_replay_why: "B" }, navigation: { kind: "replay" as const } })).toBe("A : B");
  });

  test("the step line of a version-1 view carries the reviews due, only when there are some", () => {
    expect(headerLine(PANEL)).toBe("Étape 2 sur 9");
    expect(headerLine({ ...PANEL, reviewDue: [{ id: "c1", label: "Isotopes" }, { id: "c2", label: "Ions" }] })).toBe("Étape 2 sur 9 · 2 à réviser");
    expect(headerLine({ ...PANEL, locale: "en", strings: {}, reviewDue: [{ id: "c1", label: "A" }] })).toBe("Step 2 of 9 · 1 to review");
  });

  test("the completion line: reviews due now, else the next review date, else nothing", () => {
    const done = (completion: Partial<NonNullable<StudiumPanelView["completion"]>>): StudiumPanelView => ({
      ...PANEL, locale: "en", strings: {}, kind: "done",
      completion: { consolidated: [], practised: [], not_measured: [], detours: 0, next_review_at: null, due_now: 0, actions: [], ...completion },
    });
    expect(reviewLine(done({}))).toBe("");
    expect(reviewLine(done({ due_now: 3 }))).toBe("Reviews due now: 3");
    expect(reviewLine(done({ next_review_at: Date.UTC(2026, 10, 12, 12) }))).toBe("Next review: Thursday, November 12");
    expect(completionMarkdown(done({ due_now: 3 }))).toContain("Reviews due now: 3");
    expect(completionMarkdown(done({}))).not.toContain("review");
  });

  test("calibration: only the actionable bands, at most two, number-free", () => {
    const view: StudiumPanelView = {
      ...PANEL, locale: "en", strings: {},
      calibration: [
        { concept_id: "c1", band: "bien", message: "Well calibrated." },
        { concept_id: "c2", band: "sur", message: "You were surer than your answers." },
        { concept_id: "c3", band: "sous", message: "You know more than you think." },
        { concept_id: "c4", band: "sur", message: "Third." },
      ],
    };
    expect(calibrationLines(view)).toEqual([
      "**Overconfidence:** You were surer than your answers.", "**Underconfidence:** You know more than you think.",
    ]);
    expect(calibrationLines({ ...view, calibration: [{ concept_id: "c1", band: "bien", message: "ok" }] })).toEqual([]);
  });
});
