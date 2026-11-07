// A lesson taken up again says so (INT-STUDIUM-058 § 2.6, walkthrough of 7 Nov): the first screen of
// a resumed session carries a resume notice with the step it resumes at, on the panel view and in the
// conversation text, and the notice leaves with that scene. Learners here are labelled synthetic ones.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelemetryEventSchema } from "../../telemetry-events/src/events.js";
import { SessionHost } from "./host.js";

const T0 = Date.parse("2026-11-07T09:00:00Z");
const dirs: string[] = [];
function tmp(prefix = "host-resume-notice-"): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

const base = (id: string, c: string) => ({ id, title: `Scène ${id}`, objective_refs: [], concept_refs: [c], estimated_seconds: 60, adaptation_hooks: [] });
const concept = (id: string, c: string) => ({ ...base(id, c), type: "concept", markdown: "Le cours." });
const quiz = (id: string, c: string) => ({
  ...base(id, c), type: "quiz", question: "Question ?",
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const lesson = (language: "fr" | "en") => ({
  schema_version: "1.4", bundle_id: "lesson-r", source_plan_id: "r",
  metadata: { title: "Leçon R", target: "L1", duration_minutes: 5, language, discipline: "chimie" },
  concepts: ["c-un", "c-deux"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
  scenes: [concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c2", "c-deux"), concept("s-c3", "c-deux")],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
});
function library(language: "fr" | "en" = "fr"): string {
  const root = tmp();
  writeFileSync(join(root, "R.json"), JSON.stringify(lesson(language)));
  return root;
}
const LEARNER = "auto-test-resume-notice";
const clock = { now: () => new Date(T0).toISOString() };
function choice(host: SessionHost, sid: string, text: string): string {
  const scene = host.currentPresentation(sid).scene as { choices?: { id: string; text: string }[] };
  return scene.choices!.find((c) => c.text === text)!.id;
}
/** Open the lesson, play `answers` screens of it, close it; then take it up again. */
async function resumedAfter(answers: 1 | 2, opts: { root?: string; dataDir?: string | null } = {}) {
  const root = opts.root ?? library();
  const dataDir = opts.dataDir === undefined ? tmp() : opts.dataDir;
  const make = () => new SessionHost({ bundlesRoot: root, live: false, ...(dataDir === null ? {} : { dataDir }), clock });
  const first = make();
  const { sessionId } = await first.create("R.json", LEARNER);
  await first.respond(sessionId, { kind: "ack" });
  if (answers === 2) await first.respond(sessionId, { kind: "quiz_choice", choiceId: choice(first, sessionId, "Juste"), confidence: 2 });
  await first.close(sessionId);
  const host = make();
  const started = await host.create("R.json", LEARNER);
  return { host, started, sid: started.sessionId };
}
const notices = <P extends { kind: string }>(prompts: P[]): P[] => prompts.filter((p) => p.kind === "resume_notice");

describe("the resume notice", () => {
  it("is on the first screen of a lesson taken up again, with the step it resumes at, and leaves with that scene", async () => {
    const { host, started, sid } = await resumedAfter(2);
    expect(started.resume.kind).toBe("resumed");
    expect(started.presentation.scene.id).toBe("s-c2");
    expect(notices(host.sessionPrompts(sid, { locale: "fr" }))).toEqual([
      { id: "resume_notice:s-c2", kind: "resume_notice", reason: "Reprise à l'étape 3 sur 4.", expires: "scene" },
    ]);
    // The conversation text of the first screen says it too, before the status line.
    const text = started.presentation.display_markdown as string;
    expect(text).toContain("> Reprise à l'étape 3 sur 4.");
    expect(text.indexOf("> Reprise")).toBeLessThan(text.lastIndexOf("`Leçon R"));
    const next = await host.respond(sid, { kind: "ack" });
    expect(next.display_markdown).not.toContain("Reprise");
    expect(notices(host.sessionPrompts(sid, { locale: "fr" }))).toEqual([]);
    expect(host.promptRecords(sid)).toEqual([]);                            // a notice is never counted
  }, 20_000);

  it("is let out even while the resumed screen asks a question, and in quiet mode", async () => {
    const { host, started, sid } = await resumedAfter(1);
    expect(started.resume.kind).toBe("resumed");
    expect(started.presentation.scene.id).toBe("s-q");
    expect(started.presentation.display_markdown).toContain("> Reprise à l'étape 2 sur 4.");
    expect(notices(host.sessionPrompts(sid, { locale: "fr", attention: "quiet" })).map((p) => p.reason)).toEqual(["Reprise à l'étape 2 sur 4."]);
  }, 20_000);

  it("speaks the lesson's language", async () => {
    const { host, started, sid } = await resumedAfter(2, { root: library("en") });
    expect(started.presentation.display_markdown).toContain("> Resumed at step 3 of 4.");
    expect(notices(host.sessionPrompts(sid, { locale: "en" })).map((p) => p.reason)).toEqual(["Resumed at step 3 of 4."]);
  }, 20_000);

  it("is not on a fresh session", async () => {
    const host = new SessionHost({ bundlesRoot: library(), live: false, dataDir: tmp(), clock });
    const started = await host.create("R.json", LEARNER);
    expect(started.resume.kind).toBe("new");
    expect(started.presentation.display_markdown).not.toContain("Reprise");
    expect(notices(host.sessionPrompts(started.sessionId, { locale: "fr" }))).toEqual([]);
  });

  it("is logged once as shown in a consented durable run", async () => {
    const dataDir = tmp("host-resume-notice-data-");
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: "granted" }, async () => {
      const { host, sid } = await resumedAfter(2, { dataDir: null });
      host.sessionPrompts(sid, { locale: "fr" });
      await host.close(sid);
      const events = (readdirSync(dataDir, { recursive: true }) as string[]).map(String)
        .filter((f) => f.endsWith("telemetry.jsonl"))
        .flatMap((f) => readFileSync(join(dataDir, f), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
      const shown = events.filter((e) => e["type"] === "prompt_shown");
      for (const event of shown) expect(TelemetryEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
      // Said first in the conversation text of start_lesson_session: rank 1.
      expect(shown.map(({ kind, attention, surface_rank, scene_id }) => ({ kind, attention, surface_rank, scene_id }))).toEqual([
        { kind: "resume_notice", attention: "normal", surface_rank: 1, scene_id: "s-c2" },
      ]);
      expect(JSON.stringify(events)).not.toContain("Reprise");               // the notice's words stay out
    });
  }, 20_000);
});
