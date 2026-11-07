// The interaction log of a live session (INT-STUDIUM-058 § 2.10, F14): each act the server settles,
// the help taken, what a contest showed and why a lesson was taken up again go to the consented stream
// as labels, ids, counts and delays, never with a word of the learner or of the lesson. Played on
// fixtures/atomistique-l1 by a labelled synthetic learner (the key is read from the fixture).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import {
  TelemetryEventSchema, InteractionSchema, HelpUsedSchema, ContestEventSchema, ResumeSchema,
} from "../../telemetry-events/src/events.js";
import { SessionHost } from "./host.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const LEARNER = "auto-test-interaction-events";
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as LessonBundle;
type Choice = { id: string; text: string };

const dirs: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

/** The right choice of the quiz on screen, by the id displayed. */
function rightChoice(host: SessionHost, sid: string) {
  const shown = host.currentPresentation(sid).scene as unknown as { id: string; choices: Choice[] };
  const key = (authored.scenes.find((s) => s.id === shown.id) as unknown as { choices: Array<{ text: string; correct: boolean }> }).choices;
  const wanted = key.find((choice) => choice.correct)!.text;
  return { kind: "quiz_choice" as const, choiceId: shown.choices.find((c) => c.text === wanted)!.id, confidence: 2 as const };
}

/** Acts on the panel (rank 3, fast lane) and in the conversation (rank 1, companion lane), a hint
 * taken then refused at the cap, an explanation asked from the panel, a contest settled, the session
 * closed, then the lesson taken up again by a fresh server. */
async function play(): Promise<void> {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
  const sid = (await host.create(ATOMS, LEARNER)).sessionId;
  const panel = { lane: "fast" as const, surfaceRank: 3 as const };
  const chat = { lane: "companion" as const, surfaceRank: 1 as const };
  await host.settleAct(sid, { act: "respond", ...panel, clientMs: 12 }, () => host.respond(sid, { kind: "ack" }, "fast"));
  await host.settleAct(sid, { act: "respond", ...chat }, () => host.respond(sid, { kind: "ack" }));
  expect(host.currentPresentation(sid).scene.id).toBe("s1-quiz-fer");
  expect(await host.settleAct(sid, { act: "hint", ...chat }, () => host.requestHint(sid))).not.toBeNull();
  expect(await host.settleAct(sid, { act: "hint", ...chat }, () => host.requestHint(sid))).toBeNull();   // the cap: no help taken
  await host.settleAct(sid, { act: "ask", ...panel, help: "explain" }, async () => undefined);
  const started = await host.settleAct(sid, { act: "contest", ...panel }, () => host.contest(sid, "c-particules", "known", "fast"));
  expect(started.questions).toBe(1);
  await host.settleAct(sid, { act: "respond", ...panel }, () => host.respond(sid, rightChoice(host, sid), "fast"));
  await host.settleAct(sid, { act: "end", ...chat }, () => host.close(sid));
  // A server restarted: the lesson is taken up where it stopped.
  const again = new SessionHost({ bundlesRoot: FIXTURES, live: false });
  const resumed = await again.create(ATOMS, LEARNER);
  expect(resumed.resume.kind).toBe("resumed");
  await again.close(resumed.sessionId);
}

function telemetryFiles(dataDir: string): string[] {
  return (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
}
const OURS = new Set(["interaction", "help_used", "contest", "resume"]);
const SHAPES: Record<string, readonly string[]> = {
  interaction: Object.keys(InteractionSchema.shape), help_used: Object.keys(HelpUsedSchema.shape),
  contest: Object.keys(ContestEventSchema.shape), resume: Object.keys(ResumeSchema.shape),
};

describe("interaction events in the consented stream", () => {
  it("writes each act with its lane and rank, the help taken, the contest's outcome and the resume", async () => {
    const dataDir = tmp("interaction-events-on-");
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: "granted" }, async () => {
      await play();
      const files = telemetryFiles(dataDir);
      expect(files).toHaveLength(1);
      const raw = readFileSync(join(dataDir, files[0]!), "utf8");
      const events = raw.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).filter((e) => OURS.has(String(e["type"])));
      for (const event of events) {
        expect(TelemetryEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
        // Strict shapes: no key beyond the contract's, so no free text rides along.
        const shape = SHAPES[String(event["type"])]!;
        for (const key of Object.keys(event)) expect(shape, `${String(event["type"])}.${key}`).toContain(key);
        if (event["type"] === "interaction") {
          expect(typeof event["server_ms"]).toBe("number");
          expect(Number(event["server_ms"])).toBeGreaterThanOrEqual(0);
          expect(Math.round(Number(event["server_ms"]) * 10) / 10).toBe(event["server_ms"]);   // one decimal
        }
      }
      const brief = events.map((e) => {
        const { type, act, lane, surface_rank, client_ms, scene_id, rung, concept_id, claim, outcome, questions, cause } = e;
        return Object.fromEntries(Object.entries({ type, act, lane, surface_rank, client_ms, scene_id, rung, concept_id, claim, outcome, questions, cause })
          .filter(([, v]) => v !== undefined));
      });
      expect(brief).toEqual([
        { type: "interaction", act: "respond", lane: "fast", surface_rank: 3, client_ms: 12, scene_id: "s0-intro" },
        { type: "interaction", act: "respond", lane: "companion", surface_rank: 1, scene_id: "s1-concept-particules" },
        { type: "help_used", rung: "hint", scene_id: "s1-quiz-fer" },
        { type: "interaction", act: "hint", lane: "companion", surface_rank: 1, scene_id: "s1-quiz-fer" },
        { type: "interaction", act: "hint", lane: "companion", surface_rank: 1, scene_id: "s1-quiz-fer" },
        { type: "help_used", rung: "explain", scene_id: "s1-quiz-fer" },
        { type: "interaction", act: "ask", lane: "fast", surface_rank: 3, scene_id: "s1-quiz-fer" },
        { type: "interaction", act: "contest", lane: "fast", surface_rank: 3, scene_id: "s1-quiz-fer" },
        { type: "contest", concept_id: "c-particules", claim: "known", outcome: "partial", questions: 1 },
        { type: "interaction", act: "respond", lane: "fast", surface_rank: 3, scene_id: "s9-rappel-carbone14" },
        { type: "interaction", act: "end", lane: "companion", surface_rank: 1 },
        { type: "resume", cause: "restart" },
      ]);
      expect(raw).not.toContain(LEARNER);   // the learner's id stays out
    });
  });

  it("writes nothing without consent", async () => {
    const dataDir = tmp("interaction-events-off-");
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: undefined }, async () => {
      await play();
      expect(telemetryFiles(dataDir)).toEqual([]);
    });
  });
});
