// packages/lesson-session-host/src/authoring-draft/draft-store.ts
//
// D4 (waiting review 2026-11-25, owner's decision 3): what Studium keeps of a lesson build that did not
// finish, one file per source set, `<library>/_drafts/<source_set_id>.json`.
//
// - create_lesson keeps a draft it refused for what the draft says (build.ts), with its errors, so that
//   the assistant resends only the faulty scenes (draft_id); a refusal that is not about the draft (a
//   lesson already there, an unknown source set) keeps nothing. Any lesson written from the same sources
//   deletes it. The kept draft holds the draft's keys, as lesson.json does, but never what the learner
//   already knows or what interests them (learner_profile.prior and .interests are dropped).
// - get_study_plan offers to finish a build that stopped (unfinishedBuilds): a kept draft, or sources
//   prepared with no lesson written from them (a build that stopped before its draft reached Studium).
//   Sources are matched by their sha256, since every preparation of the same file makes a new source
//   set. A build is not offered while it may still be running (BUILD_GRACE_MINUTES), after
//   UNFINISHED_BUILD_DAYS, nor once the learner discarded it (discardBuild) until its sources are
//   prepared again. forgetLearner erases the folder (eraseDrafts).
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BundleIssue } from "@studium/lesson-bundle-schema";
import { DEFAULT_LICENSE, readSourceSet, SOURCE_SET_ID_PATTERN, SOURCES_DIR, type SourceSet } from "./source-set.js";

/** The library folder of kept drafts. A course id cannot start with "_", so no course collides. */
export const DRAFTS_DIR = "_drafts";
export const DRAFT_ID_PATTERN = /^dr-[0-9a-f]{16}$/;
/** How long an unfinished build is offered, and a kept draft kept. */
export const UNFINISHED_BUILD_DAYS = 14;
/** A build left less than this long ago may still be running (writing a lesson takes minutes). */
export const BUILD_GRACE_MINUTES = 30;
const RECORD_SCHEMA = "studium-draft/1";
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** What a refusal asks the assistant to send again: only the scenes it names, or the whole draft. */
export type Resend = "scenes" | "draft";

const IssueSchema = z.object({ path: z.string(), message: z.string(), hint: z.string() });
const KeptDraftSchema = z.object({
  schema: z.literal(RECORD_SCHEMA),
  kind: z.literal("draft"),
  source_set_id: z.string().regex(SOURCE_SET_ID_PATTERN),
  draft_id: z.string().regex(DRAFT_ID_PATTERN),
  saved_at: z.string(),
  /** The sha256 of each source of the set, sorted: what another preparation of the same sources shares. */
  sources: z.array(z.string()),
  course_id: z.string().optional(),
  resend: z.enum(["scenes", "draft"]),
  fix_scenes: z.array(z.number().int().nonnegative()),
  draft: z.record(z.string(), z.unknown()),
  errors: z.array(IssueSchema),
});
const DismissalSchema = z.object({
  schema: z.literal(RECORD_SCHEMA),
  kind: z.literal("dismissed"),
  source_set_id: z.string().regex(SOURCE_SET_ID_PATTERN),
  saved_at: z.string(),
  sources: z.array(z.string()),
});
const RecordSchema = z.discriminatedUnion("kind", [KeptDraftSchema, DismissalSchema]);
export type KeptDraft = z.infer<typeof KeptDraftSchema>;
type DraftRecord = z.infer<typeof RecordSchema>;

/** The kept draft as get_study_plan shows it: no key, only what rewriting a scene needs. */
export interface KeptDraftOutline {
  title: string;
  concepts: Array<{ id: string; label: string }>;
  scenes: Array<{ at: number; type: string; title: string; concepts: string[] }>;
}

/** A lesson build that stopped, as get_study_plan offers to finish it. */
export interface UnfinishedBuild {
  source_set_id: string;
  /** The kept draft to fix scene by scene (create_lesson {source_set_id, draft_id, scenes}); null when the
   * whole draft must be written: none reached Studium, or its errors concern more than scenes. */
  draft_id: string | null;
  /** What the last refusal asked to send again; null when no draft reached Studium. */
  resend: Resend | null;
  /** The scenes to send again (their index in the draft), when resend is "scenes". */
  fix_scenes: number[];
  /** The titles of the sources the lesson is built from. */
  sources: string[];
  /** When the build was last worked on (ISO). */
  left_at: string;
  /** The kept draft without its keys, or null. */
  outline: KeptDraftOutline | null;
  /** The prepare_sources arguments that give the same passages and source set again, when every source
   * is a file; null when a source was passed as text (the assistant fetches it again). */
  prepare_sources: { sources: Array<Record<string, string>>; goal?: string; language?: string } | null;
}

/** The sorted sha256 of the sources of `set`: equal for every preparation of the same texts. */
export function sourcesKey(set: SourceSet): string[] {
  return set.sources.map((source) => source.sha256).sort();
}

/** Keep `draft` for `set`, refused with `errors`: the draft without what the learner knows or likes,
 * with the id of exactly those contents. Replaces what was kept for the same sources. */
export async function keepDraft(
  libraryRoot: string, set: SourceSet,
  refused: { draft: Record<string, unknown>; errors: BundleIssue[]; resend: Resend; fix_scenes: number[]; course_id?: string | undefined },
  now: Date,
): Promise<KeptDraft> {
  const draft = withoutPersonalProfile(refused.draft);
  const record: KeptDraft = {
    schema: RECORD_SCHEMA, kind: "draft", source_set_id: set.source_set_id, draft_id: draftIdOf(draft),
    saved_at: now.toISOString(), sources: sourcesKey(set),
    ...(refused.course_id === undefined ? {} : { course_id: refused.course_id }),
    resend: refused.resend, fix_scenes: refused.fix_scenes, draft, errors: refused.errors,
  };
  await removeRecords(libraryRoot, (other) => sameSources(other.sources, record.sources), now.getTime());
  await writeRecord(libraryRoot, record);
  return record;
}

/** The kept draft `draftId` over the sources of `set` (this set, or another preparation of the same
 * sources), or why there is none: the id of the draft kept for them now, if any. */
export async function findKeptDraft(
  libraryRoot: string, set: SourceSet, draftId: string, nowMs: number,
): Promise<{ draft: KeptDraft } | { draft: null; latest: string | null }> {
  const key = sourcesKey(set);
  const kept = (await readRecords(libraryRoot))
    .flatMap(({ record }) => (record.kind === "draft" && sameSources(record.sources, key) && !expired(record.saved_at, nowMs) ? [record] : []))
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  const draft = kept.find((record) => record.draft_id === draftId);
  return draft ? { draft } : { draft: null, latest: kept[0]?.draft_id ?? null };
}

/** After a lesson is written from `set`: nothing of a build from the same sources is unfinished. */
export async function clearDrafts(libraryRoot: string, set: SourceSet, now: Date): Promise<void> {
  const key = sourcesKey(set);
  await removeRecords(libraryRoot, (record) => record.source_set_id === set.source_set_id || sameSources(record.sources, key), now.getTime());
}

/** The learner does not want the build of `sourceSetId` finished: drop its kept draft, and offer no
 * build of the same sources prepared before now. Throws AuthoringInputError for an unknown source set. */
export async function discardBuild(libraryRoot: string, sourceSetId: string, now: Date): Promise<void> {
  const set = await readSourceSet(libraryRoot, sourceSetId);
  const key = sourcesKey(set);
  await removeRecords(libraryRoot, (record) => sameSources(record.sources, key), now.getTime());
  await writeRecord(libraryRoot, { schema: RECORD_SCHEMA, kind: "dismissed", source_set_id: set.source_set_id, saved_at: now.toISOString(), sources: key });
}

/** forgetLearner: erase every kept draft. Whether there was a folder to erase. */
export async function eraseDrafts(libraryRoot: string): Promise<boolean> {
  const dir = join(libraryRoot, DRAFTS_DIR);
  try { await stat(dir); } catch { return false; }
  await rm(dir, { recursive: true, force: true });
  return true;
}

/** The builds to offer at `nowMs`, the most recent first, one per set of sources. */
export async function unfinishedBuilds(libraryRoot: string, nowMs: number): Promise<UnfinishedBuild[]> {
  const offered = (ms: number) => ms >= nowMs - UNFINISHED_BUILD_DAYS * DAY_MS && ms <= nowMs - BUILD_GRACE_MINUTES * MINUTE_MS;
  const records = (await readRecords(libraryRoot)).map(({ record }) => record);
  const activity = new Map<string, number>();
  for (const [id, mtime] of await sourceSetTimes(libraryRoot)) activity.set(id, mtime);
  const drafts = new Map<string, KeptDraft>();
  for (const record of records) {
    if (record.kind !== "draft") continue;
    drafts.set(record.source_set_id, record);
    activity.set(record.source_set_id, Math.max(activity.get(record.source_set_id) ?? 0, Date.parse(record.saved_at)));
  }
  const sets = new SetReader(libraryRoot);
  const candidates: Array<{ set: SourceSet; key: string; at: number; draft: KeptDraft | undefined }> = [];
  for (const [id, at] of activity) {
    if (!offered(at)) continue;
    const set = await sets.read(id);
    if (set) candidates.push({ set, key: sourcesKey(set).join(","), at, draft: drafts.get(id) });
  }
  if (candidates.length === 0) return [];
  const built = await builtSourceKeys(libraryRoot, sets);
  const dismissed = records.filter((record) => record.kind === "dismissed");
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (built.has(candidate.key)) continue;
    if (dismissed.some((record) => record.sources.join(",") === candidate.key && Date.parse(record.saved_at) >= candidate.at)) continue;
    groups.set(candidate.key, [...(groups.get(candidate.key) ?? []), candidate]);
  }
  return [...groups.values()].map((group) => {
    const byTime = [...group].sort((a, b) => b.at - a.at);
    // A kept draft is what is left of the work: offer it rather than a later preparation of the same sources.
    const chosen = byTime.find((candidate) => candidate.draft) ?? byTime[0]!;
    return { ...buildOf(chosen.set, chosen.draft), left_at: new Date(byTime[0]!.at).toISOString(), at: byTime[0]!.at };
  }).sort((a, b) => b.at - a.at).map(({ at: _at, ...build }) => build);
}

function buildOf(set: SourceSet, draft: KeptDraft | undefined): Omit<UnfinishedBuild, "left_at"> {
  return {
    source_set_id: set.source_set_id,
    draft_id: draft?.resend === "scenes" ? draft.draft_id : null,
    resend: draft?.resend ?? null,
    fix_scenes: draft?.resend === "scenes" ? draft.fix_scenes : [],
    sources: set.sources.map((source) => source.title),
    outline: draft ? outlineOf(draft.draft) : null,
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

/** The draft as kept: what the learner already knows and what interests them stay out of it, as they
 * stay out of lesson.json. An emptied profile stays an (empty) profile, so the build gives the same
 * advice on the opening diagnostic. */
function withoutPersonalProfile(draft: Record<string, unknown>): Record<string, unknown> {
  const profile = draft["learner_profile"];
  if (!isRecord(profile)) return draft;
  const { prior: _prior, interests: _interests, ...kept } = profile;
  return { ...draft, learner_profile: kept };
}

function draftIdOf(draft: Record<string, unknown>): string {
  return `dr-${createHash("sha256").update(JSON.stringify(draft), "utf8").digest("hex").slice(0, 16)}`;
}

/** The sha256 keys of the sources every lesson of the library was written from (its source_plan_id). */
async function builtSourceKeys(libraryRoot: string, sets: SetReader): Promise<Set<string>> {
  const keys = new Set<string>();
  let entries;
  try { entries = await readdir(libraryRoot, { withFileTypes: true }); } catch { return keys; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    let planId: unknown;
    try { planId = (JSON.parse(await readFile(join(libraryRoot, entry.name, "lesson.json"), "utf8")) as Record<string, unknown>)["source_plan_id"]; }
    catch { continue; }
    if (typeof planId !== "string" || !SOURCE_SET_ID_PATTERN.test(planId)) continue;
    const set = await sets.read(planId);
    if (set) keys.add(sourcesKey(set).join(","));
  }
  return keys;
}

/** Each source set file of the library and when it was last written (a new preparation rewrites it). */
async function sourceSetTimes(libraryRoot: string): Promise<Array<[string, number]>> {
  const dir = join(libraryRoot, SOURCES_DIR);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const times: Array<[string, number]> = [];
  for (const name of names) {
    const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
    if (!SOURCE_SET_ID_PATTERN.test(id)) continue;
    try { times.push([id, (await stat(join(dir, name))).mtimeMs]); } catch { /* gone meanwhile */ }
  }
  return times;
}

/** Source sets read once each; an unreadable one is none. */
class SetReader {
  private readonly cache = new Map<string, SourceSet | null>();
  constructor(private readonly libraryRoot: string) {}
  async read(id: string): Promise<SourceSet | null> {
    if (!this.cache.has(id)) this.cache.set(id, await readSourceSet(this.libraryRoot, id).catch(() => null));
    return this.cache.get(id) ?? null;
  }
}

async function readRecords(libraryRoot: string): Promise<Array<{ file: string; record: DraftRecord }>> {
  const dir = join(libraryRoot, DRAFTS_DIR);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const records: Array<{ file: string; record: DraftRecord }> = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".json")).sort()) {
    try {
      const parsed = RecordSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
      if (parsed.success && name === `${parsed.data.source_set_id}.json`) records.push({ file: join(dir, name), record: parsed.data });
    } catch { /* unreadable: never offered */ }
  }
  return records;
}

/** Remove the records `drop` names and those past their expiry; then the folder, once empty. */
async function removeRecords(libraryRoot: string, drop: (record: DraftRecord) => boolean, nowMs: number): Promise<void> {
  for (const { file, record } of await readRecords(libraryRoot)) {
    if (drop(record) || expired(record.saved_at, nowMs)) await rm(file, { force: true });
  }
  try { await rmdir(join(libraryRoot, DRAFTS_DIR)); } catch { /* absent or not empty */ }
}

async function writeRecord(libraryRoot: string, record: DraftRecord): Promise<void> {
  const dir = join(libraryRoot, DRAFTS_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${record.source_set_id}.json`);
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
