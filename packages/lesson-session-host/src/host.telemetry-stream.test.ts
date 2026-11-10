// A session that is never closed keeps its telemetry (audit 2026-11-10, D3). Under consent and with a
// durable folder each event is appended when it is emitted: a learner whose harness closes mid-lesson
// leaves the events of the answers given, and a learner who takes the lesson up later loses nothing,
// with no line written twice by the end-of-lesson write. Labelled synthetic learner.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

const QUIZZES = ["q1", "q2", "q3", "q4"];
const base = (id: string, c: string) => ({ id, title: `Scène ${id}`, objective_refs: [], concept_refs: [c], estimated_seconds: 60, adaptation_hooks: [] });
const quiz = (id: string, c: string) => ({
  ...base(id, c), type: "quiz", question: "Question ?",
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const LESSON = {
  schema_version: "1.4", bundle_id: "lesson-stream", source_plan_id: "stream",
  metadata: { title: "Leçon S", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
  concepts: QUIZZES.map((q) => ({ id: `c-${q}`, title: `Notion ${q}`, description: "d", bloom_level_target: "understand" })),
  scenes: QUIZZES.map((q) => quiz(q, `c-${q}`)),
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
};
const LEARNER = "synthetic-audit-telemetry-stream";
const clock = { now: () => "2026-11-10T09:00:00.000Z" };

function right(host: SessionHost, sid: string) {
  const scene = host.currentPresentation(sid).scene as { choices: { id: string; text: string }[] };
  return { kind: "quiz_choice" as const, choiceId: scene.choices.find((c) => c.text === "Juste")!.id, confidence: 2 as const };
}
function stream(dataDir: string): Record<string, unknown>[] {
  const files = (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
  expect(files).toHaveLength(1);
  return readFileSync(join(dataDir, files[0]!), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}
const answered = (events: Record<string, unknown>[]) => events.filter((e) => e["type"] === "quiz_answered").map((e) => e["scene_id"]);

describe("telemetry of a session that is never closed", () => {
  it("is on disk after two answers when the host is dropped, and complete once the lesson is resumed and finished", async () => {
    const root = tmp("telemetry-stream-lib-");
    writeFileSync(join(root, "S.json"), JSON.stringify(LESSON));
    const dataDir = tmp("telemetry-stream-data-");
    await withEnv({ STUDIUM_TELEMETRY_CONSENT: "granted" }, async () => {
      const make = () => new SessionHost({ bundlesRoot: root, live: false, dataDir, clock });
      const first = make();
      const sid = (await first.create("S.json", LEARNER)).sessionId;
      await first.respond(sid, right(first, sid));
      await first.respond(sid, right(first, sid));
      // The harness closes: no end_session, no close; the host is simply dropped.

      const afterQuit = stream(dataDir);
      expect(answered(afterQuit)).toEqual(["q1", "q2"]);

      const again = make();
      const resumed = await again.create("S.json", LEARNER);
      expect(resumed.resume.kind).toBe("resumed");
      await again.respond(resumed.sessionId, right(again, resumed.sessionId));
      const last = await again.respond(resumed.sessionId, right(again, resumed.sessionId));
      expect(last.kind).toBe("complete");
      await again.close(resumed.sessionId);                        // end_session after the end-of-lesson write

      const events = stream(dataDir);
      expect(answered(events)).toEqual(QUIZZES);                    // every answer once, in order
      const ids = events.map((e) => e["event_id"]);
      expect(new Set(ids).size).toBe(ids.length);                   // no line written twice
      expect(events.filter((e) => e["type"] === "consent_granted")).toHaveLength(1);
      expect(events[0]!["type"]).toBe("consent_granted");
      expect(events.filter((e) => e["type"] === "lesson_completed")).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(LEARNER);
    });
  }, 20_000);
});
