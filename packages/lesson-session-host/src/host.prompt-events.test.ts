// The prompt events of a live session (INT-STUDIUM-058 § 2.10): a proposal shown and what became of
// it go to the consented stream as labels and references, never with the proposal's words, and
// nothing is written without consent. The learner here is a labelled synthetic one.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelemetryEventSchema } from "../../telemetry-events/src/events.js";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

const scene = (id: string, concept: string) => ({
  id, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [], type: "concept", markdown: "Le cours.",
});
function library(): string {
  const root = tmp("prompt-events-lib-");
  writeFileSync(join(root, "P.json"), JSON.stringify({
    schema_version: "1.4", bundle_id: "lesson-p", source_plan_id: "p",
    metadata: { title: "Leçon P", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: ["c-un", "c-deux"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes: [scene("s-c", "c-un"), scene("s-c2", "c-deux")], rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  }));
  return root;
}

/** Forms offered on the first screen and declined, then the map offered at the end and left unanswered. */
async function play(host: SessionHost): Promise<void> {
  const { sessionId } = await host.create("P.json", "auto-test-prompt-events");
  const ask = { locale: "fr" as const, surfaceRank: 1 as const, formsAvailable: true };
  expect(host.sessionPrompts(sessionId, ask).map((p) => p.id)).toEqual(["forms_offer"]);
  host.settlePrompt(sessionId, "forms_offer", "dismissed");
  await host.respond(sessionId, { kind: "ack" });
  expect((await host.respond(sessionId, { kind: "ack" })).kind).toBe("complete");
  expect(host.sessionPrompts(sessionId, ask).map((p) => p.id)).toEqual(["map_offer"]);
  await host.close(sessionId);
}
function telemetryFiles(dataDir: string): string[] {
  return (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
}

describe("prompt events in the consented stream", () => {
  it("writes each proposal shown and its outcome, as labels and references only", async () => {
    const dataDir = tmp("prompt-events-on-");
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: "granted" }, async () => {
      await play(new SessionHost({ bundlesRoot: library(), live: false }));
      const files = telemetryFiles(dataDir);
      expect(files).toHaveLength(1);
      const raw = readFileSync(join(dataDir, files[0]!), "utf8");
      const events = raw.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      const about = events.filter((e) => e["type"] === "prompt_shown" || e["type"] === "prompt_outcome");
      for (const event of about) expect(TelemetryEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
      const brief = about.map(({ type, kind, outcome, attention, surface_rank, scene_id }) => ({ type, kind, outcome, attention, surface_rank, scene_id }));
      expect(brief).toEqual([
        { type: "prompt_shown", kind: "forms_offer", outcome: undefined, attention: "normal", surface_rank: 1, scene_id: "s-c" },
        { type: "prompt_outcome", kind: "forms_offer", outcome: "dismissed", attention: undefined, surface_rank: undefined, scene_id: "s-c" },
        { type: "prompt_shown", kind: "map_offer", outcome: undefined, attention: "normal", surface_rank: 1, scene_id: undefined },
        // Left unanswered when the session closed: counted ignored.
        { type: "prompt_outcome", kind: "map_offer", outcome: "ignored", attention: undefined, surface_rank: undefined, scene_id: undefined },
      ]);
      expect(raw).not.toContain("formulaires");                 // the proposal's words stay out
      expect(raw).not.toContain("auto-test-prompt-events");     // and so does the learner's id
    });
  });

  it("writes nothing without consent", async () => {
    const dataDir = tmp("prompt-events-off-");
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: undefined }, async () => {
      await play(new SessionHost({ bundlesRoot: library(), live: false }));
      expect(telemetryFiles(dataDir)).toEqual([]);
    });
  });
});
