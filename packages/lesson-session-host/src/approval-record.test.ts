// packages/lesson-session-host/src/approval-record.test.ts
//
// Owner decision 2026-11-10: the approval record is the only source of the "validated" status. Three
// states on every surface: approved (a record bound to the loaded lesson.json bytes, the reviewer
// named from the record), changed since approval (a record for other bytes), no record (none,
// malformed or foreign). A lesson .zip (a teacher's distribution, a community bundle) carries its
// record as the member `approval.json`, bound to the bytes of its `lesson.json` member.
import { describe, it, expect, afterEach } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { loadResolvedBundle } from "./bundle-resolver.js";
import { lessonListMarkdown } from "./chat-display.js";

const ATOMISTIQUE = fileURLToPath(new URL("../../../fixtures/atomistique-l1/lesson.json", import.meta.url));
const M6_ZIP = fileURLToPath(new URL("../../../fixtures/m6/demo-atomistique-bundle.zip", import.meta.url));
const M6_LESSON = fileURLToPath(new URL("../../../fixtures/m6/demo-atomistique/lesson.json", import.meta.url));
const NO_RECORD_FR = "> Aucune approbation enregistrée pour cette leçon.";
const STALE_FR = "Attention : cette leçon a été modifiée depuis son approbation par l'enseignant.";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "approval-record-")); dirs.push(d); return d; }
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const record = (digest: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  schema: "studium-approval/1", bundle_sha256: digest, reviewer: "Synthetic Reviewer",
  reviewed_at: "2026-11-10T09:00:00Z", checklist: {}, lint: { errors: 0, warnings: 0 }, tool: "test", ...extra,
});

/** A .zip in a fresh root holding `lesson` as lesson.json and, when given, `approval` as approval.json. */
function zipRoot(lesson: string, approval?: string): { root: string; ref: string } {
  const root = tmp();
  const stage = tmp();
  writeFileSync(join(stage, "lesson.json"), lesson);
  const members = [join(stage, "lesson.json")];
  if (approval !== undefined) { writeFileSync(join(stage, "approval.json"), approval); members.push(join(stage, "approval.json")); }
  execFileSync("zip", ["-j", "-q", join(root, "lesson-bundle.zip"), ...members]);
  return { root, ref: "lesson-bundle.zip" };
}

async function start(root: string, ref: string) {
  const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
  const started = await host.create(ref, "auto-test-approval-record");
  return { host, started, voice: host.authorVoice(started.sessionId), text: started.presentation.display_markdown };
}

describe("a lesson .zip reads its approval member, bound to its lesson.json member", () => {
  const lesson = readFileSync(M6_LESSON, "utf8");

  it("approved: a matching member names the record's reviewer, not validated_by", async () => {
    const { root, ref } = zipRoot(lesson, record(sha(lesson)));
    const { started, voice, text } = await start(root, ref);
    expect(started.authoring.validated).toBe(true);
    expect(started.authoring.approval).toEqual({ recorded: true, matches: true, reviewer: "Synthetic Reviewer",
      reviewed_at: "2026-11-10T09:00:00Z" });
    expect(voice).toMatchObject({ kind: "author", name: "Synthetic Reviewer", reviewed: true });
    expect(text).toContain("validée par Synthetic Reviewer.");
    expect(text).not.toContain(JSON.parse(lesson).validated_by);
  });

  it("changed since approval: a member for other bytes is stale", async () => {
    const { root, ref } = zipRoot(lesson, record(sha(lesson + "\n")));
    const { started, voice, text } = await start(root, ref);
    expect(started.authoring).toMatchObject({ validated: false, approval: { recorded: true, matches: false } });
    expect(voice).toMatchObject({ name: "Synthetic Reviewer", reviewed: false });
    expect(text).toContain(STALE_FR);
  });

  it("no record: no member, a malformed one or a foreign one", async () => {
    for (const approval of [undefined, "{not json", record(sha(lesson), { schema: "other/1" }), record(sha(lesson), { reviewer: 3 })]) {
      const { root, ref } = zipRoot(lesson, approval);
      const { started, voice, text } = await start(root, ref);
      expect(started.authoring).toMatchObject({ validated: false, approval: { recorded: false, matches: false } });
      expect(voice).toMatchObject({ name: null, reviewed: false });
      expect(text).toContain(NO_RECORD_FR);
    }
  });

  it("the shipped demo zip carries no record and reads as no approval recorded", async () => {
    const root = tmp();
    cpSync(M6_ZIP, join(root, "demo.zip"));
    const resolved = await loadResolvedBundle(root, "demo.zip");
    expect(resolved.approval).toEqual({ recorded: false, matches: false });
    expect(resolved.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a record next to the .zip on disk is not the zip's record", async () => {
    const { root, ref } = zipRoot(lesson);
    writeFileSync(join(root, "approval.json"), record(sha(lesson)));
    expect((await loadResolvedBundle(root, ref)).approval).toEqual({ recorded: false, matches: false });
  });
});

describe("the shipped atomistique fixture: validated_by is an address and no record exists", () => {
  it("reads as no approval recorded, in the voice, the first screen and the authoring block", async () => {
    const root = tmp();
    cpSync(ATOMISTIQUE, join(root, "lesson.json"));
    const { started, voice, text } = await start(root, "lesson.json");
    expect(started.authoring.validated).toBe(false);
    expect(voice).toEqual({ kind: "author", name: null, reviewed: false, drafted_by: "teacher" });
    expect(text.startsWith(`${NO_RECORD_FR}\n\n`)).toBe(true);
    expect(text).not.toContain("@");
  });

  it("an approved copy reads validated by the record's reviewer", async () => {
    const root = tmp();
    const bytes = readFileSync(ATOMISTIQUE);
    writeFileSync(join(root, "lesson.json"), bytes);
    writeFileSync(join(root, "approval.json"), record(sha(bytes)));
    const { voice, text } = await start(root, "lesson.json");
    expect(voice).toEqual({ kind: "author", name: "Synthetic Reviewer", reviewed: true, drafted_by: "teacher" });
    expect(text.startsWith("> Leçon validée par Synthetic Reviewer.\n\n")).toBe(true);
  });
});

// A learner's contribution a teacher reviewed (community-<id>.zip written by scene-synth decide_item):
// metadata.authoring = { mode: "teacher", author_is_learner: true, drafted_by: "learner" } and the record as
// that service writes it, extra fields included. A classmate wrote it, not the person reading it.
describe("a classmate's contribution reads as proposed by a classmate, never as « que tu as rédigée »", () => {
  const contribution = (() => {
    const bundle = JSON.parse(readFileSync(M6_LESSON, "utf8"));
    bundle.metadata.authoring = { mode: "teacher", author_is_learner: true, drafted_by: "learner" };
    return JSON.stringify(bundle);
  })();
  const decideItemRecord = (digest: string) => JSON.stringify({ schema: "studium-approval/1", bundle_sha256: digest,
    reviewer: "Synthetic Reviewer", reviewed_at: "2026-11-10T09:00:00Z", tool: "scene-synth decide_item 1.0",
    decision_route: "learner-contribution" });
  const communityZip = (approval?: string) => {
    const { root } = zipRoot(contribution, approval);
    mkdirSync(join(root, "community"));
    renameSync(join(root, "lesson-bundle.zip"), join(root, "community", "community-item1.zip"));
    return { root, ref: "community/community-item1.zip" };
  };

  it("approved: names the record's reviewer after the classmate", async () => {
    const { root, ref } = communityZip(decideItemRecord(sha(contribution)));
    const { started, voice, text } = await start(root, ref);
    expect(started.authoring).toMatchObject({ mode: "teacher", drafted_by: "learner", validated: true });
    expect(voice).toEqual({ kind: "author", name: "Synthetic Reviewer", reviewed: true, drafted_by: "learner", from_classmate: true });
    expect(text.startsWith("> Leçon proposée par une personne de la classe, validée par Synthetic Reviewer.\n\n")).toBe(true);
    expect(text).not.toContain("que tu as rédigée");
  });

  it("no record: says who proposed it and that no approval is recorded", async () => {
    const { root, ref } = communityZip();
    const { voice, text } = await start(root, ref);
    expect(voice).toEqual({ kind: "author", name: null, reviewed: false, drafted_by: "learner", from_classmate: true });
    expect(text.startsWith("> Leçon proposée par une personne de la classe. Aucune approbation enregistrée pour cette leçon.\n\n")).toBe(true);
  });

  it("stale: the changed-since-approval notice on the first screen, the classmate in the voice", async () => {
    const { root, ref } = communityZip(decideItemRecord(sha(contribution + " ")));
    const { voice, text } = await start(root, ref);
    expect(voice).toMatchObject({ name: "Synthetic Reviewer", reviewed: false, from_classmate: true });
    expect(text).toContain(STALE_FR);
    expect(text).not.toContain("que tu as rédigée");
  });
});

describe("list_lessons' text names a classmate's contribution as such", () => {
  it("« proposée par une personne de la classe » for a teacher-mode lesson a learner drafted, « écrite par toi » for self-study", () => {
    const text = lessonListMarkdown([
      { title: "Contribution", scene_count: 1, drafted_by: "learner", mode: "teacher" },
      { title: "Mine", scene_count: 2, drafted_by: "learner", mode: "self_study" },
    ], "fr");
    expect(text).toContain("Contribution");
    expect(text).toMatch(/Contribution[^\n]*proposée par une personne de la classe/);
    expect(text).toMatch(/Mine[^\n]*écrite par toi/);
    expect(lessonListMarkdown([{ title: "C", scene_count: 1, drafted_by: "learner", mode: "teacher" }], "en")).toContain("contributed by a classmate");
  });
});
