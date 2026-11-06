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
