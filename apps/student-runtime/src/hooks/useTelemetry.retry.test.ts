/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useTelemetry } from "./useTelemetry";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retries only the unpersisted suffix with the same event IDs after an outbox failure", async () => {
  let pushes = 0;
  invoke.mockImplementation(async (command: string) => {
    if (command === "telemetry_outbox_drain") return [];
    if (command === "telemetry_outbox_push" && ++pushes === 2) throw new Error("disk unavailable");
  });
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useTelemetry({
    endpoint: "http://localhost/telemetry", courseToken: "synthetic-retry",
    context: { learner_pseudonym: "synthetic", lesson_id: "retry", bundle_version: "1" },
  }));
  await act(async () => {
    for (const scene_id of ["first", "second", "third"]) {
      result.current.emit({ type: "scene_entered", scene_id, scene_type: "intro" });
    }
    await expect(result.current.flush()).rejects.toThrow("disk unavailable");
    result.current.emit({ type: "scene_entered", scene_id: "newer", scene_type: "intro" });
    await result.current.flush();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  const firstBatch = JSON.parse(fetch.mock.calls[0]![1].body).events;
  const retried = JSON.parse(fetch.mock.calls[1]![1].body).events;
  expect(retried.slice(0, 2)).toEqual(firstBatch.slice(1));
  expect(retried.map((event: { scene_id: string }) => event.scene_id)).toEqual(["second", "third", "newer"]);
});
