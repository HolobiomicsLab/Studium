// The concept map as a view of the session (INT-STUDIUM-058 § 2.7): for each concept its state, the
// evidence behind it, what the state establishes and what it does not. The view is drawn from the
// record studium/concept-map-record/v1; the panel shows it after `openMap` and until `closeMap`.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { applyPanelAction, presentPanel, mapView, MapViewSchema, PanelViewSchema, type MapRecord, type PanelContext, type Surface } from "./index.js";
import { phrase } from "./phrases.js";

const lesson = JSON.parse(readFileSync(new URL("../../../fixtures/atomistique-l1/lesson.json", import.meta.url), "utf8"));
const quiz = lesson.scenes.find((s: { type: string }) => s.type === "quiz");

/** A record as the host builds it, cut to what the view reads plus fields it must not carry over. */
function record(): MapRecord & Record<string, unknown> {
  const node = (id: string, state: string) => ({ id, title: `Notion ${id}`, state, questions: [], requires: [] });
  const step = (n: number, scene_id: string, answered: boolean, correct: boolean | null, assessed_by: string | null) =>
    ({ step: n, scene_id, concept_id: null, answered, correct, assessed_by, navigation: null });
  return {
    schema: "studium/concept-map-record/v1",
    map: {
      nodes: [node("a", "acquired"), node("b", "to_review"), node("c", "current"), node("d", "seen"), node("e", "upcoming")],
      edges: [{ from: "a", to: "b", travelled: true }, { from: "b", to: "e", travelled: false }],
    },
    scenes: [
      { scene_id: "read-a", concept_ids: ["a"], sources: [{ title: "Cours", quote: "Un passage libéré." }] },
      { scene_id: "quiz-a", concept_ids: ["a"] }, { scene_id: "quiz-ab", concept_ids: ["a", "b"] },
      { scene_id: "write-c", concept_ids: ["c"] }, { scene_id: "write-d", concept_ids: ["d"] }, { scene_id: "judged-d", concept_ids: ["d"] },
    ],
    path: [
      step(1, "read-a", false, null, null), step(2, "quiz-a", true, true, "key"), step(3, "quiz-ab", true, false, "key"),
      step(4, "write-d", true, null, "none"), step(5, "judged-d", true, true, "judge"), step(6, "write-c", true, null, "none"),
    ],
    evidence: [
      { step: 2, scene_id: "quiz-a", day: "2026-11-05", hints: 1, self_rated: false },
      { step: 3, scene_id: "quiz-ab", day: "2026-11-06", hints: 0, self_rated: false },
      { step: 4, scene_id: "write-d", day: "2026-11-06", hints: 0, self_rated: true },
      { step: 5, scene_id: "judged-d", day: "2026-11-06", hints: 0, self_rated: false },
      { step: 6, scene_id: "write-c", day: "2026-11-06", hints: 0, self_rated: false },
    ],
  } as never;
}

describe("mapView", () => {
  it("gives each concept its state, its evidence in the order served, and the two sentences of its state", () => {
    const view = mapView(record(), "fr");
    expect(MapViewSchema.parse(view)).toEqual(view);
    expect(view.concepts.map(({ id, title, state }) => ({ id, title, state }))).toEqual([
      { id: "a", title: "Notion a", state: "acquired" }, { id: "b", title: "Notion b", state: "to_review" },
      { id: "c", title: "Notion c", state: "current" }, { id: "d", title: "Notion d", state: "seen" }, { id: "e", title: "Notion e", state: "upcoming" },
    ]);
    const evidence = Object.fromEntries(view.concepts.map((concept) => [concept.id, concept.evidence]));
    expect(evidence.a).toEqual([
      { scene_id: "quiz-a", day: "2026-11-05", assessed_by: "key", result: "right", hints: 1 },
      { scene_id: "quiz-ab", day: "2026-11-06", assessed_by: "key", result: "wrong", hints: 0 },
    ]);
    // A scene on two concepts is evidence for both; a screen read is evidence for none.
    expect(evidence.b).toEqual([{ scene_id: "quiz-ab", day: "2026-11-06", assessed_by: "key", result: "wrong", hints: 0 }]);
    // An answer the learner rated themself, then one a judge assessed.
    expect(evidence.d).toEqual([
      { scene_id: "write-d", day: "2026-11-06", assessed_by: "self", result: "rated", hints: 0 },
      { scene_id: "judged-d", day: "2026-11-06", assessed_by: "judge", result: "right", hints: 0 },
    ]);
    // An answer nobody assessed and the learner has not rated: recorded, no more.
    expect(evidence.c).toEqual([{ scene_id: "write-c", day: "2026-11-06", assessed_by: "none", result: "recorded", hints: 0 }]);
    expect(evidence.e).toEqual([]);
    for (const concept of view.concepts) {
      expect(concept.establishes).toBe(phrase(`map_establishes_${concept.state}`, {}, "fr"));
      expect(concept.does_not_establish).toBe(phrase(`map_not_established_${concept.state}`, {}, "fr"));
      expect(concept.establishes).not.toBe(concept.does_not_establish);
    }
    expect(view.edges).toEqual([{ from: "a", to: "b" }, { from: "b", to: "e" }]);
  });

  it("writes the sentences in the asked language, ten of them, all different", () => {
    const fr = mapView(record(), "fr").concepts.flatMap((c) => [c.establishes, c.does_not_establish]);
    const en = mapView(record(), "en").concepts.flatMap((c) => [c.establishes, c.does_not_establish]);
    expect(new Set([...fr, ...en]).size).toBe(20);
    expect(en[0]).toMatch(/^Your last graded answer/);
  });

  it("carries no passage, no source and no word of the record beyond titles, states and evidence", () => {
    const text = JSON.stringify(mapView(record(), "fr"));
    expect(text).not.toContain("Un passage libéré.");
    expect(text).not.toMatch(/"(?:sources|quote|questions|navigation|answer|correct|expected|key|solution|hint)"\s*:/);
  });

  it("reads a record written before the evidence existed: day and hints are then unknown", () => {
    const old = record();
    delete (old as { evidence?: unknown }).evidence;
    const view = mapView(old, "fr");
    expect(view.concepts[0]!.evidence[0]).toEqual({ scene_id: "quiz-a", day: null, assessed_by: "key", result: "right", hints: null });
    expect(MapViewSchema.parse(view)).toEqual(view);
  });
});

describe("mapView: what can be contested", () => {
  const contested = (contest: NonNullable<MapRecord["contest"]>) => mapView({ ...record(), contest }, "fr").concepts.map((c) => c.contest);

  it("offers « I am not sure » of an acquired concept, « I know it » of the states the session has shown, and none of an upcoming one", () => {
    expect(contested({ pending: null, questions: { a: 2, b: 1, c: 0, d: 2, e: 2 }, history: [] })).toEqual([
      { allowed: true, claim: "unsure", questions: 2 }, { allowed: true, claim: "known", questions: 1 },
      { allowed: false, claim: "known", questions: 0 }, { allowed: true, claim: "known", questions: 2 },
      { allowed: false, claim: "known", questions: 2 },                // upcoming: no claim until the session reaches it
    ]);
  });

  it("allows a current concept with a check question, and never an upcoming one", () => {
    const view = contested({ pending: null, questions: { c: 2, e: 2 }, history: [] });
    expect(view[2]).toEqual({ allowed: true, claim: "known", questions: 2 });
    expect(view[4]).toEqual({ allowed: false, claim: "known", questions: 2 });
  });

  it("says which concept is being checked, and allows no other contest meanwhile", () => {
    const during = contested({ pending: { concept_id: "b", claim: "known", asked: 2, answered: 1 }, questions: { a: 0, b: 0, c: 0, d: 0, e: 0 }, history: [] });
    expect(during[1]).toEqual({ allowed: false, check_pending: true, claim: "known", questions: 2 });
    expect(during.filter((c) => c?.allowed)).toEqual([]);
    expect(during[0]).not.toHaveProperty("check_pending");
  });

  it("keeps the outcome of the last contest of a concept", () => {
    const history = [
      { concept_id: "a", claim: "unsure" as const, outcome: "refuted" as const, scene_ids: ["quiz-a", "quiz-ab"], results: [true, false] },
      { concept_id: "a", claim: "unsure" as const, outcome: "confirmed" as const, scene_ids: ["quiz-a", "quiz-ab"], results: [false, false] },
    ];
    const after = contested({ pending: null, questions: { a: 2 }, history });
    expect(after[0]).toEqual({ allowed: true, claim: "unsure", questions: 2, outcome: "confirmed" });
    expect(after[1]).not.toHaveProperty("outcome");
    const view = mapView({ ...record(), contest: { pending: null, questions: { a: 2 }, history } }, "fr");
    expect(MapViewSchema.parse(view)).toEqual(view);
    expect(JSON.stringify(view)).not.toContain("results");           // the view says the outcome, not each answer again
  });

  it("says nothing of contests for a record that does not tell them (an older server)", () => {
    expect(mapView(record(), "fr").concepts.every((c) => c.contest === undefined)).toBe(true);
  });
});

describe("panel actions: openMap and closeMap", () => {
  function setup(surface?: Surface) {
    const presentation = { scene: quiz, index: 1, total: lesson.scenes.length, locale: "fr" };
    const ctx: PanelContext = { sessionId: "s1", learnerId: "auto-map-test", bundleRef: "atomistique-l1/lesson.json", lessonTitle: lesson.metadata.title, ...(surface ? { surface } : {}) };
    const backend = {
      getCurrentScene: vi.fn(async () => presentation), getSceneArtifacts: vi.fn(async () => []),
      getSessionState: vi.fn(async () => ({ concept_states: {}, history: [] })),
      submitResponse: vi.fn(async () => ({ kind: "next", presentation, verdict: { scene_id: "previous", graded: true, correct: true }, navigation: { kind: "advance" } })),
      submitTurn: vi.fn(async () => ({})), requestHint: vi.fn(async () => null), rateRecall: vi.fn(async () => ({})),
      startReviewSession: vi.fn(async () => ({ status: "started", session_id: "review", presentation, review: { items: [] } })),
      startLessonSession: vi.fn(async () => ({ session_id: "restart", presentation })), forgetSession: vi.fn(async () => ({})),
      getNextReinforcement: vi.fn(async () => ({ due: [], relearn: [], unmeasured: [] })),
      inlineImage: vi.fn(async (asset: never) => asset),
      getOrientation: vi.fn(async () => ({
        orientation: { step: { index: 2, total: 3 }, reviews_due: 0, waiting: "answer" as const },
        status_line: "Leçon · étape 2/3 · à toi de répondre",
        voices: { scene: { kind: "author" as const, name: null, reviewed: true, drafted_by: "teacher" as const } },
        help: { rungs: [{ kind: "reread" as const, available: true }] },
      })),
      getConceptMapRecord: vi.fn(async (): Promise<MapRecord | null> => record()),
    };
    return { ctx, backend };
  }

  it("openMap shows the map beside the scene until closeMap, and the scene stays", async () => {
    const { ctx, backend } = setup();
    const before = await presentPanel(backend, ctx);
    expect(before.map).toBeUndefined();
    expect(before.actions).toContain("openMap");
    expect(before.actions).not.toContain("closeMap");
    expect(backend.getConceptMapRecord).not.toHaveBeenCalled();     // a closed map costs nothing

    const open = await applyPanelAction(backend, ctx, { type: "openMap" });
    expect(open).toMatchObject({ kind: "scene", scene: { id: quiz.id }, map: mapView(record(), "fr") });
    expect(open.actions).toContain("closeMap");
    expect(open.actions).not.toContain("openMap");
    expect(PanelViewSchema.parse(open)).toEqual(open);
    expect(backend.submitResponse).not.toHaveBeenCalled();          // nothing is answered by looking at the map

    // The map stays open across an answer and is read again: it shows the session as it now is.
    const calls = backend.getConceptMapRecord.mock.calls.length;
    const answered = await applyPanelAction(backend, ctx, { type: "respond", input: { kind: "ack" } });
    expect(answered.map?.concepts).toHaveLength(5);
    expect(backend.getConceptMapRecord.mock.calls.length).toBeGreaterThan(calls);

    const closed = await applyPanelAction(backend, ctx, { type: "closeMap" });
    expect(closed.map).toBeUndefined();
    expect(closed.actions).toContain("openMap");
    expect(closed).toMatchObject({ kind: "scene", scene: { id: quiz.id } });
  });

  it("writes the map in the view's language", async () => {
    const { ctx, backend } = setup();
    ctx.locale = "en";
    const open = await applyPanelAction(backend, ctx, { type: "openMap" });
    expect(open.map).toEqual(mapView(record(), "en"));
  });

  it("says so when the session has no map, and offers none in a review session or below forms", async () => {
    const { ctx, backend } = setup();
    backend.getConceptMapRecord.mockResolvedValue(null);
    const none = await applyPanelAction(backend, ctx, { type: "openMap" });
    expect(none).toMatchObject({ kind: "notice", scene: { id: quiz.id } });
    expect(none.message).toBe(phrase("panel_map_unavailable", {}, "fr"));
    expect(none.map).toBeUndefined();
    expect(none.actions).toContain("openMap");

    const review = setup();
    review.ctx.review = { titles: {}, origins: {} };
    expect((await presentPanel(review.backend, review.ctx)).actions).not.toContain("openMap");

    const text = setup({ rank: 1, kind: "text", available: ["text"] });
    expect((await presentPanel(text.backend, text.ctx)).actions).not.toContain("openMap");
    const forms = setup({ rank: 2, kind: "form", available: ["text", "form"] });
    expect((await presentPanel(forms.backend, forms.ctx)).actions).toContain("openMap");
  });

  it("a session that starts again opens with its map closed, and a forgotten one carries none", async () => {
    const { ctx, backend } = setup();
    await applyPanelAction(backend, ctx, { type: "openMap" });
    expect((await applyPanelAction(backend, ctx, { type: "restartLesson" })).map).toBeUndefined();
    await applyPanelAction(backend, ctx, { type: "openMap" });
    const forgotten = await applyPanelAction(backend, ctx, { type: "end", confirmed: true });
    expect(forgotten.kind).toBe("notice");
    expect(forgotten.map).toBeUndefined();
  });

  it("contest asks the backend for check questions, shows the first and says how many follow", async () => {
    const { ctx, backend } = setup();
    const contestConcept = vi.fn(async () => ({ questions: 2 }));
    const b = { ...backend, contestConcept };
    expect((await presentPanel(b, ctx)).actions).not.toContain("contest");   // the map carries the contest buttons
    const open = await applyPanelAction(b, ctx, { type: "openMap" });
    expect(open.actions).toContain("contest");
    await applyPanelAction(b, ctx, { type: "respond", input: { kind: "ack" } });
    expect(ctx.transition).toBeDefined();

    const started = await applyPanelAction(b, ctx, { type: "contest", concept_id: "b", claim: "known" });
    expect(contestConcept).toHaveBeenCalledWith("s1", "b", "known");
    expect(started).toMatchObject({ kind: "scene", message: phrase("panel_contest_two", {}, "fr") });
    expect(started.verdict).toBeNull();                              // the previous answer's verdict leaves with its scene
    expect(ctx.transition).toBeUndefined();
    expect(backend.submitResponse).toHaveBeenCalledTimes(1);         // contesting answers nothing

    contestConcept.mockResolvedValueOnce({ questions: 1 });
    const single = await applyPanelAction(b, ctx, { type: "contest", concept_id: "b", claim: "known" });
    expect(single.message).toBe(phrase("panel_contest_one", {}, "fr"));
    expect(single.message).toMatch(/partiel/);
  });

  it("says what the check showed with the answer that ends it", async () => {
    const { ctx, backend } = setup();
    const b = { ...backend, contestConcept: vi.fn(async () => ({ questions: 2 })) };
    const settled = (claim: string, outcome: string) => {
      backend.submitResponse.mockResolvedValueOnce({
        kind: "next", presentation: { scene: quiz, index: 1, total: lesson.scenes.length, locale: "fr" },
        verdict: { scene_id: "previous", graded: true, correct: true }, navigation: { kind: "advance" },
        contest: { concept_id: "b", claim, outcome, scene_ids: ["q1", "q2"], results: [true, true] },
      } as never);
      return applyPanelAction(b, ctx, { type: "respond", input: { kind: "ack" } });
    };
    expect((await settled("known", "confirmed")).message).toBe(phrase("panel_contest_confirmed_known", {}, "fr"));
    expect((await settled("known", "refuted")).message).toBe(phrase("panel_contest_refuted_known", {}, "fr"));
    expect((await settled("unsure", "confirmed")).message).toBe(phrase("panel_contest_confirmed_unsure", {}, "fr"));
    expect((await settled("unsure", "refuted")).message).toBe(phrase("panel_contest_refuted_unsure", {}, "fr"));
    const partial = await settled("known", "partial");
    expect(partial).toMatchObject({ kind: "scene", message: phrase("panel_contest_partial", {}, "fr") });
    // An ordinary answer says nothing of a contest.
    expect((await applyPanelAction(b, ctx, { type: "respond", input: { kind: "ack" } })).message).toBeUndefined();
  });

  it("refuses contest in one line on a backend that cannot check, and a malformed one", async () => {
    const { ctx, backend } = setup();
    expect(await applyPanelAction(backend, ctx, { type: "contest", concept_id: "b", claim: "known" }).catch((e: Error) => e.message))
      .toBe("this server cannot check a contested concept");
    expect(await applyPanelAction(backend, ctx, { type: "contest", concept_id: "b", claim: "sure" } as never).catch((e: Error) => e.message))
      .toMatch(/^invalid contest action: claim/);
  });

  it("a backend that cannot read the record offers no map (a version-1 view, or an older server)", async () => {
    const { ctx, backend } = setup();
    const { getConceptMapRecord: _none, ...without } = backend;
    expect((await presentPanel(without, ctx)).actions).not.toContain("openMap");
    const refused = await applyPanelAction(without, ctx, { type: "openMap" });
    expect(refused).toMatchObject({ kind: "notice", message: phrase("panel_map_unavailable", {}, "fr") });
  });
});
