// The seam between the consented stream this host writes and tools/interaction_report.py (audit
// 2026-11-10, D1). The reader refuses a stream that carries no `consent_granted` event; the host now
// opens each consented stream with one (scope B, declared by the operator through
// STUDIUM_TELEMETRY_CONSENT). Five labelled synthetic learners, one of them dropped mid-lesson and
// resumed on a new host, play a short lesson through the real
// host; their streams are the fixture tools/test_interaction_report_server_streams.py reads (a report
// at five, SUPPRESSED at four). This test fails when what the host writes drifts from that fixture.
// Regenerate the fixture from the server with STUDIUM_WRITE_SEAM_FIXTURE=1 (then re-run the Python test).
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TelemetryEventSchema } from "../../telemetry-events/src/events.js";
import { SessionHost } from "./host.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../tools/fixtures/interaction-report/server-streams");
const LEARNERS = 5;

const dirs: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

const base = (id: string, c: string) => ({ id, title: `Scène ${id}`, objective_refs: [], concept_refs: [c], estimated_seconds: 60, adaptation_hooks: [] });
const LESSON = {
  schema_version: "1.4", bundle_id: "lesson-seam", source_plan_id: "seam",
  metadata: { title: "Leçon couture", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
  concepts: ["c-un", "c-deux"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
  scenes: [
    { ...base("s-c", "c-un"), type: "concept", markdown: "Le cours." },
    { ...base("s-q", "c-un"), type: "quiz", question: "Question ?",
      choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
      feedback_correct: "oui", feedback_incorrect: "non", hints: ["Relisez le cours."] },
    { ...base("s-c2", "c-deux"), type: "concept", markdown: "La suite." },
  ],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
};
const clock = { now: () => "2026-11-10T09:00:00.000Z" };

/** The learner who resumes: after the first screen the assistant is closed (no end_session), and a
 * new server takes the lesson up again. Their stream holds two `lesson_started`, one completion. */
const RESUMER = 3;

/** One learner: a screen read on the panel, a hint asked in the conversation, the quiz answered on
 * the panel, the last screen read, the session ended. Learner RESUMER is dropped after the first
 * screen and finishes on a new host over the same folder. */
async function playLearner(make: () => SessionHost, learner: string, i: number): Promise<void> {
  let host = make();
  let sid = (await host.create("seam.json", learner)).sessionId;
  const panel = { lane: "fast" as const, surfaceRank: 3 as const };
  const chat = { lane: "companion" as const, surfaceRank: 1 as const };
  await host.settleAct(sid, { act: "respond", ...panel, clientMs: 100 * i }, () => host.respond(sid, { kind: "ack" }, "fast"));
  if (i === RESUMER) {
    host = make();
    const resumed = await host.create("seam.json", learner);
    expect(resumed.resume.kind).toBe("resumed");
    sid = resumed.sessionId;
  }
  await host.settleAct(sid, { act: "hint", ...chat }, () => host.requestHint(sid));
  const scene = host.currentPresentation(sid).scene as { choices: { id: string; text: string }[] };
  const choiceId = scene.choices.find((c) => c.text === "Juste")!.id;
  await host.settleAct(sid, { act: "respond", ...panel, clientMs: 200 }, () => host.respond(sid, { kind: "quiz_choice", choiceId, confidence: 2 }, "fast"));
  await host.settleAct(sid, { act: "respond", ...panel, clientMs: 150 }, () => host.respond(sid, { kind: "ack" }, "fast"));
  await host.settleAct(sid, { act: "end", ...chat }, () => host.close(sid));
}

type Event = Record<string, unknown>;
const parse = (path: string): Event[] => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Event);
/** The streams of a folder, in learner order: `learner-<n>/<bundle>/telemetry.jsonl` in the fixture. */
function streamsOf(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl")).sort();
}
/** Each event type the streams hold, with its sorted key set: the shape the reader receives. */
function shapes(streams: Event[][]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const event of streams.flat()) out[String(event["type"])] = Object.keys(event).sort();
  return out;
}

describe("the consented stream, as tools/interaction_report.py reads it", () => {
  it("opens each learner's stream with its consent and keeps the shape of the fixture the reader is tested on", async () => {
    const root = tmp("seam-lib-");
    writeFileSync(join(root, "seam.json"), JSON.stringify(LESSON));
    const dataDir = tmp("seam-data-");
    const written: string[] = [];
    await withEnv({ STUDIUM_TELEMETRY_CONSENT: "granted" }, async () => {
      const make = () => new SessionHost({ bundlesRoot: root, live: false, dataDir, clock });
      for (let i = 1; i <= LEARNERS; i++) {
        const before = new Set(streamsOf(dataDir));
        await playLearner(make, `synthetic-audit-seam-${i}`, i);
        written.push(streamsOf(dataDir).find((f) => !before.has(f))!);
      }
    });
    expect(written.filter(Boolean)).toHaveLength(LEARNERS);
    const streams = written.map((f) => parse(join(dataDir, f)));
    for (const events of streams) {
      expect(events[0]!["type"]).toBe("consent_granted");
      expect(events[0]!["scope"]).toBe("B");
      expect(events.filter((e) => e["type"] === "consent_granted")).toHaveLength(1);
      for (const event of events) expect(TelemetryEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
      expect(JSON.stringify(events)).not.toContain("synthetic-audit-seam");
      expect(events.filter((e) => e["type"] === "lesson_completed")).toHaveLength(1);
    }
    expect(streams.map((events) => events.filter((e) => e["type"] === "lesson_started").length))
      .toEqual([1, 1, 1, 1, 1].map((n, i) => (i + 1 === RESUMER ? 2 : n)));

    if (process.env["STUDIUM_WRITE_SEAM_FIXTURE"] === "1") {
      rmSync(FIXTURE, { recursive: true, force: true });
      written.forEach((f, i) => {
        const target = join(FIXTURE, `learner-${i + 1}`, LESSON.bundle_id, "telemetry.jsonl");
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(dataDir, f), target);
      });
    }

    const fixture = streamsOf(FIXTURE).map((f) => parse(join(FIXTURE, f)));
    expect(fixture).toHaveLength(LEARNERS);
    expect(streams.map((events) => events.map((e) => e["type"]))).toEqual(fixture.map((events) => events.map((e) => e["type"])));
    expect(shapes(streams)).toEqual(shapes(fixture));
  }, 30_000);
});
