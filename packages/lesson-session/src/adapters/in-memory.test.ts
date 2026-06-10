import { describe, it, expect } from "vitest";
import { InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink } from "./in-memory.js";
import { defaultLearnerState } from "@studium/learner-state";

describe("in-memory adapters (production)", () => {
  it("StateStore round-trips and starts empty", async () => {
    const s = new InMemoryStateStore();
    expect(await s.load("L1")).toBeNull();
    await s.save("L1", defaultLearnerState("L1"));
    expect((await s.load("L1"))?.lesson_id).toBe("L1");
  });
  it("EventLog appends to an observable array", async () => {
    const e = new InMemoryEventLog();
    await e.append({ event_id: "e1", session_id: "s", pseudonyme: "p", lesson_id: "L1", schema_version: "1.0", timestamp: "t", event_type: "scene_completed", payload: {} });
    expect(e.records).toHaveLength(1);
  });
  it("TelemetrySink buffers in an observable array", () => {
    const t = new InMemoryTelemetrySink();
    t.emit({ type: "lesson_started" } as never);
    expect(t.events).toHaveLength(1);
  });
});
