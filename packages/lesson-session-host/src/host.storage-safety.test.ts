// packages/lesson-session-host/src/host.storage-safety.test.ts
//
// L-11 (CC-1, CC-2, CC-6, CC-7, SEC-7, SEC-8, CQ-2, SEC-4 host side): the learner's profile and study
// record are shared by every server that opens the same data folder (D4: ~/.studium/data by default,
// so Claude Code and Codex both use it). Each write is atomic and holds a per-learner lock across
// processes; a file that exists and does not parse is an error, never a fresh profile; the folders are
// 0700 and the files 0600; forget waits for queued writes, closes the learner's other sessions and lets
// no later write bring the learner back; a blank STUDIUM_PSEUDO_SECRET counts as unset; the legacy
// secret keys only a data folder written before the per-install secret, never one emptied by a forget
// or erased under a running server; and a write-through that fails still returns the transition the
// learner earned, with a warning. Two SessionHost instances on one folder stand for two processes:
// they share nothing but the files.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileStateStore, HmacPseudonymProvider } from "@studium/lesson-session/node";
import { defaultLearnerProfile } from "@studium/learner-state";
import { SessionHost } from "./host.js";
import { PROFILE_PSEUDONYM_SCOPE } from "./learner-profile-store.js";
import { LEGACY_PSEUDO_SECRET, SECRET_FILE } from "./pseudonym-secret.js";
import { withFileLock } from "./learner-files.js";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "storage-safety-")); dirs.push(d); return d; }
const unset = new Map<string, string | undefined>();
function unsetEnv(name: string): void {
  if (!unset.has(name)) unset.set(name, process.env[name]);
  delete process.env[name];
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const [name, value] of unset) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  unset.clear();
  for (const d of dirs.splice(0)) {
    try { chmodSync(d, 0o700); } catch { /* gone */ }
    rmSync(d, { recursive: true, force: true });
  }
});

function write(root: string, ref: string, data: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
}
const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
  question: `Question ${id} ?`, choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
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
const idOf = (presentation: { scene: unknown }): string =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === "Juste")!.id;

/** A library of two lessons of four quizzes each, on distinct concepts. */
function library(): string {
  const root = tmp();
  write(root, "atomes/lesson.json", lesson("lesson-atomes", "Les atomes",
    [quiz("a1", "c-a1"), quiz("a2", "c-a2"), quiz("a3", "c-a3"), quiz("a4", "c-a4")]));
  write(root, "liaisons/lesson.json", lesson("lesson-liaisons", "Les liaisons",
    [quiz("l1", "c-l1"), quiz("l2", "c-l2"), quiz("l3", "c-l3"), quiz("l4", "c-l4")]));
  return root;
}
const host = (root: string, dataDir: string | null) => new SessionHost({ bundlesRoot: root, live: false, dataDir });

/** Answer the current quiz right. */
async function answer(h: SessionHost, sessionId: string) {
  return h.respond(sessionId, { kind: "quiz_choice", choiceId: idOf(h.currentPresentation(sessionId)) });
}

const learnerFolders = (dataDir: string) => readdirSync(dataDir).filter((name) => /^[0-9a-f]{16}$/.test(name)).sort();
function profileFolder(dataDir: string): string {
  const folder = learnerFolders(dataDir).find((name) => existsSync(join(dataDir, name, "profile.json")));
  if (!folder) throw new Error("no profile folder");
  return join(dataDir, folder);
}
const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("L-11 — a per-learner lock across processes", () => {
  it("two servers answering for the same learner at once lose none of each other's updates", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const first = host(root, data);
    const second = host(root, data);
    const a = await first.create("atomes/lesson.json", "ana");
    const l = await second.create("liaisons/lesson.json", "ana");
    for (let round = 0; round < 3; round += 1) {
      await Promise.all([answer(first, a.sessionId), answer(second, l.sessionId)]);
    }
    const folder = profileFolder(data);
    const profile = json(join(folder, "profile.json")) as { concept_states: Record<string, unknown>; concept_memory: Record<string, unknown> };
    const record = json(join(folder, "study.json")) as { lessons: Record<string, { scenes_completed: number }>; concepts: Record<string, unknown> };
    expect(Object.keys(profile.concept_states).sort()).toEqual(["c-a1", "c-a2", "c-a3", "c-l1", "c-l2", "c-l3"]);
    expect(Object.keys(profile.concept_memory).sort()).toEqual(["c-a1", "c-a2", "c-a3", "c-l1", "c-l2", "c-l3"]);
    expect(record.lessons["lesson-atomes"]?.scenes_completed).toBe(3);
    expect(record.lessons["lesson-liaisons"]?.scenes_completed).toBe(3);
    expect(Object.keys(record.concepts).sort()).toEqual(["c-a1", "c-a2", "c-a3", "c-l1", "c-l2", "c-l3"]);
    expect(readdirSync(folder).filter((name) => name.endsWith(".tmp") || name === ".lock")).toEqual([]);
  });

  it("a lock serialises two critical sections, and a lock left by a dead process is taken over", async () => {
    const dir = tmp();
    const order: string[] = [];
    const section = (name: string) => withFileLock(dir, async () => {
      order.push(`${name}:in`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`${name}:out`);
    });
    await Promise.all([section("one"), section("two")]);
    // Whichever enters first, the other enters only after it left: the sections never interleave.
    expect([["one:in", "one:out", "two:in", "two:out"], ["two:in", "two:out", "one:in", "one:out"]]).toContainEqual(order);
    // A lock file whose process is gone (pid 2^31 - 1 is never a live process here) does not block.
    writeFileSync(join(dir, ".lock"), `${2 ** 31 - 1} ${new Date().toISOString()}\n`);
    await expect(withFileLock(dir, async () => "ran", { timeoutMs: 2000 })).resolves.toBe("ran");
    expect(existsSync(join(dir, ".lock"))).toBe(false);
  });
});

describe("L-11 — atomic files, 0700 folders and 0600 files", () => {
  it("writes the profile and the study record 0600 in 0700 folders, and tightens an existing data folder", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = join(tmp(), "data");
    mkdirSync(data, { mode: 0o755 });
    chmodSync(data, 0o755);
    const h = host(root, data);
    expect(statSync(data).mode & 0o777).toBe(0o700);
    const s = await h.create("atomes/lesson.json", "ana");
    await answer(h, s.sessionId);
    const folder = profileFolder(data);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(join(folder, "profile.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(folder, "study.json")).mode & 0o777).toBe(0o600);
  });

  it("a fresh data folder is created 0700", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = join(tmp(), "fresh", "data");
    const h = host(root, data);
    await answer(h, (await h.create("atomes/lesson.json", "ana")).sessionId);
    expect(statSync(data).mode & 0o777).toBe(0o700);
  });
});

describe("L-11 — a file that does not parse is an error, never a fresh profile", () => {
  it("refuses to start a lesson over an unreadable profile, naming the file and leaving it as it is", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const s = await h.create("atomes/lesson.json", "ana");
    await answer(h, s.sessionId);
    await h.close(s.sessionId);
    const file = join(profileFolder(data), "profile.json");
    writeFileSync(file, "{ torn");
    await expect(host(root, data).create("liaisons/lesson.json", "ana")).rejects.toThrow(/profile\.json.*(cannot|does not)/);
    expect(readFileSync(file, "utf8")).toBe("{ torn");
  });

  it("an answer whose write-through meets an unreadable profile still gets its transition, with a warning, and the file is kept", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const s = await h.create("atomes/lesson.json", "ana");
    await answer(h, s.sessionId);
    const file = join(profileFolder(data), "profile.json");
    writeFileSync(file, "not json at all");
    const t = await answer(h, s.sessionId);
    expect(t.kind).toBe("next");
    expect(t.verdict).toMatchObject({ scene_id: "a2", correct: true });
    expect(t.persistence_warning).toMatch(/profile\.json/);
    expect(t.display_markdown).toMatch(/progression n'a pas pu être enregistrée/);
    expect(readFileSync(file, "utf8")).toBe("not json at all");
    // The session moved on: answering again grades the NEXT scene, never the same answer twice.
    const next = await answer(h, s.sessionId);
    expect(next.verdict?.scene_id).toBe("a3");
  });
});

describe("L-11 — a write-through that fails returns the served transition with a warning (CC-6)", () => {
  it("keeps the verdict, its text and the next scene when the study record cannot be written", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const s = await h.create("atomes/lesson.json", "ana");
    await answer(h, s.sessionId);
    const study = join(profileFolder(data), "study.json");
    rmSync(study);
    mkdirSync(join(study, "blocked"), { recursive: true }); // a folder where the file goes: every write fails
    const t = await answer(h, s.sessionId);
    expect(t.kind).toBe("next");
    expect(t.verdict?.display_markdown).toMatch(/Juste/);
    expect(t.persistence_warning).toMatch(/study\.json/);
    expect(t.display_markdown).toContain("Scène a3");
  });
});

describe("L-11 — forget lets no later write bring the learner back", () => {
  it.each([false, true])("an old session stays erased after a fresh profile is created (profile seen: %s)", async (seen) => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const here = host(root, data);
    const there = host(root, data);
    const original = await here.create("atomes/lesson.json", "ana");
    if (seen) await answer(here, original.sessionId);
    const stale = await there.create("liaisons/lesson.json", "ana");
    await here.forgetLearner("ana");
    const fresh = await here.create("atomes/lesson.json", "ana");
    await answer(here, fresh.sessionId);
    const before = readFileSync(join(profileFolder(data), "profile.json"), "utf8");
    await expect(answer(there, stale.sessionId)).rejects.toThrow(/^session not found: .*erased/);
    expect(readFileSync(join(profileFolder(data), "profile.json"), "utf8")).toBe(before);
  });

  it.each([false, true])("forget waits for the engine's pending state write (another host: %s)", async (otherHost) => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const writer = host(root, data);
    const eraser = otherHost ? host(root, data) : writer;
    const started = await writer.create("atomes/lesson.json", "ana");
    await answer(writer, started.sessionId);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const save = FileStateStore.prototype.save;
    vi.spyOn(FileStateStore.prototype, "save").mockImplementationOnce(async function (this: FileStateStore, lessonId, state) {
      enter();
      await released;
      return save.call(this, lessonId, state);
    });
    const answering = answer(writer, started.sessionId);
    await entered;
    let finished = false;
    const forgetting = eraser.forgetLearner("ana").then(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const finishedBeforeWrite = finished;
    release();
    await Promise.all([answering, forgetting]);
    expect(finishedBeforeWrite).toBe(false);
    expect(learnerFolders(data)).toEqual([]);
  });

  it("forget(session) closes the learner's other sessions, which can no longer write the profile back", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const a = await h.create("atomes/lesson.json", "ana");
    await answer(h, a.sessionId);
    const l = await h.create("liaisons/lesson.json", "ana");
    await answer(h, l.sessionId);
    const folder = profileFolder(data);
    await h.forget(a.sessionId);
    expect(h.has(l.sessionId)).toBe(false);
    await expect(answer(h, l.sessionId)).rejects.toThrow(/^session not found/);
    expect(existsSync(join(folder, "profile.json"))).toBe(false);
    expect(existsSync(join(folder, "study.json"))).toBe(false);
  });

  it("forget(session) erases the learner's other session of the same lesson: nothing it held lands afterwards", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    vi.stubEnv("STUDIUM_TELEMETRY_CONSENT", "1"); // its events are buffered in the lesson's folder until a flush
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const first = await h.create("atomes/lesson.json", "ana");
    const second = await h.create("atomes/lesson.json", "ana");
    await answer(h, second.sessionId);
    await answer(h, second.sessionId); // mastery claims buffered, the lesson not complete
    await h.forget(first.sessionId);
    expect(h.has(second.sessionId)).toBe(false);
    // Its folder, buffered events included, went with the lesson's progress, and nothing wrote it back.
    expect(learnerFolders(data)).toEqual([]);
    // A later call names the erasure, not a restart, and points to a fresh start.
    await expect(answer(h, second.sessionId)).rejects.toThrow(/^session not found: .*erased.*start the lesson afresh/);
    await expect(answer(h, first.sessionId)).rejects.toThrow(/^session not found: .*erased/);
  });

  it("a session opened right after a forget, within the same millisecond, is the learner starting afresh", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const a = await h.create("atomes/lesson.json", "ana");
    await answer(h, a.sessionId);
    vi.spyOn(Date, "now").mockReturnValue(Date.now()); // the forget and the next open share one millisecond
    await h.forget(a.sessionId);
    const again = await h.create("atomes/lesson.json", "ana");
    const transition = await answer(h, again.sessionId);
    expect(transition.verdict?.correct).toBe(true);
    expect(existsSync(join(profileFolder(data), "profile.json"))).toBe(true);
  });

  it("a write already in flight when forget starts does not land after it", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    const a = await h.create("atomes/lesson.json", "ana");
    await answer(h, a.sessionId);
    const l = await h.create("liaisons/lesson.json", "ana");
    const folder = profileFolder(data);
    const inFlight = answer(h, l.sessionId).catch((error: Error) => error);
    await h.forget(a.sessionId);
    await inFlight;
    expect(existsSync(join(folder, "profile.json"))).toBe(false);
    expect(existsSync(join(folder, "study.json"))).toBe(false);
  });

  it("a server in another process does not write back a learner forgotten here; a new session starts afresh", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const here = host(root, data);
    const there = host(root, data);
    const mine = await here.create("atomes/lesson.json", "ana");
    await answer(here, mine.sessionId);
    const theirs = await there.create("liaisons/lesson.json", "ana");
    await answer(there, theirs.sessionId);
    const before = learnerFolders(data);
    await here.forgetLearner("ana");
    expect(learnerFolders(data)).toEqual([]);
    await expect(answer(there, theirs.sessionId)).rejects.toThrow(/^session not found: .*erased/);
    await there.close(theirs.sessionId).catch(() => undefined);
    expect(learnerFolders(data)).toEqual([]);
    // A session opened after the forget is the learner starting again: it is saved.
    const fresh = await there.create("liaisons/lesson.json", "ana");
    expect(fresh.resume).toMatchObject({ kind: "new", scenes_completed: 0 });
    await answer(there, fresh.sessionId);
    expect(learnerFolders(data).length).toBeGreaterThan(0);
    expect(before.length).toBeGreaterThan(0);
  });
});

describe("L-11 — the pseudonym secret: a blank variable is unset, the legacy secret only for an older folder", () => {
  async function profilePseudonym(secret: string, learnerId: string): Promise<string> {
    return new HmacPseudonymProvider(secret).get(learnerId, PROFILE_PSEUDONYM_SCOPE);
  }

  it.each(["", "   "])("STUDIUM_PSEUDO_SECRET=%j counts as unset: the folder gets its own secret", async (blank) => {
    vi.stubEnv("STUDIUM_PSEUDO_SECRET", blank);
    const root = library();
    const data = tmp();
    const h = host(root, data);
    await answer(h, (await h.create("atomes/lesson.json", "ana")).sessionId);
    const secret = readFileSync(join(data, SECRET_FILE), "utf8").trim();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(learnerFolders(data)).toContain(await profilePseudonym(secret, "ana"));
    expect(learnerFolders(data)).not.toContain(await profilePseudonym(blank, "ana"));
  });

  it("a folder that lost its secret file while learners remain is refused, never keyed by the legacy secret", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = tmp();
    const h = host(root, data);
    await answer(h, (await h.create("atomes/lesson.json", "ana")).sessionId);
    rmSync(join(data, SECRET_FILE));
    await expect(host(root, data).create("atomes/lesson.json", "bob")).rejects.toThrow(/\.studium-secret.*missing/);
    expect(learnerFolders(data)).not.toContain(await profilePseudonym(LEGACY_PSEUDO_SECRET, "bob"));
  });

  it("a folder whose learners were keyed by STUDIUM_PSEUDO_SECRET asks for it again rather than using the legacy secret", async () => {
    vi.stubEnv("STUDIUM_PSEUDO_SECRET", "an-operator-secret");
    const root = library();
    const data = tmp();
    const keyed = host(root, data);
    await answer(keyed, (await keyed.create("atomes/lesson.json", "ana")).sessionId);
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    await expect(host(root, data).create("atomes/lesson.json", "ana")).rejects.toThrow(/STUDIUM_PSEUDO_SECRET/);
    expect(existsSync(join(data, SECRET_FILE))).toBe(false);
  });

  it("a data folder erased under a running server is not written back, and the next server gets a new secret", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const root = library();
    const data = join(tmp(), "data");
    const running = host(root, data);
    const s = await running.create("atomes/lesson.json", "ana");
    await answer(running, s.sessionId);
    const oldSecret = readFileSync(join(data, SECRET_FILE), "utf8").trim();
    rmSync(data, { recursive: true, force: true }); // what the VS Code « forget my data » does to its storage
    await expect(answer(running, s.sessionId)).rejects.toThrow(/^session not found/);
    expect(existsSync(data) ? learnerFolders(data) : []).toEqual([]);
    // The same server, asked for a new lesson, keys it with a new secret of the (re)created folder.
    const again = await running.create("liaisons/lesson.json", "bob");
    await answer(running, again.sessionId);
    const next = host(root, data);
    await answer(next, (await next.create("atomes/lesson.json", "cleo")).sessionId);
    const secret = readFileSync(join(data, SECRET_FILE), "utf8").trim();
    expect(secret).not.toBe(oldSecret);
    expect(learnerFolders(data)).toContain(await profilePseudonym(secret, "bob"));
    expect(learnerFolders(data)).toContain(await profilePseudonym(secret, "cleo"));
    expect(learnerFolders(data)).not.toContain(await profilePseudonym(LEGACY_PSEUDO_SECRET, "cleo"));
  });

  it("a legacy folder whose last learner was forgotten gets a per-install secret, in the same server too", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = library();
    const data = tmp();
    const legacy = await profilePseudonym(LEGACY_PSEUDO_SECRET, "ana");
    mkdirSync(join(data, legacy));
    writeFileSync(join(data, legacy, "profile.json"), JSON.stringify(defaultLearnerProfile(legacy, "2026-10-01T00:00:00.000Z")));
    const h = host(root, data);
    await answer(h, (await h.create("atomes/lesson.json", "ana")).sessionId);
    expect(existsSync(join(data, SECRET_FILE))).toBe(false); // a folder written before I-6 keeps its secret
    await h.forgetLearner("ana");
    expect(learnerFolders(data)).toEqual([]);
    await answer(h, (await h.create("atomes/lesson.json", "bob")).sessionId);
    const secret = readFileSync(join(data, SECRET_FILE), "utf8").trim();
    expect(learnerFolders(data)).toContain(await profilePseudonym(secret, "bob"));
    expect(learnerFolders(data)).not.toContain(await profilePseudonym(LEGACY_PSEUDO_SECRET, "bob"));
  });
});
