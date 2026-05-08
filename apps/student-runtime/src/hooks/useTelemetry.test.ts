/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTelemetry, type TelemetryContext } from "./useTelemetry";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args?: unknown) => mockInvoke(name, args),
}));

const ctx: TelemetryContext = {
  learner_pseudonym: "pseudo-1",
  lesson_id: "L1",
  bundle_version: "v1",
};

describe("useTelemetry", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  it("buffers events and flushes by batch", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });
    const { result } = renderHook(() =>
      useTelemetry({
        endpoint: "https://example.com/telemetry",
        courseToken: "course-x",
        context: ctx,
        batchSize: 2,
      }),
    );
    await act(async () => {
      result.current.emit({
        type: "scene_entered",
        scene_id: "s1",
        scene_type: "concept",
      });
      result.current.emit({
        type: "scene_entered",
        scene_id: "s2",
        scene_type: "quiz",
      });
      // let microtasks resolve
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[1].headers["X-Course-Token"]).toBe("course-x");
    const body = JSON.parse(call[1].body);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].learner_pseudonym).toBe("pseudo-1");
    expect(body.events[0].lesson_id).toBe("L1");
    expect(body.events[0].bundle_version).toBe("v1");
    expect(body.events[0].client_timestamp).toBeTruthy();
  });

  it("stores in outbox on fetch failure", async () => {
    (global.fetch as any).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() =>
      useTelemetry({
        endpoint: "https://example.com/telemetry",
        courseToken: "c",
        context: ctx,
        batchSize: 1,
      }),
    );
    await act(async () => {
      result.current.emit({ type: "scene_entered", scene_id: "s1", scene_type: "concept" });
      await new Promise((r) => setTimeout(r, 0));
    });
    const pushCalls = mockInvoke.mock.calls.filter((c) => c[0] === "telemetry_outbox_push");
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0][1].eventJson).toContain('"type":"scene_entered"');
  });

  it("stores in outbox on non-2xx status", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() =>
      useTelemetry({
        endpoint: "https://example.com/telemetry",
        courseToken: "c",
        context: ctx,
        batchSize: 1,
      }),
    );
    await act(async () => {
      result.current.emit({ type: "scene_entered", scene_id: "s1", scene_type: "concept" });
      await new Promise((r) => setTimeout(r, 0));
    });
    const pushCalls = mockInvoke.mock.calls.filter((c) => c[0] === "telemetry_outbox_push");
    expect(pushCalls).toHaveLength(1);
  });

  it("drains outbox on mount and resends", async () => {
    const queued = JSON.stringify({
      type: "scene_entered",
      scene_id: "old",
      scene_type: "concept",
      event_id: "e",
      learner_pseudonym: "p",
      lesson_id: "L1",
      bundle_version: "v1",
      client_timestamp: "2026-05-09T00:00:00Z",
    });
    mockInvoke.mockImplementation((name: string) => {
      if (name === "telemetry_outbox_drain") return Promise.resolve([queued]);
      return Promise.resolve(undefined);
    });
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });
    renderHook(() =>
      useTelemetry({
        endpoint: "https://example.com/telemetry",
        courseToken: "c",
        context: ctx,
        batchSize: 10,
      }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mockInvoke).toHaveBeenCalledWith("telemetry_outbox_drain", undefined);
    expect(global.fetch).toHaveBeenCalled();
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.events[0].scene_id).toBe("old");
  });

  it("does not call fetch when endpoint is null", async () => {
    const { result } = renderHook(() =>
      useTelemetry({
        endpoint: null,
        courseToken: "c",
        context: ctx,
        batchSize: 1,
      }),
    );
    await act(async () => {
      result.current.emit({ type: "scene_entered", scene_id: "s1", scene_type: "concept" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("flush() empties the buffer manually", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });
    const { result } = renderHook(() =>
      useTelemetry({
        endpoint: "https://example.com/telemetry",
        courseToken: "c",
        context: ctx,
        batchSize: 100, // never auto-flush
      }),
    );
    await act(async () => {
      result.current.emit({ type: "scene_entered", scene_id: "s1", scene_type: "concept" });
      result.current.emit({ type: "scene_entered", scene_id: "s2", scene_type: "concept" });
      await result.current.flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.events).toHaveLength(2);
  });
});
