// L-5: exact display assertions use French non-breaking spaces; content/privacy contracts stay intact.
// packages/lesson-session-host/src/host.judged-reference.test.ts
//
// I-1 and I-2 on the judged path: when a judge measured which key points an answer covered, the
// feedback says the count only; which reference points were missing is data on the verdict
// (`key_points_missing`), part of the reference. So an answer that does not leave its scene yet (a
// replay of the same item) releases neither the key points nor which of them were missing, and the
// answer that leaves it shows each point once, under « Compare ta réponse à ces points clés ».
// The judge is a stub returning partial covered_ids (no model call); the host is in memory.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CritiqueEvaluator } from "@studium/lesson-session";

const judged: { covered: string[]; score: number } = { covered: [], score: 0.2 };

vi.mock("./deps.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./deps.js")>();
  const judge: CritiqueEvaluator = {
    async evaluate() {
      return { score: judged.score, feedback: "judged", source: "llm" as const, covered_ids: [...judged.covered] };
    },
  };
  return {
    ...original,
    buildHostDeps: (...args: Parameters<typeof original.buildHostDeps>) => ({ ...original.buildHostDeps(...args), critiqueEvaluator: judge }),
  };
});

const { SessionHost } = await import("./host.js");
const { publicTransition } = await import("./public-scene.js");

const served = (t: Parameters<typeof publicTransition>[0]) => JSON.stringify(publicTransition(t));

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const base = (id: string, type: string, concept: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const explainBack = {
  ...base("e", "explain_back", "c1"), prompt: "Explique pourquoi le signe change.",
  key_points: [{ id: "k1", text: "POINT-UN", cues: ["signe"] }, { id: "k2", text: "POINT-DEUX", cues: ["lobe"] }],
  model_explanation: "MODÈLE-SECRET", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
};
const RETRY_ON_ERROR = {
  id: "retry", when: { consecutive_errors_same_concept: ">=1" }, action: { kind: "replay_current_scene", reason: "again" },
  modulator: "M1", explanation_short: "On reprend.",
};

async function start() {
  const bundles = mkdtempSync(join(tmpdir(), "judged-reference-"));
  dirs.push(bundles);
  const bundle = {
    schema_version: "1.4", bundle_id: "judged", source_plan_id: "p",
    metadata: { title: "Leçon", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: ["c1", "c2"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes: [explainBack, { ...base("fin", "intro", "c2"), markdown: "Fin." }], rules: [RETRY_ON_ERROR],
    validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
  mkdirSync(dirname(join(bundles, "L.json")), { recursive: true });
  writeFileSync(join(bundles, "L.json"), JSON.stringify(bundle));
  // live: false keeps every other dependency offline; the judge alone is the stub above.
  const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
  const started = await host.create("L.json", "ana");
  return { host, sessionId: started.sessionId };
}

describe("a judged key-point verdict releases which points were missing only with its reference", () => {
  it("a replay after a partial answer carries the count, never the missing points' text", async () => {
    const { host, sessionId } = await start();
    judged.covered = ["k1"]; judged.score = 0.2;
    const partial = await host.respond(sessionId, { kind: "explanation", text: "Le signe change." });
    expect(partial.kind).toBe("replay");
    expect(partial.verdict?.feedback).toContain("1/2 points clés couverts");
    expect(partial.verdict).not.toHaveProperty("key_points");
    expect(partial.verdict).not.toHaveProperty("key_points_missing");
    expect(served(partial)).not.toMatch(/POINT-UN|POINT-DEUX|MODÈLE-SECRET/);
  });

  it("the answer that leaves the scene shows each key point once and marks the missing one", async () => {
    const { host, sessionId } = await start();
    judged.covered = ["k1"]; judged.score = 0.9;
    const left = await host.respond(sessionId, { kind: "explanation", text: "Le signe change entre les lobes." });
    expect(left.kind).not.toBe("replay");
    expect(left.verdict).toMatchObject({ key_points: ["POINT-UN", "POINT-DEUX"], key_points_missing: ["POINT-DEUX"] });
    expect(left.verdict?.feedback).toBe("1/2 points clés couverts");
    const shown = left.verdict?.display_markdown ?? "";
    expect(shown.split("POINT-DEUX")).toHaveLength(2);
    expect(shown).toContain("**Compare ta réponse à ces points clés\u00a0:**\n\n- POINT-UN\n- POINT-DEUX _(manquant selon le juge)_");
  });
});
