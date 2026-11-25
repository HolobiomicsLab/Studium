// packages/lesson-session-host/src/authoring-draft/draft-store.ts
//
// D4 (waiting review 2026-11-25, owner's decision 3): what Studium keeps of a lesson build that did not
// finish: the draft create_lesson refused, one file per source set and learner,
// `<library>/_drafts/<source_set_id>[.<learner>].json`.
//
// - create_lesson keeps a draft it refused for what the draft says (build.ts), with its errors, so that
//   the assistant resends only the faulty scenes (draft_id); a refusal that is not about the draft (a
//   lesson already there, an unknown source set) keeps nothing. The kept draft holds the draft's keys, as
//   lesson.json does, but of the learner profile only minutes_per_day and target_date, and no error about
//   the profile (what the learner knows or likes stays out, even in a misspelled field).
// - Review of D4 (M1, M2): a kept draft records the learner it was refused for, as their pseudonym
//   (SessionHost.draftLearnerOf), or null when no learner is known. get_study_plan offers to finish only a
//   kept draft, and only to its learner (unfinishedBuilds): a draft kept for no known learner serves the
//   resend in the same conversation and is offered to no one, so a shared computer never shows one
//   learner's goal or file to another. Sources prepared with no kept draft are never offered: the server
//   cannot tell a build that stopped from one still running or already done. A lesson written ends the
//   builds it finishes (endedByWrite): every draft kept for its learner, and what was kept of the same
//   sources for no learner. A draft is not offered while the build may still be running
//   (BUILD_GRACE_MINUTES); it is removed once discarded (discardBuild), and removed when read after
//   UNFINISHED_BUILD_DAYS. forgetLearner erases the learner's drafts (eraseLearnerDrafts).
// - Every call that reads or writes the kept drafts of a library runs one at a time in this process
//   (oneAtATime, minor 2 of the review): two resends of the same draft cannot both write the lesson, and a
//   refusal that came in while a lesson was being written keeps nothing that lesson ended.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { BundleIssue } from "@studium/lesson-bundle-schema";
import { DEFAULT_LICENSE, readSourceSet, SOURCE_SET_ID_PATTERN, type SourceSet } from "./source-set.js";

/** The library folder of kept drafts. A course id cannot start with "_", so no course collides. */
export const DRAFTS_DIR = "_drafts";
export const DRAFT_ID_PATTERN = /^dr-[0-9a-f]{16}$/;
/** A learner's pseudonym, as SessionHost.draftLearnerOf gives it (HmacPseudonymProvider). */
const LEARNER_PATTERN = /^[0-9a-f]{16}$/;
/** How long a kept draft is kept and offered. */
export const UNFINISHED_BUILD_DAYS = 14;
/** A build left less than this long ago may still be running (writing a lesson takes minutes). */
export const BUILD_GRACE_MINUTES = 30;
const RECORD_SCHEMA = "studium-draft/1";
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** What a kept draft keeps of the learner profile: what schedules the lesson, as lesson.json keeps it. */
const KEPT_PROFILE_FIELDS = ["minutes_per_day", "target_date"] as const;

/** What a refusal asks the assistant to send again: only the scenes it names, or the whole draft. */
export type Resend = "scenes" | "draft";

const IssueSchema = z.object({ path: z.string(), message: z.string(), hint: z.string() });
const KeptDraftSchema = z.object({
  schema: z.literal(RECORD_SCHEMA),
  kind: z.literal("draft"),
  source_set_id: z.string().regex(SOURCE_SET_ID_PATTERN),
  draft_id: z.string().regex(DRAFT_ID_PATTERN),
  saved_at: z.string(),
  /** The pseudonym of the learner the draft was refused for; null (or absent) when none was known. */
  learner: z.string().regex(LEARNER_PATTERN).nullable().optional(),
  /** The sha256 of each source of the set, sorted: what another preparation of the same sources shares. */
  sources: z.array(z.string()),
  course_id: z.string().optional(),
  resend: z.enum(["scenes", "draft"]),
  fix_scenes: z.array(z.number().int().nonnegative()),
  draft: z.record(z.string(), z.unknown()),
  errors: z.array(IssueSchema),
});
export type KeptDraft = z.infer<typeof KeptDraftSchema>;
/** What says whose draft it is and which sources it is built on. */
type DraftKey = Pick<KeptDraft, "source_set_id" | "sources" | "learner">;

/** The kept draft as get_study_plan shows it: no key, only what rewriting a scene needs. */
export interface KeptDraftOutline {
  title: string;
  concepts: Array<{ id: string; label: string }>;
  scenes: Array<{ at: number; type: string; title: string; concepts: string[] }>;
}

/** A lesson build that stopped, as get_study_plan offers it to its learner. */
export interface UnfinishedBuild {
  source_set_id: string;
  /** The kept draft to fix scene by scene (create_lesson {source_set_id, draft_id, scenes}); null when the
   * whole draft must be written again: its errors concern more than scenes. */
  draft_id: string | null;
  /** What the last refusal asked to send again. */
  resend: Resend;
  /** The scenes to send again (their index in the draft), when resend is "scenes". */
  fix_scenes: number[];
  /** The titles of the sources the lesson is built from. */
  sources: string[];
  /** When the draft was refused (ISO). */
  left_at: string;
  /** The kept draft without its keys. */
  outline: KeptDraftOutline;
  /** The prepare_sources arguments that give the same passages and source set again, when every source
   * is a file; null when a source was passed as text (the assistant fetches it again). */
  prepare_sources: { sources: Array<Record<string, string>>; goal?: string; language?: string } | null;
}

/** The sorted sha256 of the sources of `set`: equal for every preparation of the same texts. */
export function sourcesKey(set: SourceSet): string[] {
  return set.sources.map((source) => source.sha256).sort();
}

/** What one call on a library may ask of the calls that ran before it (oneAtATime). */
export interface LibraryTurn {
  /** Whether a lesson written since this call came in ended a draft kept as `draft`: then keep nothing. */
  endedMeanwhile(draft: DraftKey): boolean;
  /** Record that this call wrote a lesson that ends the drafts `ends` matches. */
  wrote(ends: (draft: DraftKey) => boolean): void;
}

interface LibraryQueue {
  tail: Promise<void>;
  /** Calls that came in, in order; a call's ticket is the count when it came. */
  issued: number;
  /** Calls not finished yet: the queue is dropped at 0. */
  pending: number;
  /** Lessons written, each with the count of calls that had come in when it was written. */
  writes: Array<{ upTo: number; ends: (draft: DraftKey) => boolean }>;
}
const queues = new Map<string, LibraryQueue>();

/** Run `work` once every call on `libraryRoot` that came before it has finished: one call at a time per
 * library in this process, in the order they came. Not reentrant: `work` calls no other function that
 * takes the turn. */
export function oneAtATime<T>(libraryRoot: string, work: (turn: LibraryTurn) => Promise<T>): Promise<T> {
  const key = resolve(libraryRoot);
  const queue = queues.get(key) ?? { tail: Promise.resolve(), issued: 0, pending: 0, writes: [] };
  queues.set(key, queue);
  queue.issued += 1;
  queue.pending += 1;
  const ticket = queue.issued;
  const turn: LibraryTurn = {
    endedMeanwhile: (draft) => queue.writes.some((write) => write.upTo >= ticket && write.ends(draft)),
    wrote: (ends) => { queue.writes.push({ upTo: queue.issued, ends }); },
  };
  const run = queue.tail.then(() => work(turn));
  queue.tail = run.then(() => undefined, () => undefined).then(() => {
    queue.pending -= 1;
    if (queue.pending === 0 && queues.get(key) === queue) queues.delete(key);
  });
  return run;
}

/** Keep `draft` for `set`, refused with `errors`, for `learner` (null: no learner known): the draft and its
 * errors without what the learner knows or likes, with the id of exactly those contents. Replaces what was
 * kept of the same sources for the same learner (for a learner, also what was kept of them for no one).
 * Runs inside oneAtATime. */
export async function keepDraft(
  libraryRoot: string, set: SourceSet,
  refused: { draft: Record<string, unknown>; errors: BundleIssue[]; resend: Resend; fix_scenes: number[]; course_id?: string | undefined; learner: string | null },
  now: Date,
): Promise<KeptDraft> {
  const draft = keptDraftOf(refused.draft);
  const record: KeptDraft = {
    schema: RECORD_SCHEMA, kind: "draft", source_set_id: set.source_set_id, draft_id: draftIdOf(draft),
    saved_at: now.toISOString(), learner: refused.learner, sources: sourcesKey(set),
    ...(refused.course_id === undefined ? {} : { course_id: refused.course_id }),
    resend: refused.resend, fix_scenes: refused.fix_scenes, draft,
    errors: refused.errors.filter((error) => !aboutProfile(error.path)),
  };
  await removeRecords(libraryRoot, (other) => sameSources(other.sources, record.sources)
    && (learnerOf(other) === refused.learner || learnerOf(other) === null), now.getTime());
  await writeRecord(libraryRoot, record);
  return record;
}

/** The kept draft `draftId` over the sources of `set` (this set, or another preparation of the same
 * sources), kept to be fixed scene by scene (minor 4 of the review: a draft kept for a whole resend is
 * never patched), or why there is none: the id of the last such draft kept of them for the same learner.
 * Runs inside oneAtATime. */
export async function findKeptDraft(
  libraryRoot: string, set: SourceSet, draftId: string, nowMs: number, learner: string | null,
): Promise<{ draft: KeptDraft } | { draft: null; latest: string | null }> {
  const key = sourcesKey(set);
  const kept = (await readRecords(libraryRoot, nowMs))
    .flatMap(({ record }) => (record.resend === "scenes" && sameSources(record.sources, key) ? [record] : []))
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  const mine = (record: KeptDraft) => learnerOf(record) === learner;
  const draft = kept.find((record) => record.draft_id === draftId && mine(record)) ?? kept.find((record) => record.draft_id === draftId);
  return draft ? { draft } : { draft: null, latest: kept.find(mine)?.draft_id ?? null };
}

/** What a lesson written from `set` for `learner` ends: every draft kept for that learner, what was kept of
 * the same sources for no learner, and the kept draft it was patched from; with no learner known,
 * everything kept of the same sources (it may be anyone's). */
export function endedByWrite(set: SourceSet, learner: string | null, patched: KeptDraft | null): (draft: DraftKey) => boolean {
  const key = sourcesKey(set);
  return (draft) => (patched !== null && fileNameOf(draft) === fileNameOf(patched))
    || (learner === null ? sameSources(draft.sources, key)
      : learnerOf(draft) === learner || (learnerOf(draft) === null && sameSources(draft.sources, key)));
}

/** After a lesson is written: remove the drafts `ends` matches (endedByWrite). Runs inside oneAtATime. */
export async function clearDrafts(libraryRoot: string, ends: (draft: DraftKey) => boolean, now: Date): Promise<void> {
  await removeRecords(libraryRoot, ends, now.getTime());
}

/** `learner` does not want the build of `sourceSetId` finished: remove what was kept of the same sources for
 * them (null: for no learner). Throws AuthoringInputError for an unknown source set. */
export function discardBuild(libraryRoot: string, sourceSetId: string, now: Date, learner: string | null): Promise<void> {
  return oneAtATime(libraryRoot, async () => {
    const key = sourcesKey(await readSourceSet(libraryRoot, sourceSetId));
    await removeRecords(libraryRoot, (record) => sameSources(record.sources, key) && learnerOf(record) === learner, now.getTime());
  });
}

/** Erase every kept draft (forgetLearner on an install with no pseudonym key, where no draft can be matched
 * to a learner). Whether there was a folder to erase. */
export function eraseDrafts(libraryRoot: string): Promise<boolean> {
  return oneAtATime(libraryRoot, async () => {
    const dir = join(libraryRoot, DRAFTS_DIR);
    try { await stat(dir); } catch { return false; }
    await rm(dir, { recursive: true, force: true });
    return true;
  });
}

/** forgetLearner: erase the drafts kept for `learner` (null: no learner known), those kept for no learner
 * (they may be theirs) and any file that is not another learner's draft. Whether anything was erased. */
export function eraseLearnerDrafts(libraryRoot: string, learner: string | null): Promise<boolean> {
  return oneAtATime(libraryRoot, async () => {
    const dir = join(libraryRoot, DRAFTS_DIR);
    let names: string[];
    try { names = await readdir(dir); } catch { return false; }
    let erased = false;
    for (const name of names) {
      const record = await recordIn(dir, name);
      const othersOwn = record !== null && learnerOf(record) !== null && learnerOf(record) !== learner;
      if (othersOwn) continue;
      await rm(join(dir, name), { recursive: true, force: true });
      erased = true;
    }
    await removeIfEmpty(dir);
    return erased;
  });
}

/** The builds to offer `learner` at `nowMs`: the drafts kept for them, the most recent first, one per set of
 * sources. None for null (no learner known). Removes the records past their expiry. */
export function unfinishedBuilds(libraryRoot: string, nowMs: number, learner: string | null): Promise<UnfinishedBuild[]> {
  return oneAtATime(libraryRoot, async () => {
    const records = (await readRecords(libraryRoot, nowMs)).map(({ record }) => record);
    if (learner === null) return [];
    const offered = (record: KeptDraft) => learnerOf(record) === learner && Date.parse(record.saved_at) <= nowMs - BUILD_GRACE_MINUTES * MINUTE_MS;
    const builds: UnfinishedBuild[] = [];
    const seen = new Set<string>();
    for (const record of records.filter(offered).sort((a, b) => b.saved_at.localeCompare(a.saved_at))) {
      const key = record.sources.join(",");
      if (seen.has(key)) continue;
      const set = await readSourceSet(libraryRoot, record.source_set_id).catch(() => null);
      if (!set) continue;
      seen.add(key);
      builds.push(buildOf(set, record));
    }
    return builds;
  });
}

function buildOf(set: SourceSet, draft: KeptDraft): UnfinishedBuild {
  return {
    source_set_id: set.source_set_id,
    draft_id: draft.resend === "scenes" ? draft.draft_id : null,
    resend: draft.resend,
    fix_scenes: draft.resend === "scenes" ? draft.fix_scenes : [],
    sources: set.sources.map((source) => source.title),
    left_at: draft.saved_at,
    outline: outlineOf(draft.draft),
    prepare_sources: prepareArgumentsOf(set),
  };
}

/** The prepare_sources call that gives `set` again (every recorded field, so the same id while the
 * files are unchanged), or null when a source was given as text. */
function prepareArgumentsOf(set: SourceSet): UnfinishedBuild["prepare_sources"] {
  if (!set.sources.every((source) => source.file)) return null;
  return {
    sources: set.sources.map((source) => ({
      path: source.file!.path, title: source.title,
      ...(source.url === null ? {} : { url: source.url }),
      ...(source.license === DEFAULT_LICENSE ? {} : { license: source.license }),
      ...(source.kind ? { kind: source.kind } : {}),
    })),
    ...(set.goal === null ? {} : { goal: set.goal }),
    ...(set.language === null ? {} : { language: set.language }),
  };
}

/** Titles, concepts and the type and concepts of each scene of a raw draft: never a key. */
function outlineOf(draft: Record<string, unknown>): KeptDraftOutline {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const records = (value: unknown) => (Array.isArray(value) ? value : []).map((item) => (isRecord(item) ? item : {}));
  return {
    title: text(draft["title"]),
    concepts: records(draft["concepts"]).map((concept) => ({ id: text(concept["id"]), label: text(concept["label"]) })),
    scenes: records(draft["scenes"]).map((scene, at) => ({
      at, type: text(scene["type"]), title: text(scene["title"]),
      concepts: (Array.isArray(scene["concept_refs"]) ? scene["concept_refs"] : []).filter((ref): ref is string => typeof ref === "string"),
    })),
  };
}

/** The draft as kept (minor 1 of the review): of the learner profile only minutes_per_day and target_date,
 * as lesson.json keeps them; what the learner knows or likes stays out, under its own name or a misspelled
 * one. An emptied profile stays an (empty) profile, so the build gives the same advice on the opening
 * diagnostic. */
function keptDraftOf(draft: Record<string, unknown>): Record<string, unknown> {
  if (!("learner_profile" in draft)) return draft;
  const profile = draft["learner_profile"];
  const kept = isRecord(profile) ? Object.fromEntries(KEPT_PROFILE_FIELDS.filter((field) => field in profile).map((field) => [field, profile[field]])) : {};
  return { ...draft, learner_profile: kept };
}

/** An error about the learner profile: it may quote what the learner wrote there. */
function aboutProfile(path: string): boolean {
  return path === "learner_profile" || path.startsWith("learner_profile.");
}

function draftIdOf(draft: Record<string, unknown>): string {
  return `dr-${createHash("sha256").update(JSON.stringify(draft), "utf8").digest("hex").slice(0, 16)}`;
}

function learnerOf(draft: Pick<DraftKey, "learner">): string | null {
  return draft.learner ?? null;
}

/** One file per source set and learner: `<source_set_id>.json` for no learner, `<source_set_id>.<learner>.json`. */
function fileNameOf(draft: Pick<DraftKey, "source_set_id" | "learner">): string {
  const learner = learnerOf(draft);
  return learner === null ? `${draft.source_set_id}.json` : `${draft.source_set_id}.${learner}.json`;
}

/** The record in `dir/name`, or null when it does not read as one, or sits under another name. */
async function recordIn(dir: string, name: string): Promise<KeptDraft | null> {
  if (!name.endsWith(".json")) return null;
  try {
    const parsed = KeptDraftSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
    return parsed.success && name === fileNameOf(parsed.data) ? parsed.data : null;
  } catch { return null; }
}

/** The records of the library at `nowMs`; those past their expiry are removed (minor 3 of the review). An
 * unreadable file is never offered. */
async function readRecords(libraryRoot: string, nowMs: number): Promise<Array<{ file: string; record: KeptDraft }>> {
  const dir = join(libraryRoot, DRAFTS_DIR);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const records: Array<{ file: string; record: KeptDraft }> = [];
  let removed = false;
  for (const name of names.sort()) {
    const record = await recordIn(dir, name);
    if (record === null) continue;
    if (expired(record.saved_at, nowMs)) {
      await rm(join(dir, name), { force: true });
      removed = true;
    } else records.push({ file: join(dir, name), record });
  }
  if (removed) await removeIfEmpty(dir);
  return records;
}

/** Remove the records `drop` names and those past their expiry; then the folder, once empty. */
async function removeRecords(libraryRoot: string, drop: (record: KeptDraft) => boolean, nowMs: number): Promise<void> {
  for (const { file, record } of await readRecords(libraryRoot, nowMs)) {
    if (drop(record)) await rm(file, { force: true });
  }
  await removeIfEmpty(join(libraryRoot, DRAFTS_DIR));
}

async function removeIfEmpty(dir: string): Promise<void> {
  try { await rmdir(dir); } catch { /* absent or not empty */ }
}

async function writeRecord(libraryRoot: string, record: KeptDraft): Promise<void> {
  const dir = join(libraryRoot, DRAFTS_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, fileNameOf(record));
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function expired(savedAt: string, nowMs: number): boolean {
  const at = Date.parse(savedAt);
  return !Number.isFinite(at) || at < nowMs - UNFINISHED_BUILD_DAYS * DAY_MS;
}

function sameSources(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
