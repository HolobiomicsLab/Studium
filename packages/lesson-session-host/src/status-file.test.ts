// packages/lesson-session-host/src/status-file.test.ts
//
// INT-STUDIUM-058, task 2.4 (N8): in durable mode the host says where the learner's session stands in
// `<dataDir>/<pseudonym>/status.json`, for a harness status line (tools/studium_statusline.mjs). The
// file is written whole (temporary file, then rename), holds the status line and the orientation and
// no scene text, leaves when the session closes and is erased with the learner. Nothing is written in
// memory-only mode. A status that cannot be written never costs the learner their answer.
import { describe, it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Every path given to fs/promises writeFile, and a switch that makes a status write die half-way. */
const disk: { written: string[]; crashStatus: boolean } = { written: [], crashStatus: false };

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile = (async (path: Parameters<typeof fs.writeFile>[0], data: string, options?: Parameters<typeof fs.writeFile>[2]) => {
    if (typeof path === "string") disk.written.push(path);
    if (disk.crashStatus && typeof path === "string" && basename(path).startsWith(".status.json.")) {
      await fs.writeFile(path, data.slice(0, Math.floor(data.length / 2)), options);
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    }
    return fs.writeFile(path, data, options);
  }) as typeof fs.writeFile;
  return { ...fs, default: { ...fs, writeFile }, writeFile };
});

const { SessionHost } = await import("./host.js");
const { orientationOf, statusLine } = await import("./orientation.js");
const { STATUS_FILE, STATUS_SCHEMA } = await import("./status-file.js");

const SCRIPT = fileURLToPath(new URL("../../../tools/studium_statusline.mjs", import.meta.url));

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "status-file-")); dirs.push(d); return d; }
afterEach(() => {
  disk.written = [];
  disk.crashStatus = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function write(root: string, ref: string, data: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
}
const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [],
  question: `Question secrète ${id} ?`, choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const explain = (id: string, concept: string) => ({
  id, type: "explain_back", title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 60,
  adaptation_hooks: [], prompt: "Explique pourquoi le signe change.",
  key_points: [{ id: "kp", text: "Le signe suit la phase.", cues: ["signe"] }], model_explanation: "Modèle.",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});
function lesson(id: string, title: string, scenes: Array<{ concept_refs: string[] }>) {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}
const rightChoice = (presentation: { scene: unknown }): string =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === "Juste")!.id;

/** Every status file under the data folder. */
function statusFiles(data: string): string[] {
  if (!existsSync(data)) return [];
  return (readdirSync(data, { recursive: true }) as string[]).filter((p) => basename(p) === STATUS_FILE).map((p) => join(data, p));
}
interface Status {
  schema: string; status_line: string; updated_at: string; pid: number;
  orientation: { step: { index: number; total: number }; waiting: string };
}
function onlyStatus(data: string): { path: string; raw: string; status: Status } {
  const files = statusFiles(data);
  expect(files).toHaveLength(1);
  const raw = readFileSync(files[0]!, "utf8");
  return { path: files[0]!, raw, status: JSON.parse(raw) as Status };
}

function setup(dataDir: string | null = tmp()) {
  const library = tmp();
  write(library, "atomes/lesson.json", lesson("lesson-atomes", "Les atomes", [quiz("s-a", "c-a"), quiz("s-b", "c-b")]));
  write(library, "liaisons/lesson.json", lesson("lesson-liaisons", "Les liaisons", [quiz("s-l", "c-l"), quiz("s-m", "c-m")]));
  write(library, "signes/lesson.json", lesson("lesson-signes", "Les signes", [explain("s-e", "c-e"), quiz("s-q", "c-q")]));
  const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir });
  return { host, library, data: dataDir };
}

describe("status file (INT-STUDIUM-058, N8): durable mode", () => {
  it("the first screen writes status.json in the learner's folder: the status line, the orientation, a time", async () => {
    const { host, data } = setup();
    const before = Date.now();
    const started = await host.create("atomes/lesson.json", "ana");
    const { path, raw, status } = onlyStatus(data!);
    expect(basename(dirname(path))).toMatch(/^[0-9a-f]{16}$/); // the learner's pseudonym folder
    expect(dirname(dirname(path))).toBe(data);
    expect(status.schema).toBe(STATUS_SCHEMA);
    expect(status.status_line).toBe(statusLine(orientationOf(host, started.sessionId), "Les atomes", "fr"));
    expect(status.status_line).toContain("étape 1/2");
    expect(started.presentation.display_markdown).toContain(`\`${status.status_line}\``); // the line the screen shows
    expect(status.orientation.step).toEqual({ index: 1, total: 2 });
    expect(status.orientation.waiting).toBe("answer");
    expect(Date.parse(status.updated_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(status.updated_at)).toBeLessThanOrEqual(Date.now());
    expect(status.pid).toBe(process.pid);
    expect(raw).not.toContain("Question secrète"); // N7: no scene text
    expect(raw).not.toContain("Juste");
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("each transition rewrites it, down to the end of the lesson", async () => {
    const { host, data } = setup();
    const started = await host.create("atomes/lesson.json", "ana");
    const second = await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(started.presentation) });
    expect(onlyStatus(data!).status.status_line).toContain("étape 2/2");
    expect(onlyStatus(data!).status.status_line).toBe(statusLine(orientationOf(host, started.sessionId), "Les atomes", "fr"));
    if (!("presentation" in second)) throw new Error("expected a second screen");
    const last = await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(second.presentation) });
    expect(last.kind).toBe("complete");
    expect(onlyStatus(data!).status.status_line).toMatch(/terminé$/);
    expect(onlyStatus(data!).status.orientation.waiting).toBe("nothing");
  });

  it("a self-rating moves the status on", async () => {
    const { host, data } = setup();
    const started = await host.create("signes/lesson.json", "ana");
    await host.respond(started.sessionId, { kind: "reply", text: "Le signe suit la phase." });
    expect(onlyStatus(data!).status.orientation.waiting).toBe("self_rating");
    await host.rateRecall(started.sessionId, "s-e", "good");
    expect(onlyStatus(data!).status.orientation.waiting).not.toBe("self_rating");
  });

  it("is written through a temporary file and a rename: a write that dies half-way keeps the last status, and the answer", async () => {
    const { host, data } = setup();
    const started = await host.create("atomes/lesson.json", "ana");
    const first = onlyStatus(data!);
    expect(disk.written.filter((p) => basename(p) === STATUS_FILE)).toEqual([]); // never written in place
    expect(disk.written.some((p) => basename(p).startsWith(".status.json.") && p.endsWith(".tmp"))).toBe(true);
    disk.crashStatus = true;
    const served = await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(started.presentation) });
    disk.crashStatus = false;
    expect(served.kind).toBe("next"); // the answer counted
    expect(served.persistence_warning).toBeUndefined(); // and the progress was saved
    expect(readFileSync(first.path, "utf8")).toBe(first.raw); // the last whole status still stands
    expect(readdirSync(dirname(first.path)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves when the session closes, while the learner's progress stays", async () => {
    const { host, data } = setup();
    const started = await host.create("atomes/lesson.json", "ana");
    await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(started.presentation) });
    const folder = dirname(onlyStatus(data!).path);
    await host.close(started.sessionId);
    expect(statusFiles(data!)).toEqual([]);
    expect(existsSync(join(folder, "profile.json"))).toBe(true);
  });

  it("closing a session leaves the status another session of the learner wrote after it", async () => {
    const { host, data } = setup();
    const first = await host.create("atomes/lesson.json", "ana");
    await host.create("liaisons/lesson.json", "ana");
    expect(onlyStatus(data!).status.status_line).toContain("Les liaisons");
    await host.close(first.sessionId);
    expect(onlyStatus(data!).status.status_line).toContain("Les liaisons");
  });

  it("is erased with the learner: forget leaves no status and no learner folder", async () => {
    const { host, data } = setup();
    const started = await host.create("atomes/lesson.json", "ana");
    await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(started.presentation) });
    const folder = dirname(onlyStatus(data!).path);
    await host.forget(started.sessionId);
    expect(statusFiles(data!)).toEqual([]);
    expect(existsSync(folder)).toBe(false);

    const again = await host.create("atomes/lesson.json", "ben");
    const bensFolder = dirname(onlyStatus(data!).path);
    expect(again.sessionId).toBeTruthy();
    await host.forgetLearner("ben");
    expect(statusFiles(data!)).toEqual([]);
    expect(existsSync(bensFolder)).toBe(false);
  });

  it("a review session has its status too", async () => {
    const { host, data } = setup();
    const started = await host.create("atomes/lesson.json", "ana");
    const second = await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(started.presentation) });
    if (!("presentation" in second)) throw new Error("expected a second screen");
    await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(second.presentation) });
    await host.close(started.sessionId);
    expect(statusFiles(data!)).toEqual([]);
    const review = await host.startReview("ana", { nowMs: Date.now() + 90 * 24 * 3600 * 1000 });
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    expect(onlyStatus(data!).status.status_line).toMatch(/étape 1\/\d/);
  });

  it("the status-line script prints the line the host wrote, and nothing once the session closed", async () => {
    const { host, data } = setup();
    const started = await host.create("atomes/lesson.json", "ana");
    const run = () => execFileSync(process.execPath, [SCRIPT, `--data-dir=${data}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(run()).toBe(`${onlyStatus(data!).status.status_line}\n`);
    await host.close(started.sessionId);
    expect(run()).toBe("");
  }, 30_000); // two node processes: slow on a loaded machine
});

describe("status file (INT-STUDIUM-058, N8): memory-only mode", () => {
  it("writes no status file", async () => {
    const { host } = setup(null);
    const started = await host.create("atomes/lesson.json", "ana");
    await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: rightChoice(started.presentation) });
    await host.close(started.sessionId);
    expect(disk.written.filter((p) => p.includes("status.json"))).toEqual([]);
  });
});
