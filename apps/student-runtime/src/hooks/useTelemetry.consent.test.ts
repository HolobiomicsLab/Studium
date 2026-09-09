/**
 * @vitest-environment jsdom
 *
 * jsdom because the override case is the one that matters: `getTelemetryEndpoint` reads
 * `window`, and under the default node environment it returns the fallback whatever is set —
 * which would make the bypass assertion below pass without measuring anything.
 *
 * INT-STUDIUM-030 — the consent screen recorded a grant that nothing enforced.
 *
 * `ConsentScreen` writes `level_b` and the guide promises the learner that transmission to
 * the teacher's dashboard is theirs to refuse. No caller read it: `LessonPlayer` passed
 * `getTelemetryEndpoint(null)`, and that function resolves a CONFIGURATION — it returns
 * `window.__telemetry_endpoint` whenever one is set, which is exactly the mode a deployment
 * and the E2E harness run in. So a learner who ticked only A still transmitted.
 *
 * The gate fails CLOSED, and these are the cases that matter: no record at all, a read that
 * failed, a record without the grant, and the test override — which must not be a way around
 * consent, since it is the only mode in which the app actually transmits.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getTelemetryEndpoint, resolveTelemetryEndpoint } from "./useTelemetry";

const w = window as unknown as { __telemetry_endpoint?: string };

afterEach(() => {
  delete w.__telemetry_endpoint;
});

describe("resolveTelemetryEndpoint — transmission is a grant, not a default", () => {
  it("returns null when there is no consent record", () => {
    expect(resolveTelemetryEndpoint(null, "http://localhost:8003/telemetry")).toBeNull();
    expect(resolveTelemetryEndpoint(undefined, "http://localhost:8003/telemetry")).toBeNull();
  });

  it("returns null when the record carries no level B grant", () => {
    expect(resolveTelemetryEndpoint({}, "http://localhost:8003/telemetry")).toBeNull();
    expect(resolveTelemetryEndpoint({ level_b: false }, "http://localhost:8003/telemetry"))
      .toBeNull();
  });

  it("returns the configured endpoint once the grant is present", () => {
    expect(resolveTelemetryEndpoint({ level_b: true }, "http://localhost:8003/telemetry"))
      .toBe("http://localhost:8003/telemetry");
  });

  it("a granted learner with no endpoint configured still transmits nowhere", () => {
    expect(resolveTelemetryEndpoint({ level_b: true }, null)).toBeNull();
  });

  it("the window override does NOT bypass consent", () => {
    w.__telemetry_endpoint = "http://localhost:8003/telemetry";
    // The override is live — this is the mode the E2E harness and a real deployment run in.
    expect(getTelemetryEndpoint(null)).toBe("http://localhost:8003/telemetry");
    // ...and it is still refused without the grant. This is the case the missing gate hid:
    // every other path already resolved to null on its own.
    expect(resolveTelemetryEndpoint(null, null)).toBeNull();
    expect(resolveTelemetryEndpoint({ level_b: false }, null)).toBeNull();
    expect(resolveTelemetryEndpoint({ level_b: true }, null))
      .toBe("http://localhost:8003/telemetry");
  });
});
