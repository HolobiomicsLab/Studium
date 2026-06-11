import { describe, it, expect } from "vitest";
import { InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink, InMemoryMasteryClaimSink } from "./in-memory.js";
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

describe("in-memory adapters — RGPD erasure (#4)", () => {
  it("StateStore.delete removes the learner state entry", async () => {
    const s = new InMemoryStateStore();
    await s.save("L1", defaultLearnerState("L1"));
    await s.delete("L1");
    expect(await s.load("L1")).toBeNull();
    expect(s.saved.size).toBe(0);
  });
  it("EventLog.purge clears all records", async () => {
    const e = new InMemoryEventLog();
    await e.append({ event_id: "e1", session_id: "s", pseudonyme: "p", lesson_id: "L1", schema_version: "1.0", timestamp: "t", event_type: "scene_completed", payload: {} });
    await e.purge();
    expect(e.records).toHaveLength(0);
  });
  it("MasteryClaimSink.erase drops emitted docs AND the unflushed buffer", async () => {
    const m = new InMemoryMasteryClaimSink();
    m.emit({ "@context": {}, "@id": "urn:studium:mastery-set:L1:s1", "@graph": [{ "@type": "asb:Claim" }] });
    await m.flush();
    m.emit({ "@context": {}, "@id": "urn:studium:mastery-set:L1:s2", "@graph": [{ "@type": "asb:Claim" }] });
    await m.erase();
    expect(m.docs).toHaveLength(0);
  });
  it("TelemetrySink.purge clears buffered events", async () => {
    const t = new InMemoryTelemetrySink();
    t.emit({ type: "lesson_started" } as never);
    await t.purge();
    expect(t.events).toHaveLength(0);
  });
});
