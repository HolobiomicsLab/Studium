/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getProgress,
  getCalibration,
  getAutonomy,
  getConceptMasteryHistory,
  getAILiteracy,
  getReasoningDepth,
  getJournalStats,
} from "./api";

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
    const r = await getProgress("course-x");
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
    const r = await getAutonomy("c");
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
    const r = await getConceptMasteryHistory("c1");
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
    const result = await getReasoningDepth("course-x", { pseudonyme: "p1", scene_id: "s1" });
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
    const r = await getJournalStats("course-x", {
      pseudonyme: "p1",
      bundle_version: "v0.4",
    });
    expect(r.entries_total).toBe(12);
    expect(r.entries_by_scene["s-disc-1"].count).toBe(7);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/metrics/journal?");
    expect(call[0]).toContain("course=course-x");
    expect(call[0]).toContain("pseudonyme=p1");
    expect(call[0]).toContain("bundle_version=v0.4");
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
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
});
