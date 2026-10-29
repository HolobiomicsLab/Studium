import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_REQUIRED_MESSAGE, RunRequiredError, SessionHost } from "./host.js";

const FIXTURES = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");
const PASS = {
  ran: true,
  passed: true,
  landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
  artifacts: ["outputs/stats.csv", "figures/decay.png"],
  checks: [
    { check: "file exists: outputs/stats.csv", passed: true },
    { check: "file exists: figures/decay.png", passed: true },
  ],
};

describe("SessionHost run-required guard", () => {
  it("rejects a response before the learner run and accepts the attested run result", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create("capsule-loop-demo/lesson.json", "operator");
    await host.respond(sessionId, { kind: "ack" });

    const blocked = await host.respond(sessionId, { kind: "ack" }).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(RunRequiredError);
    expect((blocked as Error).message).toBe(RUN_REQUIRED_MESSAGE);
    expect(host.currentPresentation(sessionId).scene.type).toBe("reproduction");

    const result = await host.ingestRunResult(sessionId, PASS);
    expect(result.attested).toBe(true);
    expect(result.learnerRunRecorded).toBe(true);
    expect(result.transition?.kind).toBe("next");
    expect(host.currentPresentation(sessionId).scene.type).toBe("spot_the_flaw");
  });
});
