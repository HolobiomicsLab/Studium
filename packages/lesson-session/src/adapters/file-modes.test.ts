// L-11 (2026-10-30, storage safety): the learner's files are readable by the learner's account only.
// The durable adapters of this package write the per-bundle state, the event log, the telemetry and
// the mastery claims inside the learner's folder: files 0600, folders they create 0700.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLearnerState } from "@studium/learner-state";
import { FileStateStore } from "./state-store.js";
import { JsonlEventLog } from "./event-log.js";
import { JsonlTelemetrySink } from "./telemetry-sink.js";
import { FileMasteryClaimSink } from "./mastery-claim-sink.js";

const mode = (path: string) => statSync(path).mode & 0o777;

describe.skipIf(process.platform === "win32")("L-11 — learner files are private", () => {
  it("state, event log, telemetry and mastery claims are 0600 in 0700 folders", async () => {
    const root = mkdtempSync(join(tmpdir(), "file-modes-"));
    try {
      const learner = join(root, "learner");
      await new FileStateStore(join(learner, "state")).save("b", defaultLearnerState("b"));
      expect(mode(join(learner, "state"))).toBe(0o700);
      expect(mode(join(learner, "state", "state-b.json"))).toBe(0o600);

      const log = join(learner, "logs", "events.jsonl");
      await new JsonlEventLog(log).append({ event_id: "e", session_id: "s", pseudonyme: "p", lesson_id: "b", schema_version: "1.0", timestamp: "t", event_type: "x", payload: {} } as never);
      expect(mode(join(learner, "logs"))).toBe(0o700);
      expect(mode(log)).toBe(0o600);

      const telemetry = join(learner, "telemetry", "t.jsonl");
      const sink = new JsonlTelemetrySink(telemetry);
      sink.emit({ type: "x" } as never);
      await sink.flush();
      expect(mode(telemetry)).toBe(0o600);

      const claims = new FileMasteryClaimSink(join(learner, "claims"));
      claims.emit({ "@id": "doc", "@graph": [] } as never);
      await claims.flush();
      expect(mode(join(learner, "claims"))).toBe(0o700);
      expect(mode(join(learner, "claims", "doc.jsonld"))).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
