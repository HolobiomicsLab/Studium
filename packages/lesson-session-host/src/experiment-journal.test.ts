import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExperimentJournal } from "./experiment-journal.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const predict = { kind: "predict", experiment_id: "threshold", prediction: "  Fewer edges\n", justification: "Fixed nodes; stricter cutoff", confidence: 2, authorship: "learner", consent: true };
const begin = { kind: "begin", experiment_id: "threshold" };
const observe = { kind: "observe", experiment_id: "threshold", text: "Two edges removed", evidence_refs: ["result.json#sha256:abc"], authorship: "learner", consent: true };
const conclude = { kind: "conclude", experiment_id: "threshold", text: "Connectivity is not identity", confidence: 3, authorship: "learner", consent: true };

describe("learner experiment journal", () => {
  it("preserves original text and ordered contributions without accepting a rewritten prediction", () => {
    const journal = new ExperimentJournal("revision-a");
    journal.record(predict, "s1");
    expect(() => journal.record(observe, "s1")).toThrow(/begin/);
    journal.record(begin, "s1");
    journal.record(observe, "s2");
    journal.record(conclude, "s2");
    const events = journal.read().experiments[0]!.events;
    expect(events.map(e => e.input.kind)).toEqual(["predict", "begin", "observe", "conclude"]);
    expect(events.map(e => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(events[0]!.input).toEqual(predict);
    expect(() => journal.record({ ...predict, prediction: "Actually I knew" }, "s1")).toThrow(/immutable/);
    journal.record(conclude, "s2"); // exact retry is idempotent
    expect(journal.read().experiments[0]!.events).toHaveLength(4);
  });

  it("rejects missing prediction, assistant attribution, missing consent and invalid confidence", () => {
    const journal = new ExperimentJournal("revision-a");
    expect(() => journal.record(begin, "s1")).toThrow(/prediction/);
    for (const patch of [{ authorship: "assistant" }, { consent: false }, { confidence: 5 }, { prediction: "  " }, { surprise: "hidden" }]) {
      expect(() => journal.record({ ...predict, ...patch }, "s1")).toThrow();
    }
    expect(journal.read().experiments).toEqual([]);
  });

  it("resumes from disk, isolates revisions, handles concurrent journal instances and erases", () => {
    const dir = mkdtempSync(join(tmpdir(), "experiment-journal-")); dirs.push(dir);
    const first = new ExperimentJournal("revision-a", dir);
    first.record(predict, "s1");
    const second = new ExperimentJournal("revision-a", dir);
    second.record(begin, "s1");
    first.record(observe, "s2");
    second.record(conclude, "s2");
    expect(first.read().experiments[0]!.events).toHaveLength(4);
    expect(new ExperimentJournal("revision-b", dir).read().experiments).toEqual([]);
    first.erase();
    expect(second.read().experiments).toEqual([]);
  });

  it("does not expose mutable internal state in ephemeral mode", () => {
    const journal = new ExperimentJournal("revision-a");
    journal.record(predict, "s1");
    journal.read().experiments.splice(0);
    expect(journal.read().experiments).toHaveLength(1);
  });
});
