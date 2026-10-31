// community.driver.ts — standalone tsx unit test for the community-contributions picker logic
// (community.ts). Asserts discovery scans the bound course's community/ subdir, returns refs
// loadable exactly like the canonical bundle, excludes hidden/temp + wrong-extension files, and
// shapes pseudonym-free picker items — all with NO VS Code host and NO MCP server.
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/community.driver.ts
//
// Exits non-zero (and prints FAIL) on any failed assertion.
import {
  discoverCommunityBundles,
  courseDirOf,
  isCommunityBundleFile,
  toPickItems,
  COMMUNITY_DIR,
} from "./community.js";
import { isolateFromHome } from "./driver-isolation.js";
import { MAX_LESSON_BYTES, MAX_ZIP_BYTES, readConceptTitles, zipEntry } from "./bundle-titles.js";
import { makeZip } from "./zip-fixture.js";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// I-10: no driver may write into the developer's home, even one that starts no server.
const isolation = isolateFromHome("community");

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) {
  checks++;
  if (!cond) failures.push(msg);
}

// An in-memory directory listing keyed by absolute dir path → file names. discoverCommunityBundles
// only reads ONE dir (the course's community/ subdir); we inject a readdir that serves it and throws
// for any other path (mirrors ENOENT on a canonical-only course).
function fakeReaddir(listing: Record<string, string[]>) {
  return (dir: string): string[] => {
    const norm = dir.replace(/\\/g, "/");
    if (norm in listing) return listing[norm];
    throw Object.assign(new Error(`ENOENT: ${dir}`), { code: "ENOENT" });
  };
}

const BUNDLES_ROOT = "/repo/fixtures";
const CANONICAL_REF = "atomistique-l1/lesson.json";
const COMMUNITY_FS = `${BUNDLES_ROOT}/atomistique-l1/${COMMUNITY_DIR}`;

// --- 1) courseDirOf derives the course dir from the canonical ref ---------------------------------
{
  expect(courseDirOf("atomistique-l1/lesson.json") === "atomistique-l1", "courseDirOf nested");
  expect(courseDirOf("lesson.json") === ".", "courseDirOf root-level canonical → '.'");
  expect(courseDirOf("a/b/lesson.json") === "a/b", "courseDirOf deep");
}

// --- 2) isCommunityBundleFile gate ----------------------------------------------------------------
{
  expect(isCommunityBundleFile("community-item1.zip") === true, "accepts community-*.zip");
  expect(isCommunityBundleFile(".community-hidden.zip") === false, "rejects dotfile");
  expect(isCommunityBundleFile(".community-x.tmp.zip") === false, "rejects hidden temp");
  expect(isCommunityBundleFile("notes.txt") === false, "rejects wrong extension");
  expect(isCommunityBundleFile("lesson.json") === false, "rejects canonical");
  expect(isCommunityBundleFile("community-x.zip.bak") === false, "rejects non-.zip suffix");
}

// --- 3) discovery returns exactly the community refs, relative to the bundles root ----------------
{
  const readdir = fakeReaddir({
    [COMMUNITY_FS]: [
      "community-itemB.zip",
      "community-itemA.zip",
      ".community-hidden.zip", // dotfile noise
      "notes.txt",             // wrong extension
      ".DS_Store",             // junk
      ".community-itemA.tmp.zip", // leftover temp
    ],
  });
  const found = discoverCommunityBundles(BUNDLES_ROOT, CANONICAL_REF, { readdir });
  const refs = found.map((b) => b.ref);
  // sorted, exactly the two real community bundles, refs relative to bundles root + under the course
  expect(
    JSON.stringify(refs) ===
      JSON.stringify([
        `atomistique-l1/${COMMUNITY_DIR}/community-itemA.zip`,
        `atomistique-l1/${COMMUNITY_DIR}/community-itemB.zip`,
      ]),
    `discovery refs (got ${JSON.stringify(refs)})`,
  );
  // each ref starts with the course dir (loads through the SAME path as the canonical bundle)
  expect(found.every((b) => b.ref.startsWith("atomistique-l1/")), "refs scoped to bound course");
  // item ids parsed out of the filename
  expect(
    JSON.stringify(found.map((b) => b.itemId)) === JSON.stringify(["itemA", "itemB"]),
    `item ids (got ${JSON.stringify(found.map((b) => b.itemId))})`,
  );
  // the canonical lesson.json is never swept into the community list
  expect(!refs.some((r) => r.endsWith("lesson.json")), "canonical never in community refs");
}

// --- 4) canonical-only course (no community/ subdir) → [] ------------------------------------------
{
  const readdir = fakeReaddir({}); // every readdir throws ENOENT
  const found = discoverCommunityBundles(BUNDLES_ROOT, CANONICAL_REF, { readdir });
  expect(found.length === 0, `canonical-only course returns [] (got ${found.length})`);
}

// --- 5) root-level canonical course (bundleRef = "lesson.json") -----------------------------------
{
  const rootCommunity = `${BUNDLES_ROOT}/${COMMUNITY_DIR}`;
  const readdir = fakeReaddir({ [rootCommunity]: ["community-r1.zip"] });
  const found = discoverCommunityBundles(BUNDLES_ROOT, "lesson.json", { readdir });
  expect(
    found.length === 1 && found[0].ref === `${COMMUNITY_DIR}/community-r1.zip`,
    `root-level course ref (got ${JSON.stringify(found.map((b) => b.ref))})`,
  );
}

// --- 6) toPickItems shapes neutral, pseudonym-free items ------------------------------------------
{
  const items = toPickItems([
    { ref: "atomistique-l1/community/community-itemA.zip", itemId: "itemA" },
    { ref: "atomistique-l1/community/community-itemB.zip", itemId: "itemB" },
  ]);
  expect(items.length === 2, "two pick items");
  expect(items[0].ref === "atomistique-l1/community/community-itemA.zip", "pick item carries ref");
  expect(items.every((it) => it.label.length > 0), "pick items have labels");
  // The author pseudonym is never present (the emitted bundle is already scrubbed); item ids are
  // neutral and contain no learner identity, but we still assert the picker shows no "hmac-" token.
  expect(!JSON.stringify(items).includes("hmac-"), "no pseudonym token in picker items");
}

// --- concept titles of a community bundle (W4 review: the pane never shows the bare id) ------------------
// A community bundle is a .zip holding lesson.json; the titles come from inside it, as for a lesson.json file.
{
  const dir = mkdtempSync(join(tmpdir(), "studium-titles-"));
  const lesson = JSON.stringify({ concepts: [{ id: "concept:c1", title: "Énergie d'ionisation" }, { id: "c2", title: "" }, { title: "no id" }] });
  const want = (t: Record<string, string>) => t["concept:c1"] === "Énergie d'ionisation" && t["c2"] === "c2" && Object.keys(t).length === 2;
  writeFileSync(join(dir, "plain.json"), lesson);
  mkdirSync(join(dir, "folder"));
  writeFileSync(join(dir, "folder", "lesson.json"), lesson);
  writeFileSync(join(dir, "community-deflated.zip"), makeZip({ "assets/a.txt": "x", "lesson.json": lesson }, true));
  writeFileSync(join(dir, "community-stored.zip"), makeZip({ "lesson.json": lesson }, false));
  writeFileSync(join(dir, "community-empty.zip"), makeZip({ "other.json": lesson }));
  writeFileSync(join(dir, "community-broken.zip"), "not a zip at all");
  expect(want(readConceptTitles(join(dir, "plain.json"))), "titles from a lesson.json file");
  expect(want(readConceptTitles(join(dir, "folder"))), "titles from a bundle folder holding lesson.json");
  expect(want(readConceptTitles(join(dir, "community-deflated.zip"))), "titles from inside a deflated community .zip");
  expect(want(readConceptTitles(join(dir, "community-stored.zip"))), "titles from inside a stored community .zip");
  expect(Object.keys(readConceptTitles(join(dir, "community-empty.zip"))).length === 0, "a .zip without lesson.json gives no titles");
  expect(Object.keys(readConceptTitles(join(dir, "community-broken.zip"))).length === 0, "an unreadable .zip gives no titles");
  expect(Object.keys(readConceptTitles(join(dir, "missing.zip"))).length === 0, "a missing file gives no titles");

  // SEC-5: a classmate's .zip is read in the extension host, so its size is capped before anything is inflated.
  // A lesson.json that inflates past MAX_LESSON_BYTES (8 MB) is refused, whether its central directory says so
  // or lies about it (the inflate itself is bounded); an archive or a lesson file past their caps is not read.
  const big = JSON.stringify({ concepts: [{ id: "c1", title: "T" }], pad: " ".repeat(MAX_LESSON_BYTES + 1024) });
  writeFileSync(join(dir, "community-bomb.zip"), makeZip({ "lesson.json": big }, true));
  const liar = makeZip({ "lesson.json": big }, true);
  const centralAt = liar.readUInt32LE(liar.length - 22 + 16);
  liar.writeUInt32LE(1000, centralAt + 24); // the central directory now claims 1000 bytes uncompressed
  writeFileSync(join(dir, "community-liar.zip"), liar);
  writeFileSync(join(dir, "huge-plain.json"), big);
  expect(zipEntry(readFileSync(join(dir, "community-bomb.zip")), "lesson.json") === null, "an entry declared bigger than the cap is not inflated");
  let liarThrew = false;
  try { zipEntry(liar, "lesson.json"); } catch { liarThrew = true; }
  expect(liarThrew, "an entry that inflates past the cap despite its header stops at the cap (maxOutputLength)");
  for (const name of ["community-bomb.zip", "community-liar.zip", "huge-plain.json"]) {
    expect(Object.keys(readConceptTitles(join(dir, name))).length === 0, `${name}: past the cap, no titles are read`);
  }
  const sparse = join(dir, "community-oversize.zip");
  writeFileSync(sparse, makeZip({ "assets/blob.bin": Buffer.alloc(MAX_ZIP_BYTES), "lesson.json": lesson }, false)); // valid, past the cap
  expect(Object.keys(readConceptTitles(sparse)).length === 0, "an archive past MAX_ZIP_BYTES is not read at all");
}

expect(isolation.homeUntouched(), `I-10: nothing was written into the home directory (${isolation.home})`);
if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} community-picker assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — community-picker discovery + shaping passed all ${checks} assertions.`);
