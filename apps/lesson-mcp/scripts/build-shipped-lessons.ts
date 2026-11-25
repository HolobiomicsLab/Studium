// apps/lesson-mcp/scripts/build-shipped-lessons.ts
//
// Build « Discover Studium » / « Découvrir Studium », the demo lesson shipped with the VS Code extension
// and the npm package (apps/lesson-mcp/shipped-lessons/), through the authoring route an assistant uses:
// prepare_sources over Studium's own documentation pages, then create_lesson over the draft. The library
// functions are the ones the MCP tools call (packages/lesson-session-host/src/authoring-draft), so the
// quotes are checked character for character, the linter runs, and the lesson records the truth: a
// self-study lesson drafted by an AI agent, validated by nobody.
//
//   pnpm --filter @studium/lesson-mcp exec tsx scripts/build-shipped-lessons.ts [--now 2026-11-25T12:00:00Z]
//
// Inputs, in shipped-lessons-src/discover-studium/: sources.json (the pages, their URL and licence) and
// draft.<lang>.json (the LessonDraft). A quote's passage_id may be written `doc:<key>`: it is replaced by
// the id of the one passage of that page holding the quote, so the draft survives a renumbering of the
// passages; create_lesson then checks the quote itself. Outputs: shipped-lessons/discover-studium-<lang>/
// lesson.json and shipped-lessons-src/discover-studium/source-set.<lang>.json (what the lesson may cite,
// named by the lesson's source_plan_id). Nothing is written under ~/.studium: the library is a temporary
// folder.
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLesson, prepareSources } from "@studium/lesson-session-host";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");
const INPUTS = join(APP, "shipped-lessons-src", "discover-studium");
const OUTPUTS = join(APP, "shipped-lessons");
const LANGUAGES = ["en", "fr"] as const;

type SourceInput = Parameters<typeof prepareSources>[1][number];

/** The comparison form create_lesson uses for a quote (authoring-draft/quotes.ts normalizeQuoteText). */
const normalizeQuoteText = (text: string) => text.normalize("NFC").replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();

interface SourceEntry { key: string; path: string; title: string; url: string; license: string }
interface Inputs { goal: Record<string, string>; sources: Record<string, SourceEntry[]> }

function nowFromArgs(argv: readonly string[]): Date {
  const at = argv.indexOf("--now");
  if (at < 0) return new Date();
  const value = new Date(argv[at + 1] ?? "");
  if (Number.isNaN(value.getTime())) throw new Error("--now takes an ISO date, for example 2026-11-25T12:00:00Z");
  return value;
}

/** Replace each `doc:<key>` passage_id with the id of the one passage of that page holding the quote. */
interface DraftQuotes { scenes: Array<{ quotes?: Array<{ passage_id: string; text: string }> }> }

function resolveQuotes(draft: DraftQuotes, passages: ReadonlyArray<{ id: string; source_id: string; text: string }>, sourceIds: Map<string, string>): void {
  for (const [index, scene] of draft.scenes.entries()) {
    for (const quote of scene.quotes ?? []) {
      if (typeof quote.passage_id !== "string" || !quote.passage_id.startsWith("doc:")) continue;
      const key = quote.passage_id.slice(4);
      const sourceId = sourceIds.get(key);
      if (!sourceId) throw new Error(`scenes.${index}: no source ${key} in sources.json`);
      const wanted = normalizeQuoteText(quote.text);
      const holding = passages.filter((p) => p.source_id === sourceId && normalizeQuoteText(p.text).includes(wanted));
      if (holding.length !== 1) {
        throw new Error(`scenes.${index}: ${holding.length} passages of ${key} hold « ${quote.text.slice(0, 60)}… »`);
      }
      quote.passage_id = holding[0]!.id;
    }
  }
}

async function build(language: (typeof LANGUAGES)[number], inputs: Inputs, now: Date): Promise<void> {
  const library = await mkdtemp(join(tmpdir(), "studium-shipped-"));
  try {
    const entries = inputs.sources[language] ?? [];
    const sources: SourceInput[] = await Promise.all(entries.map(async (entry) => ({
      title: entry.title, url: entry.url, license: entry.license, text: await readFile(join(REPO, entry.path), "utf8"),
    })));
    const set = await prepareSources(library, sources, { goal: inputs.goal[language], language });
    const sourceIds = new Map(entries.map((entry, i) => [entry.key, set.sources[i]!.source_id]));
    const draft = JSON.parse(await readFile(join(INPUTS, `draft.${language}.json`), "utf8")) as DraftQuotes;
    resolveQuotes(draft, set.passages, sourceIds);
    const courseId = `discover-studium-${language}`;
    const result = await createLesson(library, { source_set_id: set.source_set_id, draft, course_id: courseId }, { now: () => now });
    if (!result.ok) {
      process.stderr.write(`${courseId}: create_lesson refused the draft\n${JSON.stringify(result.errors, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    await copyFile(result.lesson_path, join(OUTPUTS, courseId, "lesson.json"));
    await copyFile(join(library, "_sources", `${set.source_set_id}.json`), join(INPUTS, `source-set.${language}.json`));
    const findings = result.findings.map((f) => `  ${f.level} ${f.code}: ${f.message}`).join("\n");
    process.stdout.write(`${courseId}: ${result.bundle.scenes.length} scenes, ${result.bundle.metadata.duration_minutes} min, ` +
      `source set ${set.source_set_id} (${set.passages.length} passages)\n  key classes ${JSON.stringify(result.key_classes)}\n${findings}\n`);
  } finally {
    await rm(library, { recursive: true, force: true });
  }
}

const inputs = JSON.parse(await readFile(join(INPUTS, "sources.json"), "utf8")) as Inputs;
const now = nowFromArgs(process.argv.slice(2));
for (const language of LANGUAGES) await build(language, inputs, now);
