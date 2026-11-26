// Revisit a step already done (owner decision 2026-11-26, « précédent »): going back is a read-only
// revisit, never a rewind. The rail offers the main-path steps already done; the revisit shows one as it
// was, with the learner's own answer and the feedback they got when the panel kept them; nothing can be
// answered there, and « resume » returns to the exact current screen.
import { describe, it, expect, vi } from "vitest";
import { applyPanelAction, presentPanel, PanelViewSchema, type PanelContext } from "./index.js";

const current = { id: "s4", type: "quiz", title: "Quatre", question: "Combien ?", concept_refs: ["c1"], choices: [{ id: "a", text: "Un" }, { id: "b", text: "Deux" }] };
const past = { id: "s2", type: "quiz", title: "Deux", question: "Lequel ?", concept_refs: ["c1"], choices: [{ id: "x", text: "Le bon" }, { id: "y", text: "L'autre" }] };
const DONE = [{ index: 1, scene_id: "s1", title: "Un" }, { index: 2, scene_id: "s2", title: "Deux" }, { index: 3, scene_id: "s3", title: "Trois" }];

function setup() {
  const ctx: PanelContext = { sessionId: "s", learnerId: "ana", bundleRef: "b/lesson.json", lessonTitle: "Leçon" };
  const backend = {
    getCurrentScene: vi.fn(async () => ({ scene: current, index: 3, total: 6, locale: "fr" })),
    getSceneArtifacts: vi.fn(async () => []),
    getSessionState: vi.fn(async () => ({ concept_states: {}, history: [] })),
    submitResponse: vi.fn(async () => ({ kind: "next", verdict: { scene_id: "s4", graded: true, correct: true, feedback: "Bien vu." } })),
    submitTurn: vi.fn(async () => ({})), requestHint: vi.fn(async () => ({ hint: "Compte-les.", remaining: 0 })),
    rateRecall: vi.fn(async () => ({})), startReviewSession: vi.fn(async () => ({})), startLessonSession: vi.fn(async () => ({})),
    forgetSession: vi.fn(async () => ({})), getNextReinforcement: vi.fn(async () => ({ due: [], relearn: [], unmeasured: [] })),
    inlineImage: vi.fn(async (asset) => asset),
    getOrientation: vi.fn(async () => ({
      orientation: { step: { index: 4, total: 6 }, reviews_due: 0, waiting: "answer" as const },
      status_line: "Leçon · étape 4/6 · à toi de répondre",
      voices: { scene: { kind: "author" as const, name: null, reviewed: true, drafted_by: "teacher" as const } },
      help: { rungs: [{ kind: "reread" as const, available: true }, { kind: "hint" as const, available: true }] },
    })),
    getPrompts: vi.fn(async () => []),
    getRevisitable: vi.fn(async () => DONE),
    getPastScene: vi.fn(async (_id: string, sceneId: string) => {
      if (!DONE.some(step => step.scene_id === sceneId)) throw new Error(`scene ${sceneId} is not a step already done`);
      return { scene: past, index: 1, total: 6, assets: [{ kind: "image", path: "fig.png" }], answered: true, correct: false, assessed_by: "key" };
    }),
  };
  return { ctx, backend };
}
/** Everything a revisit must leave alone: the session's moving parts. */
const MUTATIONS = ["submitResponse", "submitTurn", "requestHint", "rateRecall", "startReviewSession", "startLessonSession", "forgetSession"] as const;

describe("the rail offers the main-path steps already done", () => {
  it("lists them in progress.done and offers revisit on a scene", async () => {
    const { ctx, backend } = setup();
    const view = await presentPanel(backend, ctx);
    expect(view.progress.done).toEqual(DONE);
    expect(view.actions).toContain("revisit");
    expect(view.actions).not.toContain("resume");
    expect(PanelViewSchema.parse(view)).toEqual(view);
  });
  it("offers nothing to revisit when no step is done yet, or when the backend cannot show one", async () => {
    const { ctx, backend } = setup();
    backend.getRevisitable.mockResolvedValue([]);
    const first = await presentPanel(backend, ctx);
    expect(first.progress).not.toHaveProperty("done");
    expect(first.actions).not.toContain("revisit");
    const { getRevisitable: _r, getPastScene: _p, ...older } = setup().backend;
    expect((await presentPanel(older, setup().ctx)).actions).not.toContain("revisit");
  });
});

describe("revisit", () => {
  it("shows the step as it was, read only, with a single way back", async () => {
    const { ctx, backend } = setup();
    const view = await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s2" });
    expect(backend.getPastScene).toHaveBeenCalledWith("s", "s2");
    expect(view).toMatchObject({
      kind: "scene", scene: { id: "s2", title: "Deux", question: "Lequel ?" }, scene_assets: [{ kind: "image", path: "fig.png" }],
      revisit: { scene_id: "s2", index: 2, total: 6, title: "Deux", answered: true, result: "wrong", assessed_by: "key" },
      verdict: null, navigation: null, self_rating: null, prompts: [],
    });
    // The rail still says where the learner is.
    expect(view.progress).toMatchObject({ index: 4, total: 6, done: DONE });
    expect(view.orientation?.step.index).toBe(4);
    expect(view.actions).toEqual(["resume", "revisit"]);
    expect(PanelViewSchema.parse(view)).toEqual(view);
  });

  it("carries the learner's own answer and the feedback they got, when the panel kept them", async () => {
    const { ctx, backend } = setup();
    backend.getCurrentScene.mockResolvedValueOnce({ scene: past, index: 1, total: 6, locale: "fr" });
    await presentPanel(backend, ctx);
    backend.submitResponse.mockResolvedValueOnce({ kind: "next", verdict: { scene_id: "s2", graded: true, correct: false, feedback: "Relis la définition." } });
    await applyPanelAction(backend, ctx, { type: "respond", input: { kind: "quiz_choice", choiceId: "y" }, expected_scene_id: "s2" });
    const view = await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s2" });
    expect(view.revisit).toMatchObject({ your_answer: "L'autre", feedback: "Relis la définition." });
  });

  it("refuses an answer, a hint or a turn on the revisited step, and changes nothing", async () => {
    const { ctx, backend } = setup();
    await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s2" });
    for (const action of [
      { type: "respond", input: { kind: "quiz_choice", choiceId: "x" }, expected_scene_id: "s2" },
      { type: "hint" }, { type: "turn", text: "pourquoi ?" }, { type: "rateRecall", sceneId: "s2", grade: "good" },
      { type: "contest", concept_id: "c1", claim: "known" }, { type: "reviewNow" }, { type: "restartLesson" },
    ] as const) {
      await expect(applyPanelAction(backend, ctx, action)).rejects.toThrow(/review only|resume/);
    }
    for (const name of MUTATIONS) expect(backend[name]).not.toHaveBeenCalled();
    expect(ctx.revisit).toEqual({ sceneId: "s2" });
  });

  it("refuses a step not reached yet, and leaves the screen as it was", async () => {
    const { ctx, backend } = setup();
    const before = await presentPanel(backend, ctx);
    await expect(applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s5" })).rejects.toThrow(/not a step already done/);
    await expect(applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s4" })).rejects.toThrow(/not a step already done/);
    expect(ctx.revisit).toBeUndefined();
    expect(backend.getPastScene).not.toHaveBeenCalled();
    expect(await presentPanel(backend, ctx)).toEqual(before);
  });

  it("on a prerequisite detour, offers only the main-path steps the backend lists", async () => {
    const { ctx, backend } = setup();
    backend.getOrientation.mockResolvedValue({
      orientation: { step: { index: 6, total: 6, detour: { returns_to: "s3" }, main: { index: 3, title: "Trois" } }, reviews_due: 0, waiting: "answer" as const },
      status_line: "Leçon · étape 3/6 · détour", voices: { scene: { kind: "author" as const, name: null, reviewed: true, drafted_by: "teacher" as const } },
      help: { rungs: [{ kind: "reread" as const, available: true }] },
    } as never);
    backend.getRevisitable.mockResolvedValue(DONE.slice(0, 2));
    const view = await presentPanel(backend, ctx);
    expect(view.progress).toMatchObject({ detour: { returns_to_scene_id: "s3", returns_to_index: 3 }, done: DONE.slice(0, 2) });
    await expect(applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s3" })).rejects.toThrow(/not a step already done/);
    expect((await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s2" })).revisit?.scene_id).toBe("s2");
  });
});

describe("resume", () => {
  it("returns to the exact current screen: the scene, its pending hint, nothing moved", async () => {
    const { ctx, backend } = setup();
    const hinted = await applyPanelAction(backend, ctx, { type: "hint" });
    expect(hinted.hint).toEqual({ hint: "Compte-les.", remaining: 0 });
    backend.requestHint.mockClear();
    backend.getPrompts.mockClear();
    const state = JSON.stringify({ transition: ctx.transition, effects: ctx.effects, prompts: ctx.prompts, sessionId: ctx.sessionId });
    const revisiting = await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s1" });
    expect(revisiting).not.toHaveProperty("hint");
    // Another step, then back.
    await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s3" });
    expect(backend.getPrompts).not.toHaveBeenCalled();
    const resumed = await applyPanelAction(backend, ctx, { type: "resume" });
    expect(resumed).toEqual(hinted);
    expect(resumed).not.toHaveProperty("revisit");
    expect(ctx.revisit).toBeUndefined();
    expect(JSON.stringify({ transition: ctx.transition, effects: ctx.effects, prompts: ctx.prompts, sessionId: ctx.sessionId })).toBe(state);
    for (const name of MUTATIONS) expect(backend[name]).not.toHaveBeenCalled();
  });

  it("outside a revisit, changes nothing", async () => {
    const { ctx, backend } = setup();
    const before = await presentPanel(backend, ctx);
    expect(await applyPanelAction(backend, ctx, { type: "resume" })).toEqual(before);
  });

  it("ending the lesson during a revisit leaves no revisit behind", async () => {
    const { ctx, backend } = setup();
    await applyPanelAction(backend, ctx, { type: "revisit", scene_id: "s2" });
    const notice = await applyPanelAction(backend, ctx, { type: "end", confirmed: true });
    expect(notice).toMatchObject({ kind: "notice" });
    expect(notice).not.toHaveProperty("revisit");
    expect(notice.progress).not.toHaveProperty("done");
    expect(ctx.revisit).toBeUndefined();
  });
});
