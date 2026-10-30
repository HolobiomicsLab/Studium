// packages/lesson-session-host/src/community-bundles.test.ts
//
// P4 — multi-bundle discovery. A course's bundles root holds the IMMUTABLE canonical
// bundle alongside community/* single-scene ZIPs (community-<item_id>.zip) emitted by
// decide_item. discoverCommunityBundles() enumerates ONLY the community ones; the
// canonical file is never read/written. A discovered community ref resolves through the
// SAME resolveBundle path as the canonical bundle.
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, readFileSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverCommunityBundles, COMMUNITY_DIR } from "./community-bundles.js";
import { resolveBundle } from "./bundle-resolver.js";
import { SessionHost } from "./host.js";

// A SCHEMA-1.4 lesson.json (the same contract decide_item emits) zipped into a stand-in
// community single-scene bundle ZIP, built once for the suite. The m6 demo lesson is a valid
// 1.4 bundle that loadBundleZip accepts (unlike the legacy 1.0 m3 ZIP).
const LESSON_14 = fileURLToPath(new URL("../../../fixtures/m6/demo-atomistique/lesson.json", import.meta.url));
let SAMPLE_ZIP = "";
let zipStage = "";
beforeAll(() => {
  zipStage = mkdtempSync(join(tmpdir(), "cb-zip-"));
  cpSync(LESSON_14, join(zipStage, "lesson.json"));
  SAMPLE_ZIP = join(zipStage, "community-sample.zip");
  // zip with a deflated entry named exactly "lesson.json" (loadBundleZip reads files["lesson.json"]).
  execFileSync("zip", ["-j", "-q", SAMPLE_ZIP, join(zipStage, "lesson.json")]);
});
afterAll(() => { if (zipStage) rmSync(zipStage, { recursive: true, force: true }); });

const MINI = {
  schema_version: "1.4", bundle_id: "canon-001", source_plan_id: "p",
  metadata: { title: "Canon", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [{ id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" }],
  rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
};

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "cb-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A course bundles root: canonical bundle.json + a community/ subdir with N community-*.zip,
 * one dotfile, and one unrelated file that must be ignored. */
function makeCourse(nCommunity: number): { root: string; canonical: string; communityRefs: string[]; canonicalBytes: Buffer } {
  const root = tmp();
  const canonicalName = "lesson.json";
  writeFileSync(join(root, canonicalName), JSON.stringify(MINI));
  const canonicalBytes = readFileSync(join(root, canonicalName));
  const commDir = join(root, COMMUNITY_DIR);
  mkdirSync(commDir, { recursive: true });
  const communityRefs: string[] = [];
  for (let i = 0; i < nCommunity; i++) {
    const name = `community-item${i}.zip`;
    copyFileSync(SAMPLE_ZIP, join(commDir, name));
    communityRefs.push(`${COMMUNITY_DIR}/${name}`);
  }
  // Noise that must NOT be discovered:
  copyFileSync(SAMPLE_ZIP, join(commDir, ".community-hidden.zip")); // dotfile
  writeFileSync(join(commDir, "notes.txt"), "ignore me");           // wrong extension
  writeFileSync(join(commDir, ".DS_Store"), "x");                   // dotfile junk
  return { root, canonical: canonicalName, communityRefs, canonicalBytes };
}

describe("discoverCommunityBundles", () => {
  it("returns exactly the community-*.zip refs (not canonical, not dotfiles, not other extensions)", async () => {
    const { root, communityRefs } = makeCourse(3);
    const found = await discoverCommunityBundles(root);
    expect(found.sort()).toEqual(communityRefs.sort());
    // canonical never appears
    expect(found.some((r) => r.endsWith("lesson.json"))).toBe(false);
    // dotfiles never appear
    expect(found.some((r) => r.includes("/.")), "dotfile leaked").toBe(false);
  });

  it("returns [] when there is no community directory (canonical-only course)", async () => {
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify(MINI));
    expect(await discoverCommunityBundles(root)).toEqual([]);
  });

  it("resolves a discovered community ref into a loadable LessonBundle, leaving the canonical file untouched", async () => {
    const { root, canonical, canonicalBytes } = makeCourse(2);
    const refs = await discoverCommunityBundles(root);
    expect(refs.length).toBe(2);
    const bundle = await resolveBundle(root, refs[0]!);
    expect(typeof bundle.bundle_id).toBe("string");
    expect(Array.isArray(bundle.scenes)).toBe(true);
    // The canonical file is byte-identical (never mutated by discovery/resolution).
    expect(readFileSync(join(root, canonical))).toEqual(canonicalBytes);
  });

  it("discovered refs stay inside the bundles root (resolveBundle's traversal guard still applies)", async () => {
    const { root } = makeCourse(1);
    const refs = await discoverCommunityBundles(root);
    for (const r of refs) {
      expect(r.startsWith("..")).toBe(false);
      // each ref resolves without the 'escapes' guard firing
      await expect(resolveBundle(root, r)).resolves.toBeTruthy();
    }
  });
});

describe("SessionHost.listCommunityBundles", () => {
  it("lists the legacy root-level community/ with course_id null, each loadable by create()", async () => {
    const { root, canonical, canonicalBytes } = makeCourse(2);
    const host = new SessionHost({ bundlesRoot: root, live: false });
    const bundles = await host.listCommunityBundles();
    expect(bundles).toEqual([
      { bundle_ref: "community/community-item0.zip", course_id: null, item_id: "item0" },
      { bundle_ref: "community/community-item1.zip", course_id: null, item_id: "item1" },
    ]);
    // A community ref boots a session through the SAME create() path as the canonical bundle.
    const { sessionId, presentation } = await host.create(bundles[0]!.bundle_ref);
    expect(presentation.scene).toBeTruthy();
    expect(host.has(sessionId)).toBe(true);
    // Canonical course untouched.
    expect(readFileSync(join(root, canonical))).toEqual(canonicalBytes);
  });

  it("returns [] for a canonical-only course", async () => {
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify(MINI));
    const host = new SessionHost({ bundlesRoot: root, live: false });
    expect(await host.listCommunityBundles()).toEqual([]);
  });

  it("with a course id, lists only <course>/community/, each bundle_ref loadable by create()", async () => {
    const host = new SessionHost({ bundlesRoot: makeMultiCourseRoot(), live: false });
    const bundles = await host.listCommunityBundles("atomistique-l1");
    expect(bundles).toEqual([
      { bundle_ref: "atomistique-l1/community/community-a1.zip", course_id: "atomistique-l1", item_id: "a1" },
      { bundle_ref: "atomistique-l1/community/community-a2.zip", course_id: "atomistique-l1", item_id: "a2" },
    ]);
    for (const b of bundles) {
      const { sessionId, presentation } = await host.create(b.bundle_ref);
      expect(presentation.scene).toBeTruthy();
      expect(host.has(sessionId)).toBe(true);
    }
  });

  it("without a course id, lists the legacy root entries plus every course directory, sorted", async () => {
    const host = new SessionHost({ bundlesRoot: makeMultiCourseRoot(), live: false });
    expect(await host.listCommunityBundles()).toEqual([
      { bundle_ref: "atomistique-l1/community/community-a1.zip", course_id: "atomistique-l1", item_id: "a1" },
      { bundle_ref: "atomistique-l1/community/community-a2.zip", course_id: "atomistique-l1", item_id: "a2" },
      { bundle_ref: "community/community-legacy.zip", course_id: null, item_id: "legacy" },
      { bundle_ref: "kepler/community/community-k1.zip", course_id: "kepler", item_id: "k1" },
    ]);
  });

  it("returns [] for a course without community/ and for an unknown course", async () => {
    const host = new SessionHost({ bundlesRoot: makeMultiCourseRoot(), live: false });
    expect(await host.listCommunityBundles("no-community")).toEqual([]);
    expect(await host.listCommunityBundles("unknown-course")).toEqual([]);
  });

  it.each(["", "../atomistique-l1", "a/b", "Atomistique", ".hidden", "-x", "x".repeat(65)])(
    "rejects the invalid course id %j with a message naming the expected pattern",
    async (courseId) => {
      const host = new SessionHost({ bundlesRoot: makeMultiCourseRoot(), live: false });
      await expect(host.listCommunityBundles(courseId)).rejects.toThrow(/invalid course_id .*\^\[a-z0-9\]/);
    },
  );
});

/** A bundles root holding several courses (<course>/lesson.json + <course>/community/), the legacy
 * root-level community/, and directories that are not courses (hidden, not a course id). */
function makeMultiCourseRoot(): string {
  const root = tmp();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(MINI));
  const put = (dir: string, names: string[]) => {
    mkdirSync(join(root, dir), { recursive: true });
    for (const name of names) copyFileSync(SAMPLE_ZIP, join(root, dir, name));
  };
  put(COMMUNITY_DIR, ["community-legacy.zip"]);
  put(`atomistique-l1/${COMMUNITY_DIR}`, ["community-a2.zip", "community-a1.zip", ".community-tmp.zip"]);
  writeFileSync(join(root, "atomistique-l1", "lesson.json"), JSON.stringify(MINI));
  writeFileSync(join(root, "atomistique-l1", COMMUNITY_DIR, "notes.txt"), "ignore me");
  put(`kepler/${COMMUNITY_DIR}`, ["community-k1.zip"]);
  mkdirSync(join(root, "no-community"));
  writeFileSync(join(root, "no-community", "lesson.json"), JSON.stringify(MINI));
  put(`.hidden/${COMMUNITY_DIR}`, ["community-h.zip"]);
  put(`Not A Course/${COMMUNITY_DIR}`, ["community-n.zip"]);
  writeFileSync(join(root, "README.md"), "a file, not a course");
  return root;
}
