import { afterEach, describe, expect, it, vi } from "vitest";
import { getProgress, getLearnerItems, getCourse } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("service failures give a teacher a next action", () => {
  it.each([
    [() => getProgress("course"), "analytics-collector", "8003"],
    [() => getLearnerItems("course"), "scene-synth", "8002"],
    [() => getCourse("courses/example.json"), "lesson-server", "8010"],
  ] as const)("names the service and startup port on a connection failure", async (read, service, port) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed private diagnostic")));
    await expect(read()).rejects.toThrow(service);
    await expect(read()).rejects.toThrow(port);
    await expect(read()).rejects.not.toThrow("private diagnostic");
  });
  it("explains an authorization failure without publishing the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" }));
    await expect(getProgress("PRIVATE_COURSE_TOKEN")).rejects.toThrow(/401.*identifiant/);
    await expect(getProgress("PRIVATE_COURSE_TOKEN")).rejects.not.toThrow("PRIVATE_COURSE_TOKEN");
  });
});
