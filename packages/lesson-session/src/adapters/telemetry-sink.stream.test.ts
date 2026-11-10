// The learner's telemetry stream on disk (audit 2026-11-10, D1 and D3). Each event is appended when it
// is emitted, so a process that dies loses nothing already emitted, and a flush never writes a line
// twice. A sink opened under the operator's consent starts a NEW stream with the proof of that consent
// (`consent_granted`), which tools/interaction_report.py requires; a stream already on disk is never
// given one afterwards — neither a second one nor, for a stream written before this version, a first.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelemetryEventSchema, type TelemetryEvent } from "@studium/telemetry-events";
import { JsonlTelemetrySink } from "./telemetry-sink.js";

const dirs: string[] = [];
function file(): string { const d = mkdtempSync(join(tmpdir(), "telemetry-stream-")); dirs.push(d); return join(d, "learner", "telemetry.jsonl"); }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const envelope = {
  learner_pseudonym: "hmac:synthetic", lesson_id: "lesson-x", bundle_version: "1.4:lesson-x@2026-11-01T00:00:00Z",
};
const started = (n: number): TelemetryEvent => ({
  ...envelope, event_id: `00000000-0000-4000-8000-00000000000${n}`, client_timestamp: `2026-11-10T09:00:0${n}.000Z`,
  type: "lesson_started", bundle_uri: "lesson-x.json",
});
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

describe("JsonlTelemetrySink — append as emitted", () => {
  it("writes an event to the stream when it is emitted, before any flush", () => {
    const path = file();
    const sink = new JsonlTelemetrySink(path);
    sink.emit(started(1));
    expect(lines(path).map((e) => e["event_id"])).toEqual([started(1).event_id]);
    sink.emit(started(2));
    expect(lines(path).map((e) => e["event_id"])).toEqual([started(1).event_id, started(2).event_id]);
  });

  it("never writes a line twice when it is flushed, at lesson end or at end_session", async () => {
    const path = file();
    const sink = new JsonlTelemetrySink(path);
    sink.emit(started(1));
    await sink.flush();
    sink.emit(started(2));
    await sink.flush();
    await sink.flush();
    expect(lines(path).map((e) => e["event_id"])).toEqual([started(1).event_id, started(2).event_id]);
  });

  it("forget still removes the stream", async () => {
    const path = file();
    const sink = new JsonlTelemetrySink(path);
    sink.emit(started(1));
    await sink.purge();
    expect(existsSync(path)).toBe(false);
  });
});

describe("JsonlTelemetrySink — the consent the operator declared", () => {
  it("starts a new stream with one consent_granted event of the contract, scope B, on the first event's envelope", () => {
    const path = file();
    const sink = new JsonlTelemetrySink(path, { consentScope: "B" });
    sink.emit(started(1));
    sink.emit(started(2));
    const events = lines(path);
    expect(events.map((e) => e["type"])).toEqual(["consent_granted", "lesson_started", "lesson_started"]);
    const consent = events[0]!;
    expect(TelemetryEventSchema.safeParse(consent).success, JSON.stringify(consent)).toBe(true);
    expect(consent).toMatchObject({ ...envelope, scope: "B", client_timestamp: started(1).client_timestamp });
    expect(consent["event_id"]).not.toBe(started(1).event_id);
  });

  it("gives a resumed learner's stream no second consent event", () => {
    const path = file();
    new JsonlTelemetrySink(path, { consentScope: "B" }).emit(started(1));
    new JsonlTelemetrySink(path, { consentScope: "B" }).emit(started(2));
    expect(lines(path).map((e) => e["type"])).toEqual(["consent_granted", "lesson_started", "lesson_started"]);
  });

  it("leaves a stream written before this version without one: it stays refused by the usage report", () => {
    const path = file();
    new JsonlTelemetrySink(path).emit(started(1));                 // an older stream, no consent line
    new JsonlTelemetrySink(path, { consentScope: "B" }).emit(started(2));
    expect(lines(path).map((e) => e["type"])).toEqual(["lesson_started", "lesson_started"]);
  });

  it("writes none without the option (the eval harness's sink)", () => {
    const path = file();
    new JsonlTelemetrySink(path).emit(started(1));
    expect(lines(path).map((e) => e["type"])).toEqual(["lesson_started"]);
  });

  it("starts again with a consent event after forget removed the stream", async () => {
    const path = file();
    const sink = new JsonlTelemetrySink(path, { consentScope: "B" });
    sink.emit(started(1));
    await sink.purge();
    writeFileSync(path, "");                                       // an empty stream is a new one
    sink.emit(started(2));
    expect(lines(path).map((e) => e["type"])).toEqual(["consent_granted", "lesson_started"]);
  });
});
