import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { presentPanel, applyPanelAction, PanelViewSchema, PanelActionSchema, type PanelContext } from "./index.js";

const lesson = JSON.parse(readFileSync(new URL("../../../fixtures/atomistique-l1/lesson.json", import.meta.url), "utf8"));
const scene = lesson.scenes.find((s: { type: string }) => s.type === "quiz");
function setup() {
  const presentation = { scene, index: 1, total: lesson.scenes.length, locale: "fr", learnerSnapshot: { conceptMastery: { c1: 0.8 } } };
  const ctx: PanelContext = { sessionId: "s1", learnerId: "ana", bundleRef: "atomistique-l1/lesson.json", lessonTitle: lesson.metadata.title, conceptTitles: { c1: "Concept 1" } };
  const backend = {
    getCurrentScene: vi.fn(async () => presentation), getSceneArtifacts: vi.fn(async () => [{ kind: "code", payload: "x" }, { kind: "image", path: "p.png" }]),
    getSessionState: vi.fn(async () => ({ concept_states: {}, history: [] })),
    submitResponse: vi.fn(async () => ({ kind: "next", presentation, verdict: { scene_id: "previous", graded: true, correct: true }, navigation: { kind: "advance" }, self_rating: { requested: true, scene_id: "previous", grades: ["again", "hard", "good", "easy"] } })),
    submitTurn: vi.fn(async () => ({ reasoning: { signal: "evidence" }, tutor: { text: "Pourquoi ?" } })),
    requestHint: vi.fn(async () => ({ hint: "Indice", remaining: 1 })),
    rateRecall: vi.fn(async () => ({ next_review_at: 2000, concept_id: "c1" })),
    startReviewSession: vi.fn(async () => ({ status: "started", session_id: "review", presentation, review: { items: [{ concept_id: "c1", concept: "Notion", scene_id: scene.id, bundle_ref: "other/lesson.json" }] } })),
    startLessonSession: vi.fn(async () => ({ session_id: "restart", presentation })), forgetSession: vi.fn(async () => ({})),
    getNextReinforcement: vi.fn(async () => ({ due: [], relearn: [], unmeasured: [] })),
    inlineImage: vi.fn(async (asset) => ({ ...asset, dataUri: "data:image/png;base64,eA==" })),
  };
  return { ctx, backend, presentation };
}

describe("shared panel contract", () => {
  it("redacts the fixture key recursively, orders assets and gates mastery", async () => {
    const { ctx, backend, presentation } = setup();
    presentation.scene = { ...scene, key_points: [{ answer: "x", expected: "x", key: "x", solution: "x" }] };
    ctx.modalityPreference = "visual";
    const panel = await presentPanel(backend, ctx);
    expect(JSON.stringify(panel)).not.toMatch(/"(?:answer|correct|expected|key|solution)"\s*:/);
    expect(panel).toMatchObject({ schema: "studium/panel-view/1", kind: "scene", progress: { index: 2, total: lesson.scenes.length }, mastery: {}, reviewDue: [], calibration: [] });
    expect(panel.scene_assets.map(a => a.kind)).toEqual(["image", "code"]);
    expect(panel.scene_assets[0]?.emphasis).toBe("expanded");
    expect(PanelViewSchema.parse(panel)).toEqual(panel);
    ctx.showMastery = true;
    expect((await presentPanel(backend, ctx)).mastery).toEqual({ c1: 0.8 });
  });
  it("fails closed on unexpected answer metadata instead of inventing another redactor", async () => {
    const { ctx, backend, presentation } = setup();
    presentation.scene = { ...scene, metadata: { answer: "secret" } };
    await expect(presentPanel(backend, ctx)).rejects.toThrow(/answer/);
  });
  it("respond retains verdict, navigation and self-rating", async () => {
    const { ctx, backend } = setup();
    const panel = await applyPanelAction(backend, ctx, { type: "respond", input: { kind: "ack" } });
    expect(panel).toMatchObject({ verdict: { correct: true }, navigation: { kind: "advance" }, self_rating: { scene_id: "previous" } });
    expect(backend.submitResponse).toHaveBeenCalledWith("s1", { kind: "ack" });
  });
  it("turn preserves the scene and returns the tutor", async () => {
    const { ctx, backend } = setup();
    expect(await applyPanelAction(backend, ctx, { type: "turn", text: "why" })).toMatchObject({ turn_result: { tutor: { text: "Pourquoi ?" } }, scene: { id: scene.id } });
  });
  it("hint returns metered hint fields", async () => {
    const { ctx, backend } = setup();
    expect(await applyPanelAction(backend, ctx, { type: "hint" })).toMatchObject({ hint: { hint: "Indice", remaining: 1 } });
    expect(await presentPanel(backend, ctx)).toMatchObject({ hint: { hint: "Indice", remaining: 1 } });
  });
  it("rateRecall updates the completed lesson's review date", async () => {
    const { ctx, backend } = setup();
    ctx.transition = { kind: "complete", summary: { scenesCompleted: 2, finalState: {}, mastery: {} }, review_plan: { next_due_at: 1000, concepts: ["c1"] } };
    const panel = await applyPanelAction(backend, ctx, { type: "rateRecall", sceneId: "previous", grade: "good" });
    expect(panel).toMatchObject({ kind: "done", recall_rated: { sceneId: "previous", grade: "good" }, completion: { next_review_at: 2000 } });
  });
  it("reviewNow switches session and resolves assets against their originating lesson", async () => {
    const { ctx, backend } = setup();
    expect(await applyPanelAction(backend, ctx, { type: "reviewNow" })).toMatchObject({ session_id: "review" });
    expect(backend.inlineImage).toHaveBeenCalledWith(expect.anything(), "other/lesson.json");
  });
  it("reviewNow with nothing due keeps the current scene and names the next date", async () => {
    const { ctx, backend } = setup();
    backend.startReviewSession.mockResolvedValue({ status: "nothing_due", next_review_at: 1793700000000 } as never);
    expect(await applyPanelAction(backend, ctx, { type: "reviewNow" })).toMatchObject({ kind: "notice", session_id: "s1", scene: { id: scene.id }, message: expect.stringContaining("2026") });
  });
  it("restartLesson starts the original lesson and clears transition feedback", async () => {
    const { ctx, backend } = setup();
    ctx.transition = { kind: "complete" };
    expect(await applyPanelAction(backend, ctx, { type: "restartLesson" })).toMatchObject({ kind: "scene", session_id: "restart" });
    expect(backend.startLessonSession).toHaveBeenCalledWith(ctx.bundleRef, "ana");
  });
  it("end requires confirmation and does not read an erased session", async () => {
    const { ctx, backend } = setup();
    expect(await applyPanelAction(backend, ctx, { type: "end", confirmed: false })).toMatchObject({ kind: "scene", actions: expect.arrayContaining(["end"]) });
    expect(backend.forgetSession).not.toHaveBeenCalled();
    backend.getCurrentScene.mockClear();
    expect(await applyPanelAction(backend, ctx, { type: "end", confirmed: true })).toMatchObject({ kind: "notice", actions: ["pickCourse"] });
    expect(backend.forgetSession).toHaveBeenCalledOnce();
    expect(backend.getCurrentScene).not.toHaveBeenCalled();
  });
  it("pickCourse remains a host-side action", async () => {
    const { ctx, backend } = setup();
    expect(await applyPanelAction(backend, ctx, { type: "pickCourse" })).toMatchObject({ actions: expect.arrayContaining(["pickCourse"]) });
    expect(backend.startLessonSession).not.toHaveBeenCalled();
  });
  it("validates actions before invoking the backend", () => {
    expect(PanelActionSchema.safeParse({ type: "end" }).success).toBe(false);
    expect(PanelActionSchema.safeParse({ type: "rateRecall", sceneId: "s", grade: "perfect" }).success).toBe(false);
  });
  it("validates nested scene, verdict, navigation and self-rating fields", async () => {
    const { ctx, backend } = setup();
    const panel = await presentPanel(backend, ctx);
    for (const change of [
      { scene: { ...panel.scene, id: 7 } }, { verdict: { scene_id: "s", graded: true, correct: "yes" } },
      { navigation: { kind: 31 } }, { self_rating: { requested: true, grades: ["perfect"] } },
    ]) expect(PanelViewSchema.safeParse({ ...panel, ...change }).success).toBe(false);
  });
  it("keeps the number-free calibration and named overdue review cues", async () => {
    const { ctx, backend } = setup();
    ctx.now = () => Date.parse("2026-11-01T00:00:00Z");
    backend.getSessionState.mockResolvedValue({
      concept_states: { c1: { concept_id: "c1", total_attempts: 1, calibration_samples: 1, confidence_calibration: 0.7 } },
      history: [{ timestamp: "2026-01-01T00:00:00Z", signal: { kind: "answer_submitted", concept_id: "c1", correct: true, hint_count: 0 } }],
    } as never);
    const panel = await presentPanel(backend, ctx);
    expect(panel.reviewDue).toEqual([{ id: "c1", label: "Concept 1" }]);
    expect(panel.calibration).toEqual([{ concept_id: "c1", band: "sur", message: expect.any(String) }]);
    expect(JSON.stringify(panel)).not.toContain("confidence_calibration");
  });
});

// INT-STUDIUM-058, lot 1, task 1.4: version 2 of the view adds where the learner is, who speaks and
// which help is open. A reader of version 1 still reads its views; a backend that cannot give the
// orientation still writes version 1.
describe("panel view version 2", () => {
  const extras = {
    orientation: { step: { index: 2, total: 3 }, reviews_due: 0, waiting: "answer" as const },
    status_line: "Leçon · étape 2/3 · à toi de répondre",
    voices: { scene: { kind: "author" as const, name: "Prof. Test", reviewed: true, drafted_by: "teacher" as const } },
    help: { rungs: [{ kind: "reread" as const, available: true }, { kind: "explain" as const, available: false, why_not: "essaie d'abord de répondre" }] },
  };
  const recorded = () => JSON.parse(readFileSync(new URL("../test-support/panel-view-1.json", import.meta.url), "utf8"));

  it("writes version 2 with the orientation, the status line, the voices and the help the backend gives", async () => {
    const { ctx, backend } = setup();
    const getOrientation = vi.fn(async () => extras);
    const panel = await presentPanel({ ...backend, getOrientation }, ctx);
    expect(panel).toMatchObject({
      schema: "studium/panel-view/2", ...extras, prompts: [], attention: "normal",
      surface: { rank: 3, kind: "panel", available: ["text", "panel"] },
    });
    expect(getOrientation).toHaveBeenCalledWith("s1", { locale: "fr", lessonTitle: lesson.metadata.title, verdict: null });
    expect(PanelViewSchema.parse(panel)).toEqual(panel);
    expect(JSON.stringify(panel)).not.toMatch(/"(?:answer|correct|expected|key|solution)"\s*:/);
  });

  it("hands the verdict of the answer just given to the backend, which tells its voice", async () => {
    const { ctx, backend } = setup();
    const getOrientation = vi.fn(async () => ({ ...extras, voices: { ...extras.voices, verdict: { kind: "key" as const } } }));
    const panel = await applyPanelAction({ ...backend, getOrientation }, ctx, { type: "respond", input: { kind: "ack" } });
    expect(getOrientation).toHaveBeenCalledWith("s1", expect.objectContaining({ verdict: expect.objectContaining({ scene_id: "previous" }) }));
    expect(panel.voices).toEqual({ scene: extras.voices.scene, verdict: { kind: "key" } });
  });

  it("carries the surface and the attention level the host set", async () => {
    const { ctx, backend } = setup();
    ctx.surface = { rank: 2, kind: "form", available: ["text", "form"] };
    ctx.attention = "quiet";
    const panel = await presentPanel({ ...backend, getOrientation: vi.fn(async () => extras) }, ctx);
    expect(panel).toMatchObject({ surface: { rank: 2, kind: "form", available: ["text", "form"] }, attention: "quiet" });
  });

  it("writes version 1, with no orientation, when the backend cannot give one", async () => {
    const { ctx, backend } = setup();
    const panel = await presentPanel(backend, ctx);
    expect(panel.schema).toBe("studium/panel-view/1");
    for (const field of ["orientation", "status_line", "voices", "help", "prompts", "attention", "surface"]) expect(panel).not.toHaveProperty(field);
  });

  it("still reads a version-1 view recorded from the server before version 2", () => {
    const view = recorded();
    expect(view.schema).toBe("studium/panel-view/1");
    expect(PanelViewSchema.parse(view)).toEqual(view);
  });

  it("refuses a version-2 view that lacks what version 2 promises, and a status line over 80 characters", () => {
    const view = recorded();
    expect(PanelViewSchema.safeParse({ ...view, schema: "studium/panel-view/2" }).success).toBe(false);
    const complete = { ...view, schema: "studium/panel-view/2", ...extras, prompts: [], attention: "normal", surface: { rank: 3, kind: "panel", available: ["text", "panel"] } };
    expect(PanelViewSchema.safeParse(complete).success).toBe(true);
    expect(PanelViewSchema.safeParse({ ...complete, status_line: "x".repeat(81) }).success).toBe(false);
  });

  it("keeps the contest's check question in the orientation, and reads one without it", () => {
    const view = recorded();
    const base = { ...view, schema: "studium/panel-view/2", ...extras, prompts: [], attention: "normal", surface: { rank: 3, kind: "panel", available: ["text", "panel"] } };
    const check = { ...base, orientation: { ...extras.orientation, contest: { concept_id: "c-un", question: 1, total: 2 } } };
    expect(PanelViewSchema.parse(check)).toEqual(check);
    expect(PanelViewSchema.parse(base)).toEqual(base);
    expect(PanelViewSchema.safeParse({ ...check, orientation: { ...check.orientation, contest: { concept_id: "c-un" } } }).success).toBe(false);
  });

  it("shows the notice of a forgotten session without an orientation: there is no session to place the learner in", async () => {
    const { ctx, backend } = setup();
    const v2 = { ...backend, getOrientation: vi.fn(async () => extras) };
    await presentPanel(v2, ctx);
    const notice = await applyPanelAction(v2, ctx, { type: "end", confirmed: true });
    expect(notice).toMatchObject({ schema: "studium/panel-view/1", kind: "notice" });
    expect(notice).not.toHaveProperty("orientation");
    expect(notice).not.toHaveProperty("status_line");
  });
});

// INT-STUDIUM-058, lot 2, task 2.2: four acts of the fast lane that need no model turn. The learner
// changes the language, says how much the session may propose, says how much time they have, or hands
// over to the conversation to ask a question.
describe("panel actions: language, attention, replan and ask", () => {
  /** A backend that places the learner: version-2 views, with a status line in the asked language. */
  function placing(backend: ReturnType<typeof setup>["backend"], place: { minutes_left?: number; reviews_due?: number } = {}) {
    const getOrientation = vi.fn(async (_id: string, ask: { locale: "fr" | "en" }) => ({
      orientation: { step: { index: 2, total: 3 }, reviews_due: place.reviews_due ?? 0, waiting: "answer" as const, ...(place.minutes_left === undefined ? {} : { minutes_left: place.minutes_left }) },
      status_line: ask.locale === "en" ? "Lesson · step 2/3 · your answer" : "Leçon · étape 2/3 · à toi de répondre",
      voices: { scene: { kind: "author" as const, name: null, reviewed: true, drafted_by: "teacher" as const } },
      help: { rungs: [{ kind: "reread" as const, available: true }] },
    }));
    const setSessionLanguage = vi.fn(async () => ({}));
    return { ...backend, getOrientation, setSessionLanguage };
  }

  it("setLanguage shows the view in the asked language, and null returns to the lesson's", async () => {
    const { ctx, backend } = setup();
    const b = placing(backend);
    const en = await applyPanelAction(b, ctx, { type: "setLanguage", presentation_language: "en" });
    expect(en).toMatchObject({ locale: "en", status_line: "Lesson · step 2/3 · your answer", kind: "scene" });
    expect(en.strings["panel_review_unavailable"]).toBe("The review session could not start.");
    expect(b.setSessionLanguage).toHaveBeenLastCalledWith("s1", "en");
    // A regional tag keeps its base language for the panel.
    expect((await applyPanelAction(b, ctx, { type: "setLanguage", presentation_language: "en-GB" })).locale).toBe("en");
    const back = await applyPanelAction(b, ctx, { type: "setLanguage", presentation_language: null });
    expect(back).toMatchObject({ locale: "fr", status_line: "Leçon · étape 2/3 · à toi de répondre" });
    expect(b.setSessionLanguage).toHaveBeenLastCalledWith("s1", null);
  });

  it("setLanguage to a language the panel has no text for says so, and keeps the scene", async () => {
    const { ctx, backend } = setup();
    const b = placing(backend);
    const es = await applyPanelAction(b, ctx, { type: "setLanguage", presentation_language: "es" });
    expect(es).toMatchObject({ kind: "notice", locale: "fr", scene: { id: scene.id } });
    expect(es.message).toContain("français ou en anglais");
    // The session still notes it: the conversation can answer in that language.
    expect(b.setSessionLanguage).toHaveBeenLastCalledWith("s1", "es");
  });

  it("setAttention changes how much the session may propose", async () => {
    const { ctx, backend } = setup();
    const b = placing(backend);
    expect((await presentPanel(b, ctx)).attention).toBe("normal");
    expect((await applyPanelAction(b, ctx, { type: "setAttention", level: "quiet" })).attention).toBe("quiet");
    expect((await presentPanel(b, ctx)).attention).toBe("quiet");
  });

  it("replan answers « I have ten minutes » with a prompt whose reason cites them", async () => {
    const { ctx, backend } = setup();
    const longer = await applyPanelAction(placing(backend, { minutes_left: 74 }), ctx, { type: "replan", minutes: 10 });
    expect(longer.prompts).toEqual([{ id: "replan", kind: "replan", reason: expect.stringContaining("10 min"), actions: [], expires: "scene" }]);
    expect(longer.prompts![0]!.reason).toContain("74");
    expect(longer.prompts![0]!.reason).toContain("progression est gardée");
    expect(longer).toMatchObject({ kind: "scene", scene: { id: scene.id } });
    // The lesson fits in the time given.
    const fits = await applyPanelAction(placing(backend, { minutes_left: 8 }), ctx, { type: "replan", minutes: 10 });
    expect(fits.prompts![0]!.reason).toMatch(/10 min.*8 min.*finir/);
    // Reviews due come first, with the one action that starts them.
    const due = await applyPanelAction(placing(backend, { minutes_left: 74, reviews_due: 2 }), ctx, { type: "replan", minutes: 10 });
    expect(due.prompts![0]!.reason).toContain("2 révisions sont dues");
    expect(due.prompts![0]!.actions).toEqual([{ label: "Réviser maintenant", action: { type: "reviewNow" } }]);
    // No duration known: the minutes are still cited.
    const open = await applyPanelAction(placing(backend), ctx, { type: "replan", minutes: 10 });
    expect(open.prompts![0]!.reason).toContain("10 min");
    // Asked again, the prompt is replaced, not stacked; it leaves with the scene.
    expect(open.prompts).toHaveLength(1);
    expect((await applyPanelAction(placing(backend), ctx, { type: "respond", input: { kind: "ack" } })).prompts).toEqual([]);
  });

  it("replan on a backend that cannot place the learner answers with a notice that cites the minutes", async () => {
    const { ctx, backend } = setup();
    const view = await applyPanelAction(backend, ctx, { type: "replan", minutes: 10 });
    expect(view).toMatchObject({ schema: "studium/panel-view/1", kind: "notice", scene: { id: scene.id } });
    expect(view.message).toContain("10 min");
  });

  it("ask hands over to the conversation: a notice, the scene unchanged, nothing submitted", async () => {
    const { ctx, backend } = setup();
    const b = placing(backend);
    const before = await presentPanel(b, ctx);
    const asked = await applyPanelAction(b, ctx, { type: "ask", text: "Pourquoi Z définit-il l'élément ?" });
    expect(asked).toMatchObject({ kind: "notice", scene: before.scene, progress: before.progress, status_line: before.status_line });
    expect(asked.message).toContain("conversation");
    expect(backend.submitResponse).not.toHaveBeenCalled();
    // The question is kept for the companion's brief; without one, nothing is kept.
    expect(ctx.question).toBe("Pourquoi Z définit-il l'élément ?");
    await applyPanelAction(b, ctx, { type: "ask" });
    expect(ctx.question).toBeUndefined();
  });

  it("offers the four actions on a version-2 scene, not on a version-1 view", async () => {
    const { ctx, backend } = setup();
    expect((await presentPanel(placing(backend), ctx)).actions).toEqual(expect.arrayContaining(["ask", "setLanguage", "setAttention", "replan"]));
    const v1 = (await presentPanel(backend, { ...ctx })).actions;
    for (const name of ["ask", "setLanguage", "setAttention", "replan"]) expect(v1).not.toContain(name);
  });

  it("refuses an unknown or malformed action in one line", async () => {
    const { ctx, backend } = setup();
    const unknown = await applyPanelAction(backend, ctx, { type: "teleport" } as never).catch((e: Error) => e.message);
    expect(unknown).toMatch(/^unknown panel action "teleport"; known: respond, /);
    expect(unknown).not.toContain("\n");
    const malformed = await applyPanelAction(backend, ctx, { type: "replan", minutes: 0 } as never).catch((e: Error) => e.message);
    expect(malformed).toMatch(/^invalid replan action: minutes/);
    expect(malformed).not.toContain("\n");
    expect(await applyPanelAction(backend, ctx, "respond" as never).catch((e: Error) => e.message)).toMatch(/^a panel action is an object with a type/);
  });
});

// INT-STUDIUM-058 § 2.6, task 5.2: the server's prompts on the view, answered by the `prompt` action.
describe("the server's prompts on the view", () => {
  const extras = {
    orientation: { step: { index: 2, total: 3 }, reviews_due: 3, waiting: "read" as const },
    status_line: "Leçon · étape 2/3 · à lire",
    voices: { scene: { kind: "author" as const, name: "Prof. Test", reviewed: true, drafted_by: "teacher" as const } },
    help: { rungs: [{ kind: "reread" as const, available: true }] },
  };
  type Served = { id: string; kind: string; reason: string; expires: "scene" | "session" };
  const REVIEW: Served = { id: "review_due:start", kind: "review_due", reason: "3 notions à revoir aujourd'hui", expires: "scene" };
  /** A backend whose book holds `open`; a settled prompt leaves it, an unknown one is refused in the server's words. */
  function prompting(backend: ReturnType<typeof setup>["backend"], open: Served[]) {
    const getPrompts = vi.fn(async () => open.map(prompt => ({ ...prompt })));
    const settlePrompt = vi.fn(async (_id: string, promptId: string) => {
      const at = open.findIndex(prompt => prompt.id === promptId);
      if (at < 0) throw new Error(`no open prompt "${promptId}"`);
      return { kind: open.splice(at, 1)[0]!.kind };
    });
    return { ...backend, getOrientation: vi.fn(async () => extras), getPrompts, settlePrompt };
  }
  const accept = (id: string) => ({ type: "prompt" as const, id, outcome: "accept" as const });
  const dismiss = (id: string) => ({ type: "prompt" as const, id, outcome: "dismiss" as const });

  it("shows a proposal with one way to accept it and one to refuse it, and offers the prompt action", async () => {
    const { ctx, backend } = setup();
    const b = prompting(backend, [REVIEW]);
    const panel = await presentPanel(b, ctx);
    expect(panel.prompts).toEqual([{ ...REVIEW, actions: [
      { label: "Réviser maintenant", action: accept("review_due:start") },
      { label: "Plus tard", action: dismiss("review_due:start") },
    ] }]);
    expect(panel.actions).toContain("prompt");
    expect(b.getPrompts).toHaveBeenCalledWith("s1", { attention: "normal", surface: { rank: 3, kind: "panel", available: ["text", "panel"] }, locale: "fr" });
    expect(PanelViewSchema.safeParse(panel).success).toBe(true);
  });

  it("words each kind of proposal, in the view's language; a notice asks nothing", async () => {
    const { ctx, backend } = setup();
    const kinds: Served[] = ["break", "next_lesson", "map_offer", "forms_offer", "adaptation_notice", "resume_notice"]
      .map(kind => ({ id: kind, kind, reason: `raison ${kind}`, expires: "session" as const }));
    const labels = async (locale: "fr" | "en") =>
      (await presentPanel(prompting(backend, kinds), { ...ctx, locale })).prompts!.map(prompt => prompt.actions.map(action => action.label));
    expect(await labels("fr")).toEqual([
      ["Faire une pause", "Continuer"], ["Choisir une leçon", "Plus tard"], ["Voir la carte", "Plus tard"],
      ["Jouer en formulaires", "Rester en conversation"], [], [],
    ]);
    expect(await labels("en")).toEqual([
      ["Take a break", "Keep going"], ["Pick a lesson", "Later"], ["See the map", "Later"],
      ["Play in forms", "Stay in the conversation"], [], [],
    ]);
    // Only notices: nothing to answer, so no prompt action.
    const informed = await presentPanel(prompting(backend, kinds.slice(4)), ctx);
    expect(informed.prompts).toHaveLength(2);
    expect(informed.actions).not.toContain("prompt");
  });

  it("asks the server with the attention level and the surface of the session, and keeps the learner's own replan prompt", async () => {
    const { ctx, backend } = setup();
    const b = prompting(backend, [REVIEW]);
    ctx.attention = "quiet";
    ctx.surface = { rank: 1, kind: "text", available: ["text", "form"] };
    await applyPanelAction(b, ctx, { type: "replan", minutes: 10 });
    expect(b.getPrompts).toHaveBeenLastCalledWith("s1", { attention: "quiet", surface: ctx.surface, locale: "fr" });
    expect(ctx.lastView!.prompts!.map(prompt => prompt.kind)).toEqual(["review_due", "replan"]);
  });

  it("dismissing a proposal settles it and keeps the scene: nothing is submitted", async () => {
    const { ctx, backend } = setup();
    const b = prompting(backend, [REVIEW]);
    const before = await presentPanel(b, ctx);
    const after = await applyPanelAction(b, ctx, dismiss("review_due:start"));
    expect(b.settlePrompt).toHaveBeenCalledWith("s1", "review_due:start", "dismissed");
    expect(after).toMatchObject({ kind: "scene", session_id: "s1", scene: { id: before.scene!.id }, prompts: [] });
    expect(after.actions).not.toContain("prompt");
    expect(backend.submitResponse).not.toHaveBeenCalled();
    expect(backend.startReviewSession).not.toHaveBeenCalled();
  });

  it("accepting does what the proposal said: the review starts, the map opens, a break keeps the step", async () => {
    const reviewed = setup();
    const b = prompting(reviewed.backend, [REVIEW]);
    expect(await applyPanelAction(b, reviewed.ctx, accept("review_due:start"))).toMatchObject({ session_id: "review" });
    expect(b.settlePrompt).toHaveBeenCalledWith("s1", "review_due:start", "accepted");

    const mapped = setup();
    const getConceptMapRecord = vi.fn(async () => null);
    const withMap = { ...prompting(mapped.backend, [{ id: "map_offer", kind: "map_offer", reason: "La carte.", expires: "session" }]), getConceptMapRecord };
    await applyPanelAction(withMap, mapped.ctx, accept("map_offer"));
    expect(getConceptMapRecord).toHaveBeenCalledWith("s1");

    const paused = setup();
    const resting = prompting(paused.backend, [{ id: "break:1", kind: "break", reason: "26 minutes de séance sans pause", expires: "scene" }]);
    const view = await applyPanelAction(resting, paused.ctx, accept("break:1"));
    expect(view).toMatchObject({ kind: "notice", scene: { id: scene.id }, message: "La leçon t'attend ici, à la même étape." });
    expect(paused.backend.submitResponse).not.toHaveBeenCalled();
  });

  it("refuses an answer to a prompt that is not open in the server's words, and on a server that holds none", async () => {
    const { ctx, backend } = setup();
    const b = prompting(backend, []);
    expect(await applyPanelAction(b, ctx, dismiss("gone")).catch((e: Error) => e.message)).toBe('no open prompt "gone"');
    expect(await applyPanelAction(backend, ctx, dismiss("gone")).catch((e: Error) => e.message)).toBe("this server holds no prompt to answer");
    expect(await applyPanelAction(backend, ctx, { type: "prompt", id: "x", outcome: "maybe" } as never).catch((e: Error) => e.message)).toMatch(/^invalid prompt action: outcome/);
    // A backend without prompts shows none and offers no prompt action.
    const plain = await presentPanel({ ...backend, getOrientation: vi.fn(async () => extras) }, ctx);
    expect(plain.prompts).toEqual([]);
    expect(plain.actions).not.toContain("prompt");
  });
});
