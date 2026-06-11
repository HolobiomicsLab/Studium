import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLearnerState } from "@studium/learner-state";
import { FileStateStore } from "./state-store.js";
import { JsonlEventLog } from "./event-log.js";
import { JsonlTelemetrySink, HttpTelemetrySink } from "./telemetry-sink.js";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "ls-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("persistence adapters", () => {
  it("FileStateStore round-trips learner state", async () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    expect(await store.load("L1")).toBeNull();
    const st = defaultLearnerState("L1");
    await store.save("L1", st);
    const loaded = await store.load("L1");
    expect(loaded?.lesson_id).toBe("L1");
  });
  it("JsonlEventLog appends one line per record", async () => {
    const dir = tmp();
    const file = join(dir, "events.jsonl");
    const log = new JsonlEventLog(file);
    await log.append({ event_id: "e1", session_id: "s", pseudonyme: "p", lesson_id: "L1", schema_version: "1.0", timestamp: "t", event_type: "scene_completed", payload: {} });
    await log.append({ event_id: "e2", session_id: "s", pseudonyme: "p", lesson_id: "L1", schema_version: "1.0", timestamp: "t", event_type: "scene_entered", payload: {} });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).event_id).toBe("e1");
  });
  it("JsonlTelemetrySink buffers then flushes to file", async () => {
    const dir = tmp();
    const file = join(dir, "telemetry.jsonl");
    const sink = new JsonlTelemetrySink(file);
    sink.emit({ type: "lesson_started" } as never);
    await sink.flush();
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });
  it("HttpTelemetrySink POSTs the buffered batch", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sink = new HttpTelemetrySink("http://localhost:9999/telemetry", "tok");
    sink.emit({ type: "lesson_started" } as never);
    await sink.flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toContain("/telemetry");
    expect(call[1]?.method).toBe("POST");
  });
});

describe("FileStateStore — path-traversal hardening (#3 durable host security)", () => {
  it("a `../`-laden lessonId/bundle_id round-trips and writes NOTHING outside the store dir", async () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    // A crafted bundle_id with parent-dir segments. On the OLD code this escaped `dir`:
    //   join(dir, "state-../../../../etc/evil.json") -> resolves OUTSIDE dir.
    const evil = "../../../../etc/evil";
    const st = defaultLearnerState(evil);
    await store.save(evil, st);
    // round-trips (load + save agree on the sanitized filename)
    const loaded = await store.load(evil);
    expect(loaded?.lesson_id).toBe(evil);
    // the sentinel path the traversal WOULD have hit must NOT exist
    expect(existsSync(join(dir, "..", "..", "..", "..", "etc", "evil"))).toBe(false);
    expect(existsSync(join(dir, "..", "..", "..", "..", "etc", "evil.json"))).toBe(false);
    // every file the store created lives directly under `dir` (no escape, no subdirs)
    const entries = readdirSync(dir, { withFileTypes: true });
    expect(entries.every((e) => e.isFile())).toBe(true);
    expect(entries.every((e) => existsSync(join(dir, e.name)))).toBe(true);
  });

  it("two distinct crafted lessonIds that both escaped the store dir now map to DISTINCT in-dir files (no cross-learner bleed)", async () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    // On the OLD code both escaped `dir` via the leading `../`; the danger was that crafted ids
    // collided onto ONE shared escaped file (cross-learner bleed). Distinct ids must stay distinct
    // AND stay inside `dir`.
    const a = "../../leak/learner-a";
    const b = "../../leak/learner-b";
    await store.save(a, defaultLearnerState("learner-A"));
    await store.save(b, defaultLearnerState("learner-B"));
    expect((await store.load(a))?.lesson_id).toBe("learner-A");
    expect((await store.load(b))?.lesson_id).toBe("learner-B");
    const files = readdirSync(dir).filter((f) => f.startsWith("state-"));
    expect(new Set(files).size).toBe(2);
    // and the would-be escape target dir does not exist
    expect(existsSync(join(dir, "..", "..", "leak"))).toBe(false);
  });

  it("a lessonId containing a path separator does NOT throw (no ENOENT) and round-trips", async () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    const sep = "course:001/unit/2"; // ':' and '/' — would create missing parent dirs on old code
    await expect(store.save(sep, defaultLearnerState(sep))).resolves.toBeUndefined();
    expect((await store.load(sep))?.lesson_id).toBe(sep);
    // file is a single flat segment under dir, not nested
    expect(readdirSync(dir).some((f) => f.startsWith("state-") && f.endsWith(".json"))).toBe(true);
  });
});

describe("persistence adapters — RGPD erasure (#4)", () => {
  it("FileStateStore.delete removes the state-<lessonId>.json file", async () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    await store.save("L1", defaultLearnerState("L1"));
    expect(existsSync(join(dir, "state-L1.json"))).toBe(true);
    await store.delete("L1");
    expect(existsSync(join(dir, "state-L1.json"))).toBe(false);
    expect(await store.load("L1")).toBeNull();
  });
  it("FileStateStore.delete is a no-op when nothing was written (force)", async () => {
    const dir = tmp();
    await expect(new FileStateStore(dir).delete("missing")).resolves.toBeUndefined();
  });
  it("JsonlEventLog.purge deletes the whole log file (per-session isolation)", async () => {
    const dir = tmp();
    const file = join(dir, "events.jsonl");
    const log = new JsonlEventLog(file);
    await log.append({ event_id: "e1", session_id: "s", pseudonyme: "p", lesson_id: "L1", schema_version: "1.0", timestamp: "t", event_type: "scene_completed", payload: {} });
    expect(existsSync(file)).toBe(true);
    await log.purge();
    expect(existsSync(file)).toBe(false);
  });

  it("JsonlTelemetrySink.purge deletes the telemetry file AND clears the buffer", async () => {
    const dir = tmp();
    const file = join(dir, "telemetry.jsonl");
    const sink = new JsonlTelemetrySink(file);
    sink.emit({ type: "lesson_started" } as never);
    await sink.flush();                                          // writes the file
    expect(existsSync(file)).toBe(true);
    // emit another event into the buffer (not yet flushed)
    sink.emit({ type: "scene_entered" } as never);
    await sink.purge();
    expect(existsSync(file)).toBe(false);                       // file is gone
    // buffer is also cleared — a subsequent flush must not re-create the file
    await sink.flush();
    expect(existsSync(file)).toBe(false);
  });

  it("JsonlTelemetrySink.purge is a no-op when the file never existed (force)", async () => {
    const dir = tmp();
    const file = join(dir, "telemetry.jsonl");
    const sink = new JsonlTelemetrySink(file);
    await expect(sink.purge()).resolves.toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });
});
