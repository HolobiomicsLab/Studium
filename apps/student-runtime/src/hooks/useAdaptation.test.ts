/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAdaptation } from "./useAdaptation";
import { defaultLearnerState } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";

vi.mock("../lib/tauri", () => ({
  tauri: {
    saveState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getPseudonyme: vi.fn().mockResolvedValue("pseudo-1"),
  },
}));

const rules: AdaptationRule[] = [
  {
    id: "R1",
    modulator: "M1",
    when: { answer_correct: "== false" },
    action: { kind: "replay_current_scene", reason: "retry" },
    explanation_short: "Retry",
  },
];

describe("useAdaptation telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onTelemetryEmit with adaptation_applied when a rule fires", async () => {
    const onTelemetryEmit = vi.fn();
    const initialState = defaultLearnerState("L1");
    const { result } = renderHook(() =>
      useAdaptation(rules, "L1", initialState, onTelemetryEmit),
    );
    await act(async () => {
      await result.current.onSignal({
        kind: "answer_submitted",
        concept_id: "c1",
        scene_id: "s1",
        correct: false,
        time_ms: 1000,
        hint_count: 0,
        difficulty: 0.5,
      });
    });
    const adaptCall = onTelemetryEmit.mock.calls.find(
      (c) => c[0].type === "adaptation_applied",
    );
    expect(adaptCall).toBeTruthy();
    expect(adaptCall![0]).toEqual(
      expect.objectContaining({
        type: "adaptation_applied",
        rule_id: "R1",
        signal: "answer_submitted",
        modulator: "M1",
        value: expect.any(Number),
      }),
    );
  });

  it("does not emit adaptation_applied when no rule matches (fallback)", async () => {
    const onTelemetryEmit = vi.fn();
    const initialState = defaultLearnerState("L1");
    const { result } = renderHook(() =>
      useAdaptation(rules, "L1", initialState, onTelemetryEmit),
    );
    await act(async () => {
      await result.current.onSignal({
        kind: "answer_submitted",
        concept_id: "c1",
        scene_id: "s1",
        correct: true,
        time_ms: 1000,
        hint_count: 0,
        difficulty: 0.5,
      });
    });
    const adaptCall = onTelemetryEmit.mock.calls.find(
      (c) => c[0].type === "adaptation_applied",
    );
    expect(adaptCall).toBeUndefined();
  });

  it("works when onTelemetryEmit is not provided", async () => {
    const initialState = defaultLearnerState("L1");
    const { result } = renderHook(() => useAdaptation(rules, "L1", initialState));
    await act(async () => {
      const d = await result.current.onSignal({
        kind: "answer_submitted",
        concept_id: "c1",
        scene_id: "s1",
        correct: false,
        time_ms: 1000,
        hint_count: 0,
        difficulty: 0.5,
      });
      expect(d.rule_id).toBe("R1");
    });
  });
});
