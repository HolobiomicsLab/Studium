// packages/lesson-session-host/src/host.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost, SessionHostNotFoundError } from "./host.js";

const MINI = {
  schema_version: "1.4", bundle_id: "mini-001", source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" },
    { id: "s1", type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
};
const dirs: string[] = [];
function bundlesDir(): string { const d = mkdtempSync(join(tmpdir(), "host-")); dirs.push(d); writeFileSync(join(d, "mini.json"), JSON.stringify(MINI)); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Three-quiz bundle on one `remember`-level concept (w=0.3). Three correct answers (0 hints)
 * clear the MIN_MASTERY_ATTEMPTS=3 floor AND the 0.8 (=DEFAULT_THETA) claim bar: α = 1 + (1+0.7)·3 = 6.1,
 * β = 1 → mastery ≈ 0.859 ≥ 0.8, so a real mastery .jsonld IS written on completion. (The
 * anti-fabrication guard is the MIN_MASTERY_ATTEMPTS=3 floor — not a higher posterior — so 2 lucky
 * answers never certify.) */
function quizScene(id: string) {
  return { id, type: "quiz", title: id.toUpperCase(), objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] };
}
const MASTERY_BUNDLE_3 = {
  schema_version: "1.4", bundle_id: "mastery-test-003", source_plan_id: "p",
  metadata: { title: "Mastery3", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "remember" }],
  scenes: [quizScene("q1"), quizScene("q2"), quizScene("q3")],
  rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
};
function mastery3BundlesDir(): string { const d = mkdtempSync(join(tmpdir(), "host-mastery3-")); dirs.push(d); writeFileSync(join(d, "mastery3.json"), JSON.stringify(MASTERY_BUNDLE_3)); return d; }

/** Submit the CURRENT quiz's correct choice. Robust to the load-time choice shuffle in
 * resolveBundle (which permutes + re-letters ids), so these tests assert behavior, not a
 * hardcoded answer letter. */
function correctChoice(h: SessionHost, sid: string) {
  const scene = h.currentPresentation(sid).scene;
  if (scene.type !== "quiz") throw new Error(`expected quiz scene, got ${scene.type}`);
  const choice = scene.choices.find((c) => c.correct);
  if (!choice) throw new Error("quiz scene has no correct choice");
  return { kind: "quiz_choice" as const, choiceId: choice.id };
}

describe("SessionHost", () => {
  it("creates a session and advances via respond", async () => {
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
    const { sessionId, presentation } = await host.create("mini.json");
    expect(presentation.scene.id).toBe("s0");
    const t = await host.respond(sessionId, { kind: "ack" });
    expect(t.kind).toBe("next");
    expect(host.getState(sessionId).lesson_id).toBe("mini-001");
  });
  it("throws SessionHostNotFoundError for unknown id", () => {
    const host = new SessionHost({ bundlesRoot: ".", live: false });
    expect(() => host.currentPresentation("nope")).toThrow(SessionHostNotFoundError);
  });
  it("forget emits forget_requested then drops the session", async () => {
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
    const { sessionId } = await host.create("mini.json");
    await host.forget(sessionId);
    expect(host.has(sessionId)).toBe(false);
  });
});

describe("SessionHost — per-learner pseudonym + RGPD erasure (#4)", () => {
  it("create() threads learnerId so distinct learners on one lesson get DISTINCT pseudonyms", async () => {
    const prev = process.env["STUDIUM_PSEUDO_SECRET"];
    process.env["STUDIUM_PSEUDO_SECRET"] = "host-test-secret";
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
      const a = await host.create("mini.json", "alice");
      const b = await host.create("mini.json", "bob");
      const pa = (host as any).require(a.sessionId).deps.telemetry.events[0].learner_pseudonym as string;
      const pb = (host as any).require(b.sessionId).deps.telemetry.events[0].learner_pseudonym as string;
      expect(pa).not.toBe(pb);
    } finally {
      if (prev === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prev;
    }
  });

  it("forget() PURGES the learner's state + event-log records (real erasure, in-memory deps)", async () => {
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
    const { sessionId } = await host.create("mini.json", "alice");
    await host.respond(sessionId, { kind: "ack" });           // generate state save + event-log append
    const e = (host as any).require(sessionId);
    expect(e.deps.stateStore.saved.size).toBeGreaterThan(0);
    expect(e.deps.eventLog.records.length).toBeGreaterThan(0);
    await host.forget(sessionId);
    expect(host.has(sessionId)).toBe(false);
    // the in-process stores held the learner's personal data — they must now be empty
    expect(e.deps.stateStore.saved.size).toBe(0);
    expect(e.deps.eventLog.records.length).toBe(0);
    expect(e.deps.telemetry.events.length).toBe(0);
  });

  it("forget() deletes the durable state JSON, event-log file, and the session's .jsonld", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "host-erasure-"));
    dirs.push(outDir);
    const prev = process.env["STUDIUM_MASTERY_DIR"];
    process.env["STUDIUM_MASTERY_DIR"] = outDir;
    try {
      const host = new SessionHost({ bundlesRoot: mastery3BundlesDir(), live: false });
      const { sessionId } = await host.create("mastery3.json", "alice");
      // wire durable adapters onto this session's deps so erasure has files to delete
      const { FileStateStore, JsonlEventLog } = await import("@studium/lesson-session/node");
      const e = (host as any).require(sessionId);
      const stateDir = mkdtempSync(join(tmpdir(), "host-state-"));
      dirs.push(stateDir);
      const eventFile = join(outDir, "events.jsonl");
      e.deps.stateStore = new FileStateStore(stateDir);
      e.deps.eventLog = new JsonlEventLog(eventFile);
      await host.respond(sessionId, correctChoice(host, sessionId));
      await host.respond(sessionId, correctChoice(host, sessionId));
      const t = await host.respond(sessionId, correctChoice(host, sessionId));
      expect(t.kind).toBe("complete");                          // flush writes the .jsonld (3 attempts ≥ floor)
      const masteryFiles = readdirSync(outDir).filter(f => f.endsWith(".jsonld"));
      expect(masteryFiles.length).toBeGreaterThan(0);
      expect(existsSync(eventFile)).toBe(true);
      expect(readdirSync(stateDir).some(f => f.endsWith(".json"))).toBe(true);
      await host.forget(sessionId);
      expect(readdirSync(outDir).filter(f => f.endsWith(".jsonld"))).toEqual([]);
      expect(existsSync(eventFile)).toBe(false);
      expect(readdirSync(stateDir).filter(f => f.endsWith(".json"))).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env["STUDIUM_MASTERY_DIR"];
      else process.env["STUDIUM_MASTERY_DIR"] = prev;
    }
  });

  it("fail-closed: live mode with the dev-secret default REFUSES to create a session", async () => {
    const prev = process.env["STUDIUM_PSEUDO_SECRET"];
    delete process.env["STUDIUM_PSEUDO_SECRET"];
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: true });
      await expect(host.create("mini.json", "alice")).rejects.toThrow(/STUDIUM_PSEUDO_SECRET/);
    } finally {
      if (prev !== undefined) process.env["STUDIUM_PSEUDO_SECRET"] = prev;
    }
  });

  it("fail-closed: live mode with an explicit non-default secret is allowed", async () => {
    const prev = process.env["STUDIUM_PSEUDO_SECRET"];
    process.env["STUDIUM_PSEUDO_SECRET"] = "a-real-production-secret";
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: true });
      const { presentation } = await host.create("mini.json", "alice");
      expect(presentation.scene.id).toBe("s0");
    } finally {
      if (prev === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prev;
    }
  });

  it("fail-closed: NODE_ENV=production with no secret THROWS even when live=false", async () => {
    const prevSecret = process.env["STUDIUM_PSEUDO_SECRET"];
    const prevNode = process.env["NODE_ENV"];
    delete process.env["STUDIUM_PSEUDO_SECRET"];
    process.env["NODE_ENV"] = "production";
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
      await expect(host.create("mini.json", "alice")).rejects.toThrow(/STUDIUM_PSEUDO_SECRET/);
    } finally {
      if (prevSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prevSecret;
      if (prevNode === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNode;
    }
  });

  it("fail-closed: NODE_ENV=production with dev-secret THROWS", async () => {
    const prevSecret = process.env["STUDIUM_PSEUDO_SECRET"];
    const prevNode = process.env["NODE_ENV"];
    process.env["STUDIUM_PSEUDO_SECRET"] = "dev-secret";
    process.env["NODE_ENV"] = "production";
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
      await expect(host.create("mini.json", "alice")).rejects.toThrow(/STUDIUM_PSEUDO_SECRET/);
    } finally {
      if (prevSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prevSecret;
      if (prevNode === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNode;
    }
  });

  it("fail-closed: STUDIUM_ENV=production with no secret THROWS even when live=false", async () => {
    const prevSecret = process.env["STUDIUM_PSEUDO_SECRET"];
    const prevStudium = process.env["STUDIUM_ENV"];
    delete process.env["STUDIUM_PSEUDO_SECRET"];
    process.env["STUDIUM_ENV"] = "production";
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
      await expect(host.create("mini.json", "alice")).rejects.toThrow(/STUDIUM_PSEUDO_SECRET/);
    } finally {
      if (prevSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prevSecret;
      if (prevStudium === undefined) delete process.env["STUDIUM_ENV"];
      else process.env["STUDIUM_ENV"] = prevStudium;
    }
  });

  it("fail-closed: production-ish signal with an explicit real secret is allowed", async () => {
    const prevSecret = process.env["STUDIUM_PSEUDO_SECRET"];
    const prevNode = process.env["NODE_ENV"];
    process.env["STUDIUM_PSEUDO_SECRET"] = "a-real-production-secret";
    process.env["NODE_ENV"] = "production";
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
      const { presentation } = await host.create("mini.json", "alice");
      expect(presentation.scene.id).toBe("s0");
    } finally {
      if (prevSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prevSecret;
      if (prevNode === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNode;
    }
  });

  it("permissive: neither prod signal nor live=false uses dev-secret default (no throw)", async () => {
    const prevSecret = process.env["STUDIUM_PSEUDO_SECRET"];
    const prevNode = process.env["NODE_ENV"];
    const prevStudium = process.env["STUDIUM_ENV"];
    delete process.env["STUDIUM_PSEUDO_SECRET"];
    delete process.env["NODE_ENV"];
    delete process.env["STUDIUM_ENV"];
    try {
      const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
      const { presentation } = await host.create("mini.json", "alice");
      expect(presentation.scene.id).toBe("s0");
    } finally {
      if (prevSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = prevSecret;
      if (prevNode === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNode;
      if (prevStudium === undefined) delete process.env["STUDIUM_ENV"];
      else process.env["STUDIUM_ENV"] = prevStudium;
    }
  });
});

describe("SessionHost — mastery sink flush on completion", () => {
  it("writes the .jsonld file when FileMasteryClaimSink is wired and the lesson completes", async () => {
    const masteryDir = mkdtempSync(join(tmpdir(), "host-mastery-out-"));
    dirs.push(masteryDir);
    const prev = process.env["STUDIUM_MASTERY_DIR"];
    process.env["STUDIUM_MASTERY_DIR"] = masteryDir;
    try {
      const host = new SessionHost({ bundlesRoot: mastery3BundlesDir(), live: false });
      const { sessionId } = await host.create("mastery3.json");
      // Three correct quizzes clear the MIN_MASTERY_ATTEMPTS=3 floor (α=5.5, β=1 → mastery≈0.846
      // ≥ 0.8 threshold). Two attempts is below the floor and emits NO claim — hence three.
      const t1 = await host.respond(sessionId, correctChoice(host, sessionId));
      expect(t1.kind).toBe("next");
      const t2 = await host.respond(sessionId, correctChoice(host, sessionId));
      expect(t2.kind).toBe("next");
      const t3 = await host.respond(sessionId, correctChoice(host, sessionId));
      expect(t3.kind).toBe("complete");
      // The FileMasteryClaimSink.flush() must have been called: a .jsonld file should exist
      const files = readdirSync(masteryDir).filter(f => f.endsWith(".jsonld"));
      expect(files.length).toBeGreaterThan(0);
      const raw = readFileSync(join(masteryDir, files[0]!), "utf8");
      const doc = JSON.parse(raw) as { "@graph": Array<Record<string, unknown>> };
      const claim = doc["@graph"].find(n => n["@type"] === "asb:Claim");
      expect(claim).toBeDefined();
      expect((claim as any).relation).toBe("demonstrates mastery of");
    } finally {
      if (prev === undefined) delete process.env["STUDIUM_MASTERY_DIR"];
      else process.env["STUDIUM_MASTERY_DIR"] = prev;
    }
  });
});

describe("SessionHost — consented telemetry sink (ADR-006)", () => {
  function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const prev: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
    return fn().finally(() => { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
  }
  async function runToCompletion(host: SessionHost): Promise<void> {
    const { sessionId } = await host.create("mastery3.json", "alice");
    await host.respond(sessionId, correctChoice(host, sessionId));
    await host.respond(sessionId, correctChoice(host, sessionId));
    const t = await host.respond(sessionId, correctChoice(host, sessionId));
    expect(t.kind).toBe("complete");
  }

  it("durable + STUDIUM_TELEMETRY_CONSENT writes a pseudonymized telemetry.jsonl with quiz_answered events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "host-telem-")); dirs.push(dataDir);
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: "granted" }, async () => {
      const host = new SessionHost({ bundlesRoot: mastery3BundlesDir(), live: false });
      await runToCompletion(host);
      const files = readdirSync(dataDir, { recursive: true }) as string[];
      const telem = files.filter(f => String(f).endsWith("telemetry.jsonl"));
      expect(telem.length).toBe(1);
      const lines = readFileSync(join(dataDir, String(telem[0])), "utf8").trim().split("\n").map(l => JSON.parse(l));
      expect(lines.some(e => e.type === "quiz_answered")).toBe(true);
      // ADR-006: pseudonymized — a pseudonym ref present, raw learner id "alice" absent everywhere.
      const blob = JSON.stringify(lines);
      expect(blob).not.toContain("alice");
    });
  });

  it("durable WITHOUT consent persists NO telemetry.jsonl (privacy-preserving default)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "host-telem-off-")); dirs.push(dataDir);
    await withEnv({ STUDIUM_DATA_DIR: dataDir, STUDIUM_TELEMETRY_CONSENT: undefined }, async () => {
      const host = new SessionHost({ bundlesRoot: mastery3BundlesDir(), live: false });
      await runToCompletion(host);
      const files = readdirSync(dataDir, { recursive: true }) as string[];
      expect(files.filter(f => String(f).endsWith("telemetry.jsonl")).length).toBe(0);
    });
  });

  it("requestHint() returns an authored hint then null at the per-visit cap", async () => {
    const d = mkdtempSync(join(tmpdir(), "host-hint-")); dirs.push(d);
    const HINTED = { ...MINI, bundle_id: "hinted-001", scenes: [
      MINI.scenes[0],
      { ...MINI.scenes[1], hints: ["re-read the prompt"] },
    ] };
    writeFileSync(join(d, "hinted.json"), JSON.stringify(HINTED));
    const host = new SessionHost({ bundlesRoot: d, live: false });
    const { sessionId } = await host.create("hinted.json", "bob");
    await host.respond(sessionId, { kind: "ack" });          // intro → quiz
    const h1 = host.requestHint(sessionId);
    expect(h1?.hint).toBe("re-read the prompt");
    expect(host.requestHint(sessionId)).toBeNull();          // standard cap = 1
  });
});
