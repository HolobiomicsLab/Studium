/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useReasoningScorer } from "./useReasoningScorer";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useReasoningScorer", () => {
  it("calls scorer and emits reasoning_signal on success", async () => {
    const emit = vi.fn();
    const scorer = vi.fn(async () => ({ signal: "justification" as const, confidence: 0.8 }));
    const { result } = renderHook(() =>
      useReasoningScorer({ emit, scorer, topic: "T", sceneId: "s1" }),
    );
    await act(async () => { await result.current.scoreTurn("turn text", 0); });
    expect(emit).toHaveBeenCalledWith({
      type: "reasoning_signal", scene_id: "s1", signal: "justification",
      confidence: 0.8, turn_index: 0,
    });
  });

  it("does not emit when scorer returns null", async () => {
    const emit = vi.fn();
    const scorer = vi.fn(async () => null);
    const { result } = renderHook(() =>
      useReasoningScorer({ emit, scorer, topic: "T", sceneId: "s1" }),
    );
    await act(async () => { await result.current.scoreTurn("x", 0); });
    expect(emit).not.toHaveBeenCalled();
  });

  it("respects 1s rate-limit between consecutive calls", async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const scorer = vi.fn(async () => ({ signal: "question" as const, confidence: 0.5 }));
    const { result } = renderHook(() =>
      useReasoningScorer({ emit, scorer, topic: "T", sceneId: "s1" }),
    );
    await act(async () => { await result.current.scoreTurn("a", 0); });
    await act(async () => { await result.current.scoreTurn("b", 1); });
    expect(scorer).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1100); });
    await act(async () => { await result.current.scoreTurn("c", 2); });
    expect(scorer).toHaveBeenCalledTimes(2);
  });
});
