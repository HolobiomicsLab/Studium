/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProgress, getCalibration, getAutonomy } from "./api";

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
