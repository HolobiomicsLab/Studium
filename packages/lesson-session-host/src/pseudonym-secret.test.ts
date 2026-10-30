// packages/lesson-session-host/src/pseudonym-secret.test.ts
//
// I-6 (integration lead decision): the secret behind learner pseudonyms when STUDIUM_PSEUDO_SECRET is
// unset and state is durable. A fresh data folder gets its own secret, `<dataDir>/.studium-secret`
// (0600, 32 random bytes in hex), so two installs no longer share the public "dev-secret" key; a data
// folder that already holds learner folders and no secret file keeps the legacy secret, so nobody loses
// their progress, and says so once on stderr. Ephemeral mode is unchanged.
import { describe, it, expect, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HmacPseudonymProvider } from "@studium/lesson-session/node";
import { defaultLearnerProfile } from "@studium/learner-state";
import { SessionHost } from "./host.js";
import { PROFILE_PSEUDONYM_SCOPE } from "./learner-profile-store.js";
import { KEY_SOURCE_FILE, LEGACY_PSEUDO_SECRET, SECRET_FILE, installSecret, markEnvKeyed } from "./pseudonym-secret.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "pseudonym-secret-"));
  dirs.push(d);
  return d;
}
/** Unset an environment variable for one test (vi.stubEnv sets strings only). */
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
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LESSON = {
  schema_version: "1.4", bundle_id: "secret-lesson", source_plan_id: "p",
  metadata: { title: "Leçon", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c", title: "Notion", description: "d", bloom_level_target: "understand" }],
  scenes: [{ id: "i", type: "intro", title: "Intro", objective_refs: [], concept_refs: ["c"], estimated_seconds: 0,
    adaptation_hooks: [], markdown: "Bienvenue." }],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
};

function bundles(): string {
  const root = tmp();
  writeFileSync(join(root, "L.json"), JSON.stringify(LESSON));
  return root;
}

/** The learner folders a host wrote: one per pseudonym. */
const learnerFolders = (dataDir: string) => readdirSync(dataDir).filter((name) => /^[0-9a-f]{16}$/.test(name)).sort();

async function profilePseudonym(secret: string, learnerId: string): Promise<string> {
  return new HmacPseudonymProvider(secret).get(learnerId, PROFILE_PSEUDONYM_SCOPE);
}

/** The folders a learner's finished lesson leaves under `secret`: its lesson state and its profile. */
async function foldersOf(secret: string, ...learners: string[]): Promise<string[]> {
  const provider = new HmacPseudonymProvider(secret);
  const names = await Promise.all(learners.flatMap((learner) =>
    [provider.get(learner, LESSON.bundle_id), provider.get(learner, PROFILE_PSEUDONYM_SCOPE)]));
  return [...new Set(names)].sort();
}

/** Play the one-screen lesson to its end: the host writes the learner's state and profile. */
async function finishLesson(host: SessionHost, learnerId: string): Promise<void> {
  const { sessionId } = await host.create("L.json", learnerId);
  await host.respond(sessionId, { kind: "ack" });
}

describe("I-6 — a per-install pseudonym secret for durable state", () => {
  it("tightens an existing data folder and its key files before reusing them", () => {
    const dataDir = tmp();
    installSecret(dataDir);
    chmodSync(dataDir, 0o755);
    chmodSync(join(dataDir, SECRET_FILE), 0o644);
    chmodSync(join(dataDir, KEY_SOURCE_FILE), 0o644);
    installSecret(dataDir);
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, SECRET_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, KEY_SOURCE_FILE)).mode & 0o777).toBe(0o600);
  });

  it("keeps an env-keyed data folder private when it already existed", () => {
    const dataDir = tmp();
    chmodSync(dataDir, 0o755);
    markEnvKeyed(dataDir);
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, KEY_SOURCE_FILE)).mode & 0o777).toBe(0o600);
  });

  it("tightens a reused legacy marker as well as a newly created marker", () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, "0123456789abcdef"));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    installSecret(dataDir);
    chmodSync(join(dataDir, KEY_SOURCE_FILE), 0o644);
    expect(installSecret(dataDir).source).toBe("legacy");
    expect(statSync(join(dataDir, KEY_SOURCE_FILE)).mode & 0o777).toBe(0o600);
  });

  it("a fresh data folder gets its own 0600 secret of 32 random bytes, and pseudonyms keyed by it", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const dataDir = join(tmp(), "data");
    await finishLesson(new SessionHost({ bundlesRoot: bundles(), dataDir, live: false }), "ana");
    const file = join(dataDir, SECRET_FILE);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const secret = readFileSync(file, "utf8").trim();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(learnerFolders(dataDir)).toEqual(await foldersOf(secret, "ana"));
    expect(learnerFolders(dataDir)).not.toContain(await profilePseudonym(LEGACY_PSEUDO_SECRET, "ana"));
  });

  it("two installs get two secrets; a restart of one keeps its secret and finds its learner again", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const first = join(tmp(), "data");
    const second = join(tmp(), "data");
    expect(installSecret(first).secret).not.toBe(installSecret(second).secret);

    const root = bundles();
    await finishLesson(new SessionHost({ bundlesRoot: root, dataDir: first, live: false }), "ana");
    const folders = learnerFolders(first);
    expect(folders.length).toBeGreaterThan(0);
    const after = new SessionHost({ bundlesRoot: root, dataDir: first, live: false });
    const listed = await after.listLessons({ learnerId: "ana" });
    expect(listed.lessons.find((l) => l.bundle_ref === "L.json")?.status?.state).toBe("completed");
    await finishLesson(after, "ana");
    expect(learnerFolders(first)).toEqual(folders);
    expect(installSecret(first)).toMatchObject({ source: "file" });
  });

  it("a data folder that already holds learners and no secret file keeps the legacy secret, and says so once", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    const dataDir = tmp();
    const legacy = await profilePseudonym(LEGACY_PSEUDO_SECRET, "ana");
    mkdirSync(join(dataDir, legacy));
    // The profile an older version saved for ana: a real one, as L-11 refuses a profile that does not
    // parse (this fixture was "{}", which the old fail-safe read took for « no profile »).
    writeFileSync(join(dataDir, legacy, "profile.json"), JSON.stringify(defaultLearnerProfile(legacy, "2026-10-01T00:00:00.000Z")));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const root = bundles();
    await finishLesson(new SessionHost({ bundlesRoot: root, dataDir, live: false }), "ana");
    await finishLesson(new SessionHost({ bundlesRoot: root, dataDir, live: false }), "bob");
    expect(existsSync(join(dataDir, SECRET_FILE))).toBe(false);
    expect(learnerFolders(dataDir)).toEqual(await foldersOf(LEGACY_PSEUDO_SECRET, "ana", "bob"));
    const notices = stderr.mock.calls.map(([text]) => String(text)).filter((text) => text.includes(SECRET_FILE));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/legacy/);
    expect(notices[0]).toContain("STUDIUM_PSEUDO_SECRET");
  });

  it("STUDIUM_PSEUDO_SECRET still wins, and writes no secret file", async () => {
    vi.stubEnv("STUDIUM_PSEUDO_SECRET", "an-operator-secret");
    const dataDir = tmp();
    await finishLesson(new SessionHost({ bundlesRoot: bundles(), dataDir, live: false }), "ana");
    expect(existsSync(join(dataDir, SECRET_FILE))).toBe(false);
    expect(learnerFolders(dataDir)).toEqual(await foldersOf("an-operator-secret", "ana"));
  });

  it("ephemeral mode is unchanged: no file anywhere, the legacy secret in memory", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    unsetEnv("STUDIUM_DATA_DIR");
    const root = bundles();
    await finishLesson(new SessionHost({ bundlesRoot: root, dataDir: null, live: false }), "ana");
    expect(readdirSync(root)).toEqual(["L.json"]);
  });

  it("a secret file left empty is refused rather than replaced: a new secret would orphan every learner", () => {
    const dataDir = tmp();
    writeFileSync(join(dataDir, SECRET_FILE), "\n", { mode: 0o600 });
    expect(() => installSecret(dataDir)).toThrow(/\.studium-secret.*empty/);
  });

  it("the production check accepts an install secret but never the legacy one", async () => {
    unsetEnv("STUDIUM_PSEUDO_SECRET");
    vi.stubEnv("STUDIUM_ENV", "production");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = bundles();
    const fresh = join(tmp(), "data");
    await expect(new SessionHost({ bundlesRoot: root, dataDir: fresh, live: false }).create("L.json", "ana")).resolves.toBeTruthy();
    const legacy = tmp();
    mkdirSync(join(legacy, await profilePseudonym(LEGACY_PSEUDO_SECRET, "ana")));
    await expect(new SessionHost({ bundlesRoot: root, dataDir: legacy, live: false }).create("L.json", "ana"))
      .rejects.toThrow(/STUDIUM_PSEUDO_SECRET/);
  });
});
