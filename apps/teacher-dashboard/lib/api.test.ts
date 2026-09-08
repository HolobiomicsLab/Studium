/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getProgress,
  getProgressMetrics,
  getCalibration,
  getTrustCalibration,
  getCourseCompletion,
  getCourse,
  getAutonomy,
  getConceptMasteryHistory,
  getAILiteracy,
  getReasoningDepth,
  getJournalStats,
  getCooperationStats,
  postBlueprintScore,
  getLearnerItems,
  decideLearnerItem,
  teacherIriForToken,
  isSuppressed,
  type Suppressed,
} from "./api";

/** Narrow away the k-anonymity suppression (INT-STUDIUM-005) so these tests can keep asserting
 *  on the aggregate they mocked. Throwing rather than casting means a fetcher that started
 *  suppressing unexpectedly fails here by name instead of at an undefined property. */
function aggregate<T>(data: T | Suppressed): T {
  if (isSuppressed(data)) throw new Error(`unexpected suppression: ${data.reason}`);
  return data;
}

describe("teacher-dashboard api wrapper", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("getProgress hits /metrics/progress with X-Course-Token header", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scenes: { s1: { completion_rate: 0.5, n_learners: 3 } } }),
    });
    const r = aggregate(await getProgress("course-x"));
    expect(r.scenes.s1.completion_rate).toBe(0.5);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/progress?course=course-x");
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
    expect(call[1].cache).toBe("no-store");
  });

  it("getCalibration includes learner param when provided", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ brier_score: 0.12, n_items: 4 }),
    });
    await getCalibration("c", "p1");
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain("course=c");
    expect(url).toContain("learner=p1");
  });

  it("getCalibration omits learner when not provided", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ brier_score: null, n_items: 0 }),
    });
    await getCalibration("c");
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).not.toContain("learner=");
  });

  it("getTrustCalibration hits /metrics/trust-calibration and forwards learner", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        trust_calibration: 0.67, band: "sur", n_audits: 1,
        over_trust: 0.67, over_distrust: 0, per_scene: [],
      }),
    });
    const r = aggregate(await getTrustCalibration("c", "p1"));
    expect(r.band).toBe("sur");
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/trust-calibration?course=c");
    expect(call[0]).toContain("learner=p1");
    expect(call[1].headers["X-Course-Token"]).toBe("c");
  });

  it("getTrustCalibration omits learner when not provided", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        trust_calibration: null, band: null, n_audits: 0,
        over_trust: null, over_distrust: null, per_scene: [],
      }),
    });
    await getTrustCalibration("c");
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).not.toContain("learner=");
  });

  it("getCourseCompletion hits /metrics/course-completion with token", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lessons: { l1: { n_completed: 2 } }, total_completions: 3 }),
    });
    const r = aggregate(await getCourseCompletion("c"));
    expect(r.lessons.l1.n_completed).toBe(2);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/course-completion?course=c");
    expect(call[1].headers["X-Course-Token"]).toBe("c");
  });

  it("getCourse fetches a parsed manifest from lesson-server and unwraps .course", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, ok: true, course: { course_id: "k", title: "T", schema_version: "1.0", lessons: [] } }),
    });
    const r = await getCourse("courses/decay-course.json");
    expect(r.course_id).toBe("k");
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain("/courses?ref=courses%2Fdecay-course.json");
  });

  it("getAutonomy returns ratio + critique_completion_rate", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        critique_completion_rate: 0.7,
        autonomy_ratio: 0.8,
        n_critique: 8,
        n_hints: 2,
      }),
    });
    const r = aggregate(await getAutonomy("c"));
    expect(r.autonomy_ratio).toBe(0.8);
    expect(r.n_critique).toBe(8);
  });

  it("throws on non-2xx", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    await expect(getProgress("c")).rejects.toThrow(/401/);
  });

  it("getConceptMasteryHistory hits /metrics/concept-mastery-history with token", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ concepts: {} }),
    });
    const r = aggregate(await getConceptMasteryHistory("c1"));
    expect(r.concepts).toEqual({});
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/concept-mastery-history?course=c1");
    expect(call[1].headers["X-Course-Token"]).toBe("c1");
  });

  it("getConceptMasteryHistory includes optional filters when set", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ concepts: {} }),
    });
    await getConceptMasteryHistory("c1", {
      pseudonyme: "p1",
      concept_id: "kepler",
      since: "2026-05-01",
    });
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain("course=c1");
    expect(url).toContain("pseudonyme=p1");
    expect(url).toContain("concept_id=kepler");
    expect(url).toContain("since=2026-05-01");
  });

  it("getAILiteracy passes pseudonyme + window with X-Course-Token", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        value: 0.72,
        ic80: [0.65, 0.79],
        n_sessions: 8,
        window: 10,
        degraded: false,
        components: {
          ai_audit_accuracy: 0.8,
          hint_independence_trend: 0.65,
          critique_completion_rate: 0.7,
        },
      }),
    });
    const result = await getAILiteracy("course-x", "pseudo-1", 10);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/ai-literacy?");
    expect(call[0]).toContain("course=course-x");
    expect(call[0]).toContain("pseudonyme=pseudo-1");
    expect(call[0]).toContain("window=10");
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
    expect(result.value).toBe(0.72);
    expect(result.components.ai_audit_accuracy).toBe(0.8);
  });

  it("getReasoningDepth passes filters with X-Course-Token", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        scenes: {
          s1: { score: 0.6, n_signals: 5, breakdown: { justification: 0.4, hypothesis: 0.2 } },
        },
      }),
    })) as never;
    const result = aggregate(await getReasoningDepth("course-x", { pseudonyme: "p1", scene_id: "s1" }));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/metrics/reasoning?"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Course-Token": "course-x" }),
      }),
    );
    expect(result.scenes.s1.score).toBe(0.6);
  });

  it("getJournalStats hits /metrics/journal with X-Course-Token + optional filters", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries_total: 12,
        mean_length: 184,
        revision_rate: 0.25,
        entries_by_scene: { "s-disc-1": { count: 7, mean_length: 200 } },
      }),
    });
    const r = aggregate(await getJournalStats("course-x", {
      pseudonyme: "p1",
      bundle_version: "v0.4",
    }));
    expect(r.entries_total).toBe(12);
    expect(r.entries_by_scene["s-disc-1"].count).toBe(7);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/journal?");
    expect(call[0]).toContain("course=course-x");
    expect(call[0]).toContain("pseudonyme=p1");
    expect(call[0]).toContain("bundle_version=v0.4");
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
  });

  it("getCooperationStats hits /metrics/cooperation with X-Course-Token + bundle_version", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        n_sessions: 3,
        convergence_quality: 0.67,
        role_coverage_mean: 0.83,
        disagreement_productive_ratio: 0.5,
        votes_per_session_mean: 4.2,
      }),
    });
    const r = aggregate(await getCooperationStats("course-x", { bundle_version: "v0.4" }));
    expect(r.n_sessions).toBe(3);
    expect(r.convergence_quality).toBe(0.67);
    expect(r.votes_per_session_mean).toBe(4.2);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/cooperation?");
    expect(call[0]).toContain("course=course-x");
    expect(call[0]).toContain("bundle_version=v0.4");
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
  });

  it("postBlueprintScore POSTs blueprint with X-Course-Token", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        dimensions: [{ id: "d1", label: "D1", score: 0.7, degraded: false }],
        overall_weighted_score: 0.7,
      }),
    })) as never;
    const blueprint = {
      dimensions: [{
        id: "d1", label: "D1", weight: 1.0,
        metrics: [{ endpoint: "ai_literacy" as const, field: "value", weight_in_dimension: 1.0 }],
      }],
    };
    const result = await postBlueprintScore("course-x", "pseudo-1", blueprint);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/metrics/blueprint"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Course-Token": "course-x" }),
      }),
    );
    expect(result.dimensions[0].score).toBe(0.7);
  });

  it("URL-encodes course token", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scenes: {} }),
    });
    await getProgress("course with spaces");
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain("course=course%20with%20spaces");
  });

  // -------------------------------------------------------------------------
  // Learner-as-author moderation queue (scene-synth :8002).
  // -------------------------------------------------------------------------

  const SAMPLE_ITEM = {
    item_id: "it-1",
    course_id: "atomistique-l1",
    target_bundle_ref: "file://bundles/atomistique-l1/lesson.json",
    schema_version: "1.4",
    scene: {
      id: "s-learner-1",
      type: "quiz",
      title: "Noeuds radiaux",
      question: "Combien de noeuds radiaux pour 3s ?",
      choices: [
        { id: "a", text: "0", correct: false },
        { id: "b", text: "2", correct: true },
      ],
      feedback_correct: "Oui, n-l-1 = 2.",
      feedback_incorrect: "Revois n-l-1.",
      hints: [],
    },
    review_state: "submitted",
    validation: { ok: true, validator_version: "v1", errors: [] },
    created_at: "2026-06-26T10:00:00Z",
  };

  it("getLearnerItems hits scene-synth /learner-items with course+state+token", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [SAMPLE_ITEM] }),
    });
    const r = await getLearnerItems("atomistique-l1", "submitted");
    expect(r.items[0].item_id).toBe("it-1");
    // answer key must survive the wire — the teacher sees `correct`.
    expect(r.items[0].scene.choices?.[1].correct).toBe(true);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("http://localhost:8002/learner-items?");
    expect(call[0]).toContain("course=atomistique-l1");
    expect(call[0]).toContain("state=submitted");
    expect(call[1].headers["X-Course-Token"]).toBe("atomistique-l1");
    expect(call[1].cache).toBe("no-store");
  });

  it("getLearnerItems defaults state to submitted", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });
    await getLearnerItems("atomistique-l1");
    expect((global.fetch as any).mock.calls[0][0]).toContain("state=submitted");
  });

  it("getLearnerItems throws on non-2xx", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    await expect(getLearnerItems("atomistique-l1")).rejects.toThrow(/404/);
  });

  it("decideLearnerItem POSTs decision + reviewer + reviewed_at + token", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...SAMPLE_ITEM, review_state: "published" }),
    });
    const result = await decideLearnerItem("atomistique-l1", "it-1", {
      decision: "approve",
      reviewer: "urn:studium:teacher:atomistique-l1",
      reviewed_at: "2026-06-26T12:00:00Z",
    });
    expect(result.review_state).toBe("published");
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("http://localhost:8002/learner-items/it-1/decide");
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["X-Course-Token"]).toBe("atomistique-l1");
    expect(call[1].headers["Content-Type"]).toBe("application/json");
    const sent = JSON.parse(call[1].body);
    expect(sent.decision).toBe("approve");
    expect(sent.reviewer).toBe("urn:studium:teacher:atomistique-l1");
    expect(sent.reviewed_at).toBe("2026-06-26T12:00:00Z");
    // no note_code key when not provided
    expect("note_code" in sent).toBe(false);
  });

  it("decideLearnerItem includes note_code for reject/request_revision", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...SAMPLE_ITEM, review_state: "rejected" }),
    });
    await decideLearnerItem("atomistique-l1", "it-1", {
      decision: "reject",
      reviewer: "urn:studium:teacher:atomistique-l1",
      reviewed_at: "2026-06-26T12:00:00Z",
      note_code: "factual_error",
    });
    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.note_code).toBe("factual_error");
  });

  it("decideLearnerItem throws on non-2xx (e.g. empty reviewer rejected)", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });
    await expect(
      decideLearnerItem("atomistique-l1", "it-1", {
        decision: "approve",
        reviewer: "",
        reviewed_at: "2026-06-26T12:00:00Z",
      }),
    ).rejects.toThrow(/400/);
  });

  it("teacherIriForToken derives a stable IRI from the course token", () => {
    expect(teacherIriForToken("atomistique-l1")).toBe(
      "urn:studium:teacher:atomistique-l1",
    );
  });

  it("getProgressMetrics hits /metrics/progress-metrics with scenes_with_evidence", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scenes_with_evidence: 2, scenes_total: 3 }),
    });
    const r = aggregate(await getProgressMetrics("course-x"));
    expect(r.scenes_with_evidence).toBe(2);
    expect(r.scenes_total).toBe(3);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/progress-metrics?course=course-x");
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
  });
});
