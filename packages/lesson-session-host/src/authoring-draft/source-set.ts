// packages/lesson-session-host/src/authoring-draft/source-set.ts
//
// prepare_sources (contract C1): the texts a harness fetched for the learner become a stored
// source set — passages with stable ids `p:<source>:<n>`, a sha256 of each text, its title, URL and
// licence — in `<library>/_sources/<source_set_id>.json`. create_lesson later checks every quote of a
// draft against these passages, so the set is what the lesson may cite and nothing else.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BundleIssue } from "@studium/lesson-bundle-schema";
import { chunkText, DEFAULT_MAX_CHARS, DEFAULT_MIN_CHARS } from "./passages.js";
import { asciiSlug } from "./slug.js";

export const SOURCE_SET_SCHEMA = "studium-source-set/1";
/** The library folder holding source sets. A course id cannot start with "_", so no course collides. */
export const SOURCES_DIR = "_sources";
export const SOURCE_SET_ID_PATTERN = /^ss-[0-9a-f]{16}$/;
export const DEFAULT_LICENSE = "unknown";
/** Bounds of one preparation: enough for a few chapters, small enough to answer in one tool result.
 * prepare_sources returns every passage in that one result, so the binding bound is the total text of
 * the call (a harness's context is the limit, not the disk); one source may use all of it. */
export const MAX_SOURCES = 20;
export const MAX_TOTAL_SOURCE_CHARS = 200_000;
export const MAX_SOURCE_CHARS = MAX_TOTAL_SOURCE_CHARS;
const MAX_TITLE_CHARS = 300;
const MAX_LICENSE_CHARS = 100;
const MAX_GOAL_CHARS = 1000;
const MAX_SLUG_CHARS = 40;
const FALLBACK_SLUG = "source";

/** A refusal of the caller's input, as readable issues ({path, message, hint}). */
export class AuthoringInputError extends Error {
  constructor(readonly issues: BundleIssue[]) {
    super(issues.map((issue) => `${issue.path || "input"}: ${issue.message}`).join("; "));
    this.name = "AuthoringInputError";
  }
}

/** What a source is. A `conversation` is an excerpt of an exchange with an AI assistant: the lesson
 * built on it says so, because what an assistant asserted there is not a checked reference. */
export const SOURCE_KINDS = ["document", "conversation"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** One text the harness fetched, as prepare_sources receives it. */
export interface SourceInput {
  title: string;
  text: string;
  url?: string | undefined;
  license?: string | undefined;
  /** Absent means a document. */
  kind?: SourceKind | undefined;
}

const PassageSchema = z.object({ id: z.string(), source_id: z.string(), text: z.string() });
const SourceRecordSchema = z.object({
  source_id: z.string(), title: z.string(), url: z.string().nullable(), license: z.string(),
  sha256: z.string(), chars: z.number().int(), passages: z.number().int(),
  // Recorded only for a conversation, so the sets prepared before the field keep their id.
  kind: z.literal("conversation").optional(),
});
const SourceSetSchema = z.object({
  schema: z.literal(SOURCE_SET_SCHEMA),
  source_set_id: z.string().regex(SOURCE_SET_ID_PATTERN),
  goal: z.string().nullable(),
  language: z.string().nullable(),
  min_chars: z.number().int(),
  max_chars: z.number().int(),
  sources: z.array(SourceRecordSchema),
  passages: z.array(PassageSchema),
  dropped_short: z.number().int(),
});
export type Passage = z.infer<typeof PassageSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SourceSet = z.infer<typeof SourceSetSchema>;

export interface PrepareOptions {
  goal?: string | undefined;
  language?: string | undefined;
  minChars?: number | undefined;
  maxChars?: number | undefined;
}

/**
 * Cut `sources` into passages and store the set under `libraryRoot`. The id is a digest of
 * everything the set records, so preparing the same texts with the same goal again gives the same
 * id (and rewrites the same file). Throws AuthoringInputError for an unusable input, e.g. a source
 * from which no passage of `minChars` survives.
 */
export async function prepareSources(libraryRoot: string, sources: SourceInput[], options: PrepareOptions): Promise<SourceSet> {
  const set = buildSourceSet(sources, options);
  const dir = join(libraryRoot, SOURCES_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${set.source_set_id}.json`);
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(set, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return set;
}

/** The source set `sourceSetId` of `libraryRoot`; the id is checked before any path is built. */
export async function readSourceSet(libraryRoot: string, sourceSetId: string): Promise<SourceSet> {
  if (!SOURCE_SET_ID_PATTERN.test(sourceSetId)) {
    throw new AuthoringInputError([{
      path: "source_set_id", message: `${JSON.stringify(sourceSetId)} is not a source set id`,
      hint: "pass the source_set_id that prepare_sources returned",
    }]);
  }
  let raw: string;
  try {
    raw = await readFile(join(libraryRoot, SOURCES_DIR, `${sourceSetId}.json`), "utf8");
  } catch {
    throw new AuthoringInputError([{
      path: "source_set_id", message: `no source set ${sourceSetId} in this library`,
      hint: "call prepare_sources again with the same texts",
    }]);
  }
  const parsed = SourceSetSchema.safeParse(parseJson(raw));
  if (!parsed.success || parsed.data.source_set_id !== sourceSetId) {
    throw new AuthoringInputError([{
      path: "source_set_id", message: `source set ${sourceSetId} is unreadable`,
      hint: "call prepare_sources again with the same texts",
    }]);
  }
  return parsed.data;
}

/** JSON.parse, with a damaged file read as no value (the schema then refuses it). */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function buildSourceSet(sources: SourceInput[], options: PrepareOptions): SourceSet {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  checkInput(sources, options, minChars, maxChars);
  const usedIds = new Set<string>();
  const records: SourceRecord[] = [];
  const passages: Passage[] = [];
  const issues: BundleIssue[] = [];
  let droppedShort = 0;
  sources.forEach((source, index) => {
    // Kept short: every passage id repeats it.
    const sourceId = uniqueSlug(asciiSlug(source.title, MAX_SLUG_CHARS, FALLBACK_SLUG), usedIds);
    const chunked = chunkText(source.text, minChars, maxChars);
    if (chunked.passages.length === 0) {
      issues.push({
        path: `sources.${index}.text`, message: `no passage of at least ${minChars} characters`,
        hint: "pass the full text of the source (the harness fetches it), not a title or a summary",
      });
      return;
    }
    droppedShort += chunked.dropped_short;
    chunked.passages.forEach((text, number) => passages.push({ id: `p:${sourceId}:${number + 1}`, source_id: sourceId, text }));
    records.push({
      source_id: sourceId, title: source.title.trim(), url: source.url ?? null,
      license: source.license?.trim() || DEFAULT_LICENSE, sha256: sha256(source.text), chars: source.text.length,
      passages: chunked.passages.length,
      ...(source.kind === "conversation" ? { kind: "conversation" as const } : {}),
    });
  });
  if (issues.length > 0) throw new AuthoringInputError(issues);
  const recorded = {
    goal: options.goal?.trim() || null, language: options.language?.trim() || null,
    min_chars: minChars, max_chars: maxChars, sources: records,
  };
  // The digest covers what is recorded about each text (its sha256, not the text itself).
  const sourceSetId = `ss-${sha256(JSON.stringify(recorded)).slice(0, 16)}`;
  return { schema: SOURCE_SET_SCHEMA, source_set_id: sourceSetId, ...recorded, passages, dropped_short: droppedShort };
}

function checkInput(sources: SourceInput[], options: PrepareOptions, minChars: number, maxChars: number): void {
  const issues: BundleIssue[] = [];
  if (sources.length === 0 || sources.length > MAX_SOURCES) {
    issues.push({ path: "sources", message: `needs 1 to ${MAX_SOURCES} sources, has ${sources.length}`, hint: "prefer one coherent source over many" });
  }
  sources.forEach((source, index) => {
    if (!source.title.trim() || source.title.length > MAX_TITLE_CHARS) {
      issues.push({ path: `sources.${index}.title`, message: `needs 1 to ${MAX_TITLE_CHARS} characters`, hint: "give the source's own title" });
    }
    if (source.text.length > MAX_SOURCE_CHARS) {
      issues.push({ path: `sources.${index}.text`, message: `has ${source.text.length} characters, at most ${MAX_SOURCE_CHARS}`, hint: "pass the chapter or section the lesson is about" });
    }
    if (source.url !== undefined && !isHttpUrl(source.url)) {
      issues.push({ path: `sources.${index}.url`, message: "must be an http(s) URL", hint: "give the page the text was fetched from, or leave url out" });
    }
    if ((source.license ?? "").length > MAX_LICENSE_CHARS) {
      issues.push({ path: `sources.${index}.license`, message: `has more than ${MAX_LICENSE_CHARS} characters`, hint: "give a licence identifier such as CC-BY-4.0 or Public-Domain" });
    }
  });
  const total = sources.reduce((sum, source) => sum + source.text.length, 0);
  // A source over the cap is already named by its own path above; the total is reported otherwise.
  if (total > MAX_TOTAL_SOURCE_CHARS && sources.every((source) => source.text.length <= MAX_SOURCE_CHARS)) {
    issues.push({
      path: "sources", message: `have ${total} characters in all, at most ${MAX_TOTAL_SOURCE_CHARS} in one preparation`,
      hint: "pass only the chapters or sections the lesson is about: every passage comes back in this one tool result",
    });
  }
  if ((options.goal ?? "").length > MAX_GOAL_CHARS) {
    issues.push({ path: "goal", message: `has more than ${MAX_GOAL_CHARS} characters`, hint: "state the goal in one or two sentences" });
  }
  if (!(Number.isInteger(minChars) && Number.isInteger(maxChars) && minChars >= 1 && minChars <= maxChars)) {
    issues.push({ path: "min_chars", message: "must be an integer from 1 to max_chars", hint: `keep the defaults ${DEFAULT_MIN_CHARS} and ${DEFAULT_MAX_CHARS}` });
  }
  if (issues.length > 0) throw new AuthoringInputError(issues);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function uniqueSlug(base: string, used: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  used.add(candidate);
  return candidate;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
