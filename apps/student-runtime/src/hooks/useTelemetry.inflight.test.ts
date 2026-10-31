/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useTelemetry } from "./useTelemetry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string) => {
  if (command === "telemetry_outbox_drain") return [];
  throw new Error("disk unavailable");
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("a manual flush waits for an automatic batch and observes its persistence failure", async () => {
  let rejectNetwork!: (error: Error) => void;
  const fetch = vi.fn().mockReturnValueOnce(new Promise((_resolve, reject) => { rejectNetwork = reject; }))
    .mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useTelemetry({
    endpoint: "http://localhost/telemetry", courseToken: "synthetic-inflight", batchSize: 1,
    context: { learner_pseudonym: "synthetic", lesson_id: "inflight", bundle_version: "1" },
  }));
  await act(async () => {
    result.current.emit({ type: "scene_entered", scene_id: "first", scene_type: "intro" });
    const manual = result.current.flush();
    let settled = false;
    void manual.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    rejectNetwork(new Error("offline"));
    await expect(manual).rejects.toThrow("disk unavailable");
    await result.current.flush();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(JSON.parse(fetch.mock.calls[0]![1].body));
});
