// apps/lesson-mcp/src/teacher-tools.ts
//
// Teacher tools for the agent harness (sprint 2026-10-30, W7; gap T6; contract C1 teacher tools,
// C5 read side). Two read-only tools, registered by the lead in server.ts:
//
//   review_lesson {course_ref}  the plan of a draft WITHOUT its answer keys, who holds each key,
//                               the linter's verdict, remaining TODO placeholders, the approval
//                               record bound to the lesson's fingerprint.
//   class_report  {course_id}
//                               class-level aggregates per scene and per concept over consented
//                               telemetry, behind a k = 5 floor, never a learner identifier.
//
// What class_report bands and what it does not (lead decision I-8): learner counts are banded
// (`cohort_band`, for the whole run and for each row); per-row attempt counts (`n_attempts`,
// `n_measured`) are exact, so on a scene each learner answers once they equal that row's learner
// count. Inside one report the floor applies to the learners each figure is computed over (answering,
// graded, rated, timed, started: SEC-2), and a concept is rebuilt from the published figures of its
// published scenes only, so subtracting scene rows from a concept row isolates nobody (SEC-3).
// The floor bounds each report, not the difference between two: a report run before and after
// one more learner plays can be subtracted to recover that learner's figures. A live aggregate always
// allows this; it is a documented limit, not something this tool prevents.
//
// Why no answer key: these tools live on the same server a learner's harness talks to, so whatever
// review_lesson returns a learner could read. The key review stays on the file (or in the
// dashboard); this tool says what is in the lesson, never what the correct answers are.
//
// The class report is a TypeScript twin of the figures in tools/class_report.py, restricted to
// what a harness teacher needs and stricter where the two could disagree (see CLASS_REPORT_NOTES).
// A parity test in teacher-tools.test.ts runs both on one telemetry directory.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BundleSchemaError, loadBundleJson } from "@studium/lesson-session/node";
import {
  COURSE_ID_PATTERN, REDACTED_SCENE_FIELDS, SCENE_KEY_CLASS, authoringOf, buildReviewInbox, lintBundleData, placeholderPaths, publicScene,
  readApproval, readLastReceipt, type ApprovalStatus, type AuthoringBlock, type KeyClass, type ReviewInbox,
} from "@studium/lesson-session-host";

const execFileAsync = promisify(execFile);

export const TEACHER_TOOL_NAMES = ["class_report", "review_lesson"] as const;

/** The smallest cohort a class-level number may be computed over: the collector's MIN_LEARNERS
 * (services/analytics-collector/metrics.py). A restraint on singling out, not an anonymity guarantee. */
export const K_FLOOR = 5;

/** What the harness wires in. Nothing here is controllable by the model calling the tools. */
export interface TeacherToolsContext {
  /** Root holding the course directories (`<course_id>/lesson.json`). */
  bundlesRoot: string;
  /** The learner's library (<STUDIUM_HOME>/library), where create_lesson writes (L-12). A course is
   * looked up under bundlesRoot first, then here; absent, or a folder that does not exist, is skipped. */
  libraryRoot?: string | null;
  /** Root of durable learner data (`<pseudonym>/<bundle_id>/telemetry.jsonl`); null when ephemeral. */
  dataDir: string | null;
  /** Runs the bundle linter on one lesson.json. Defaults to the linter's core (lintBundleData), in process. */
  lint?: LintRunner;
  /** Run this copy of tools/bundle_lint.mjs in a subprocess instead of the in-process linter. */
  lintScript?: string;
  /**
   * Optional sub-folder of `dataDir` (relative or absolute, confined to it) to aggregate instead of the
   * whole folder. Server configuration only: it is deliberately NOT a tool argument, because a model
   * that could choose the folder could run the report on a cohort and on the whole folder and subtract
   * one result from the other, recovering the figures of the few learners left out (the k floor holds
   * for each call, not for their difference).
   */
  telemetryDir?: string;
  /** Server-side floor. Can raise the floor above K_FLOOR, never lower it. */
  minLearners?: number;
}

export interface LintFinding { level: "ERROR" | "WARN" | "INFO"; code: string; message: string }
export type LintRunner = (lessonJsonPath: string) => Promise<LintFinding[]>;

/** A refusal the model can act on (bad reference, missing data); its message is shown as is. */
export class TeacherToolError extends Error {}

// --- shared helpers ---------------------------------------------------------------------------

type Locale = "fr" | "en";
type Bundle = ReturnType<typeof loadBundleJson>;
type Scene = Bundle["scenes"][number];
type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const localeOf = (language: unknown): Locale =>
  typeof language === "string" && language.trim().slice(0, 2).toLowerCase() === "fr" ? "fr" : "en";

const MAX_LESSON_BYTES = 8 * 1024 * 1024;
const MAX_TELEMETRY_BYTES = 64 * 1024 * 1024;
const MAX_TELEMETRY_FILES = 5000;

/** `target` as a real path, refused when it (or a symlink on the way) leaves `root`. A target that
 * does not exist yet is returned lexically: the caller reports it as absent. */
async function insideRoot(root: string, target: string, what: string, ref: string): Promise<string> {
  const refuse = (): never => { throw new TeacherToolError(`${what} escapes its root: ${ref}`); };
  const within = (base: string, path: string): boolean => {
    const rel = relative(base, path);
    return !(rel.startsWith("..") || isAbsolute(rel));
  };
  // A target may already be a real path (/private/var/... for a /var root), so the lexical check
  // accepts either spelling of the root; the real-path check below is the one that binds.
  const realRoot = await realpath(root);
  if (!within(resolve(root), target) && !within(realRoot, target)) refuse();
  let real: string;
  try { real = await realpath(target); } catch { return target; }
  if (!within(realRoot, real)) refuse();
  return real;
}

/** Resolve `ref` under `root`, refusing `..`, absolute paths and symlinks that leave the root. */
const confine = (root: string, ref: string, what: string): Promise<string> =>
  insideRoot(root, resolve(root, ref), what, ref);

/** The roots a course is looked up in, in order: bundlesRoot, then the learner's library when it
 * exists and is another folder. */
function lessonRoots(ctx: TeacherToolsContext): string[] {
  const library = ctx.libraryRoot;
  return library && existsSync(library) && resolve(library) !== resolve(ctx.bundlesRoot)
    ? [ctx.bundlesRoot, library] : [ctx.bundlesRoot];
}

/** `ref` confined under the first root where it exists, or under bundlesRoot when it exists nowhere. */
async function findUnderRoots(ctx: TeacherToolsContext, ref: string, what: string): Promise<{ root: string; target: string }> {
  const roots = lessonRoots(ctx);
  for (const root of roots) {
    const target = await confine(root, ref, what);
    if (existsSync(target)) return { root, target };
  }
  return { root: roots[0]!, target: await confine(roots[0]!, ref, what) };
}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

function text(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function fail(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

// --- review_lesson ----------------------------------------------------------------------------

/** Where a course reference points: its lesson.json and, for a course folder, the approval record. */
async function locateLesson(ctx: TeacherToolsContext, courseRef: string): Promise<{ lessonJson: string; courseDir: string | null }> {
  if (/\.zip$/i.test(courseRef)) {
    throw new TeacherToolError("zip bundles cannot be reviewed here: point course_ref at the course folder holding lesson.json");
  }
  const { root, target } = await findUnderRoots(ctx, courseRef, "course_ref");
  let info;
  try { info = await stat(target); } catch { throw new TeacherToolError(`no such course: ${courseRef}`); }
  if (info.isDirectory()) {
    const lessonJson = join(target, "lesson.json");
    if (!existsSync(lessonJson)) throw new TeacherToolError(`no lesson.json in course folder: ${courseRef}`);
    return { lessonJson: await insideRoot(root, lessonJson, "course_ref", courseRef), courseDir: target };
  }
  if (!target.endsWith(".json")) throw new TeacherToolError(`course_ref must be a course folder or a .json bundle: ${courseRef}`);
  // Only a file named lesson.json sits in a course folder of its own; a flat bundle shares its folder.
  return { lessonJson: target, courseDir: target.endsWith(`${sep}lesson.json`) ? dirname(target) : null };
}

/** A dotted path's segments as a field path: `claims.0.flaws_expected.0` → `claims[0].flaws_expected[0]`. */
const fieldPath = (parts: string[]): string =>
  parts.reduce((path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : path === "" ? part : `${path}.${part}`), "");

/** `TODO` placeholders the Python author leaves in a draft, as `scene <id>: <field path>`. The rule is
 * the one `experience_packet.py approve` refuses on (PLACEHOLDER_PATTERN `^TODO\b|TODO:` on the
 * left-trimmed value, `todo-*` allowed in id / *_id / *_ids fields, quoted `evidence` never scanned),
 * through the linter's own implementation of it (tools/bundle_lint.mjs placeholderPaths), so the two
 * sides cannot disagree on whether a draft is finished. */
function findTodos(raw: unknown): { count: number; paths: string[]; perScene: Map<string, number> } {
  const scenes = isRecord(raw) && Array.isArray(raw["scenes"]) ? raw["scenes"] : [];
  const paths: string[] = [];
  const perScene = new Map<string, number>();
  for (const dotted of placeholderPaths(raw)) {
    const parts = dotted.split(".");
    if (parts[0] === "scenes" && parts.length > 2 && /^\d+$/.test(parts[1]!)) {
      const index = Number(parts[1]);
      const scene = scenes[index];
      const id = isRecord(scene) && typeof scene["id"] === "string" ? scene["id"] : `#${index}`;
      paths.push(`scene ${id}: ${fieldPath(parts.slice(2))}`);
      perScene.set(id, (perScene.get(id) ?? 0) + 1);
    } else paths.push(fieldPath(parts));
  }
  return { count: paths.length, paths: paths.slice(0, 50), perScene };
}

/** Every string that is part of an answer key or a reveal, to scrub from linter messages. */
function keyStrings(raw: unknown): string[] {
  const out = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") { if (value.length >= 4) out.add(value); }
    else if (Array.isArray(value)) value.forEach(collect);
    else if (isRecord(value)) Object.values(value).forEach(collect);
  };
  const scenes = isRecord(raw) && Array.isArray(raw["scenes"]) ? raw["scenes"] : [];
  for (const scene of scenes) {
    if (!isRecord(scene)) continue;
    for (const field of REDACTED_SCENE_FIELDS) collect(scene[field]);
    if (Array.isArray(scene["choices"])) {
      for (const c of scene["choices"]) if (isRecord(c) && c["correct"] === true) collect(c["text"]);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Linter messages can quote the key: the flaw keyword, a field excerpt, a parser snippet. Say where,
 * not what. A finding whose message quotes a field value is rebuilt from its location alone (SEC-6: an
 * excerpt cut at 60 characters, or JSON-escaped, never equals the key string it came from); every
 * other message is still scrubbed of key strings, raw and JSON-escaped. */
function sanitizeFinding(finding: LintFinding, keys: string[]): LintFinding {
  let message = finding.message;
  if (finding.code === "flaw_reveal_gap") {
    const scene = /^(.*?): flaw "/.exec(message)?.[1];
    message = `${scene ?? "a scene"}: a planted flaw (keyword withheld) is absent from model_correction`;
  }
  if (finding.code === "unfilled_placeholder") {
    const path = /^(.*?): unfilled placeholder\b/.exec(message)?.[1];
    message = `${path ?? "a field"}: unfilled placeholder`;
  }
  if (finding.code === "invalid_json") message = "lesson.json is not valid JSON";
  for (const key of keys) {
    message = message.split(key).join("[withheld]");
    const escaped = JSON.stringify(key).slice(1, -1);
    if (escaped !== key) message = message.split(escaped).join("[withheld]");
  }
  return { level: finding.level, code: finding.code, message };
}

/** tools/bundle_lint.mjs prints `LEVEL  name  code  message`, its fields separated by two spaces. */
const LINT_LINE = /^(ERROR|WARN|INFO) {2}(.+?) {2}(\S+) {2}(.*)$/;

/** Run tools/bundle_lint.mjs on one file and parse its `LEVEL  name  code  message` lines. */
function scriptLintRunner(script: string): LintRunner {
  return async (lessonJson) => {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(process.execPath, [script, lessonJson], { cwd: dirname(lessonJson), timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }));
    } catch (error) {
      // Exit code 1 means ERROR findings and still prints them; anything else printed nothing usable.
      stdout = (error as { stdout?: string }).stdout ?? "";
      if (!LINT_LINE.test(stdout.split("\n")[0] ?? "")) throw error;
    }
    const findings: LintFinding[] = [];
    for (const line of stdout.split("\n")) {
      const m = LINT_LINE.exec(line);
      if (m) findings.push({ level: m[1] as LintFinding["level"], code: m[3]!, message: m[4]! });
    }
    return findings;
  };
}

/** The default runner: the linter's own core (tools/bundle_lint.mjs lintBundleData, re-exported by
 * @studium/lesson-session-host), in process. It needs no script on disk and no file URL, so it runs
 * the same in a checkout and in the bundled CJS server, where `import.meta` is empty (CC-5, RT-1). */
const inProcessLintRunner: LintRunner = async (lessonJson) => {
  let bundle: unknown;
  try { bundle = JSON.parse(await readFile(lessonJson, "utf8")); }
  catch { return [{ level: "ERROR", code: "invalid_json", message: "lesson.json is not valid JSON" }]; }
  return lintBundleData(bundle, { bundleDir: dirname(lessonJson) }).findings;
};

export type LintSummary =
  | { status: "ok"; errors: number; warnings: number; infos: number; findings: LintFinding[] }
  | { status: "unavailable" | "failed"; reason: string; findings: LintFinding[] };

async function runLint(ctx: TeacherToolsContext, lessonJson: string, keys: string[]): Promise<LintSummary> {
  let runner = ctx.lint;
  if (!runner && ctx.lintScript !== undefined) {
    if (!existsSync(ctx.lintScript)) return { status: "unavailable", reason: "the configured bundle linter script was not found", findings: [] };
    runner = scriptLintRunner(ctx.lintScript);
  }
  runner ??= inProcessLintRunner;
  try {
    const findings = (await runner(lessonJson)).map((f) => sanitizeFinding(f, keys));
    const count = (level: LintFinding["level"]): number => findings.filter((f) => f.level === level).length;
    return { status: "ok", errors: count("ERROR"), warnings: count("WARN"), infos: count("INFO"), findings };
  } catch {
    return { status: "failed", reason: "the bundle linter did not complete", findings: [] };
  }
}

// C5, read side: the host's readApproval (`<course>/approval.json` bound to the sha256 of the exact
// lesson.json bytes), the same reader start_lesson_session uses.

/** First learner-facing string of a scene, read from the client-safe projection so a key field
 * can never be picked. */
const PROMPT_FIELDS = ["question", "prompt", "task", "topic", "scenario", "pre_question", "flawed_content", "source_content", "markdown"];
function promptExcerpt(scene: Scene): string | null {
  const view = publicScene(scene) as Json;
  for (const field of PROMPT_FIELDS) {
    const value = view[field];
    if (typeof value === "string" && value.trim() !== "") {
      const flat = value.replace(/\s+/g, " ").trim();
      return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
    }
  }
  return null;
}

export interface PlanScene {
  id: string; type: string; title: string; concept_refs: string[]; key_class: KeyClass | "unknown";
  prompt: string | null; choice_count?: number; keyed_item_count?: number; todo_count: number;
}

export interface LessonPlan {
  scenes: PlanScene[];
  concepts: Array<{ id: string; title: string; bloom_level_target: string }>;
}

function planOf(bundle: Bundle, todo: Map<string, number>): LessonPlan {
  const scenes = bundle.scenes.map((scene): PlanScene => {
    const src = scene as unknown as Json;
    const entry: PlanScene = {
      id: scene.id, type: scene.type, title: scene.title, concept_refs: scene.concept_refs,
      key_class: SCENE_KEY_CLASS[scene.type] ?? "unknown", prompt: promptExcerpt(scene), todo_count: todo.get(scene.id) ?? 0,
    };
    if (Array.isArray(src["choices"])) entry.choice_count = src["choices"].length;
    const keyed = Array.isArray(src["claims"]) ? src["claims"] : Array.isArray(src["key_points"]) ? src["key_points"] : null;
    if (keyed) entry.keyed_item_count = keyed.length;
    return entry;
  });
  return {
    scenes,
    concepts: bundle.concepts.map((c) => ({ id: c.id, title: c.title, bloom_level_target: c.bloom_level_target })),
  };
}

const REVIEW_NOTE = {
  en: "Answer keys, hints and reveals are not returned by this tool. Read lesson.json (or the dashboard review page) to check them before approving.",
  fr: "Les clés de réponse, indices et corrigés ne sont pas renvoyés par cet outil. Lisez lesson.json (ou la page de relecture du tableau de bord) pour les vérifier avant d'approuver.",
};

/** One schema problem of the reviewed lesson.json, as the bundle loader reports it (formatBundleError). */
export interface SchemaError { path: string; message: string; hint?: string }

/** The authoring block of review_lesson: who wrote the lesson and, under C5's name, its approval. The
 * learner notice is left out (null): this is the teacher's view. */
// Teacher review preserves the raw declaration (null when absent); learner authoring infers a drafter.
export type ReviewAuthoring = Omit<AuthoringBlock, "notice" | "drafted_by"> & { notice: null; drafted_by: string | null };

export interface ReviewLessonResult {
  ok: true;
  course_ref: string;
  bundle_id: string | null;
  title: string | null;
  language: string | null;
  validated_by: string | null;
  bundle_sha256: string;
  schema_valid: boolean;
  schema_errors: SchemaError[];
  authoring: ReviewAuthoring | null;
  plan: LessonPlan | null;
  key_classes: Record<KeyClass, string[]> | null;
  todo: { count: number; paths: string[] };
  lint: LintSummary;
  /** The same record as authoring.approval (C5), kept at the top level for existing readers. */
  approval: ApprovalStatus;
  ready_for_approval: boolean;
  note: string;
  /** INT-STUDIUM-058 § 2.9: one item per scene, sorted by consequence (blocks, grading, wording, media),
   * marked new / changed / unchanged against the last receipt in `<course>/reviews/`. A key-holding item
   * has no sha256 here (owner's option a): the fingerprint covers the keys, so a learner reading this
   * response could hash candidate answers and compare. The receipt on disk keeps every fingerprint. */
  inbox: ReviewInbox;
}

export async function reviewLesson(ctx: TeacherToolsContext, courseRef: string): Promise<ReviewLessonResult> {
  const { lessonJson, courseDir } = await locateLesson(ctx, courseRef);
  const info = await stat(lessonJson);
  if (info.size > MAX_LESSON_BYTES) throw new TeacherToolError("lesson.json is too large to review here");
  const bytes = await readFile(lessonJson);
  const bundleSha = sha256(bytes);

  let raw: unknown = null;
  let bundle: Bundle | null = null;
  const schemaErrors: SchemaError[] = [];
  try { raw = JSON.parse(bytes.toString("utf8")); } catch { schemaErrors.push({ path: "", message: "lesson.json is not valid JSON" }); }
  if (raw !== null) {
    try { bundle = loadBundleJson(raw); } catch (error) {
      // RT-7: the loader's readable issues (formatBundleError): path, message and what to change.
      if (!(error instanceof BundleSchemaError)) throw error;
      schemaErrors.push(...error.issues.slice(0, 20));
    }
  }

  const keys = keyStrings(raw);
  const todo = findTodos(raw);
  const lint = await runLint(ctx, lessonJson, keys);
  const approval = await readApproval(courseDir, bundleSha);
  const locale = localeOf(bundle?.metadata.language ?? (isRecord(raw) && isRecord(raw["metadata"]) ? raw["metadata"]["language"] : undefined));

  const keyClasses: Record<KeyClass, string[]> = { ungraded: [], author_keyed: [], production: [], externally_grounded: [] };
  let authoring: ReviewAuthoring | null = null;
  if (bundle) {
    for (const scene of bundle.scenes) keyClasses[SCENE_KEY_CLASS[scene.type]]?.push(scene.id);
    const drafted = isRecord(raw) && isRecord(raw["metadata"]) && isRecord(raw["metadata"]["authoring"])
      ? raw["metadata"]["authoring"]["drafted_by"] : undefined;
    // C5 / lead decision I-9: the approval read next to the lesson goes inside the authoring block.
    const { notice: _notice, ...block } = authoringOf(bundle, { judge: false, approval });
    authoring = { ...block, notice: null, drafted_by: typeof drafted === "string" ? drafted : null };
  }

  const lintClean = lint.status === "ok" && lint.errors === 0;
  const lastReceipt = await readLastReceipt(courseDir);
  const inbox = buildReviewInbox({
    rawScenes: isRecord(raw) ? raw["scenes"] : null,
    lintFindings: lint.status === "ok" ? lint.findings : null,
    todoPerScene: todo.perScene,
    schemaValid: bundle !== null,
    schemaErrors,
    lastReceipt: lastReceipt.receipt,
    unreadableReceipts: lastReceipt.unreadable,
  });
  return {
    ok: true as const,
    course_ref: courseRef,
    bundle_id: bundle?.bundle_id ?? null,
    title: bundle?.metadata.title ?? null,
    language: bundle?.metadata.language ?? null,
    validated_by: bundle?.validated_by ?? null,
    bundle_sha256: bundleSha,
    schema_valid: bundle !== null,
    schema_errors: schemaErrors,
    authoring,
    plan: bundle ? planOf(bundle, todo.perScene) : null,
    key_classes: bundle ? keyClasses : null,
    todo: { count: todo.count, paths: todo.paths },
    lint,
    approval,
    ready_for_approval: bundle !== null && todo.count === 0 && lintClean,
    note: REVIEW_NOTE[locale],
    inbox,
  };
}

// --- class_report -----------------------------------------------------------------------------

const BAND_EDGES = [10, 20];

/** The collector's `cohort_band`: the order of magnitude of a cohort, never its exact size. */
function cohortBand(size: number, floor: number): string {
  let lower = floor;
  for (const edge of BAND_EDGES) {
    if (size < edge) return `${lower}–${edge - 1}`;
    lower = Math.max(edge, floor);
  }
  return `${lower}+`;
}

const CLASS_REPORT_TEXT = {
  en: {
    non_attribution: "Class-level reading over the contributors this report names, not a statement about any student: it describes how a group worked, and nothing here narrows it to a person.",
    floor: (k: number) => `k-anonymity floor: a class report needs at least ${k} distinct learners in the lesson and this lesson has fewer. The size is withheld for the same reason.`,
    identity: "No cohort can be established: at least one telemetry event carries no learner_pseudonym or no lesson_id, so the population would be partly unknown. Nothing is published.",
    no_data: "No telemetry was found for this course. Telemetry is written only for learners who consented (STUDIUM_TELEMETRY_CONSENT) in a durable data folder; check the folder, or that anyone has played the lesson.",
    withheld: "At least one scene, concept or figure is not shown: too few learners contributed to it. How many were withheld is not stated.",
    not_included: ["trust calibration (use tools/class_report.py)", "per-learner anything (never produced)"],
  },
  fr: {
    non_attribution: "Lecture au niveau de la classe sur les contributeurs que ce rapport nomme, et non une affirmation sur un étudiant\u00a0: elle décrit comment un groupe a travaillé, rien ici ne la ramène à une personne.",
    floor: (k: number) => `Seuil d'anonymat\u00a0: un rapport de classe exige au moins ${k} apprenants distincts dans la leçon, et cette leçon en compte moins. L'effectif est tu pour la même raison.`,
    identity: "Aucune cohorte ne peut être établie\u00a0: au moins un événement de télémétrie n'a ni learner_pseudonym ni lesson_id, la population serait en partie inconnue. Rien n'est publié.",
    no_data: "Aucune télémétrie trouvée pour ce cours. Elle n'est écrite que pour les apprenants consentants (STUDIUM_TELEMETRY_CONSENT) dans un dossier de données durable\u202f; vérifiez le dossier, ou que quelqu'un a joué la leçon.",
    withheld: "Au moins une scène, un concept ou un chiffre n'est pas montré\u00a0: trop peu d'apprenants y ont contribué. Leur nombre n'est pas indiqué.",
    not_included: ["calibration de la confiance (utiliser tools/class_report.py)", "tout chiffre individuel (jamais produit)"],
  },
};

/** One scene's (or, rebuilt from published scenes, one concept's) answers, and for each figure the
 * learners it is computed over: the floor applies to that population, not to everyone who sent an
 * event (SEC-2: a scene where four learners only asked for a hint and one answered published that one
 * learner's figures). */
interface Acc {
  attempts: number; measured: number; correct: number;
  /** Quiz answers the learner rated (confidence present), their correct ones and their summed confidence. */
  ratedN: number; ratedCorrect: number; confSum: number; timeMs: number; timed: number;
  /** Learners who answered (any attempt), whose answer a key or a judge graded, who rated, who were timed. */
  attempting: Set<string>; measuredBy: Set<string>; ratedBy: Set<string>; timedBy: Set<string>;
  /** Learners who asked for a hint here. */
  hintedBy: Set<string>;
}
const newAcc = (): Acc => ({
  attempts: 0, measured: 0, correct: 0, ratedN: 0, ratedCorrect: 0, confSum: 0, timeMs: 0, timed: 0,
  attempting: new Set(), measuredBy: new Set(), ratedBy: new Set(), timedBy: new Set(), hintedBy: new Set(),
});

const round = (value: number, digits: number): number => { const f = 10 ** digits; return Math.round(value * f) / f; };
const countIn = (members: Set<string>, within: Set<string>): number => [...members].filter((m) => within.has(m)).length;

export interface Figures {
  /** The row's count of answering learners, banded. */
  cohort_band: string;
  /** Exact counts (lead decision I-8): on a scene each learner answers once, so these equal the row's
   * learner count; only learner counts are banded. */
  n_attempts: number;
  n_measured: number;
  /** Over graded answers, null unless at least `floor` learners were graded. */
  accuracy: number | null;
  /** Learners who asked for a hint over learners who answered: a share of people, within [0, 1]. */
  hint_reliance: number | null;
  /** Over rated quiz answers, null unless at least `floor` learners rated. */
  calibration_gap: number | null;
  /** Over timed answers, null unless at least `floor` learners were timed. */
  mean_time_s: number | null;
}

/** Each figure over its own population, withheld (null) under the floor; `withheld` says whether any
 * figure was held back for that reason (an empty population is "not measured", not withheld). */
function figures(acc: Acc, floor: number): { figures: Figures; withheld: boolean } {
  const reaches = (members: Set<string>): boolean => members.size >= floor;
  const short = (members: Set<string>): boolean => members.size > 0 && members.size < floor;
  return {
    figures: {
      cohort_band: cohortBand(acc.attempting.size, floor),
      n_attempts: acc.attempts,
      // `measured` = answers a key or a model judge graded. A keyword score nobody judged is not a
      // measure of understanding, so it counts as an attempt and never as accuracy.
      n_measured: acc.measured,
      accuracy: reaches(acc.measuredBy) ? round(acc.correct / acc.measured, 3) : null,
      hint_reliance: acc.attempting.size > 0 ? round(countIn(acc.hintedBy, acc.attempting) / acc.attempting.size, 3) : null,
      // + = over-confident; only quiz answers carry a self-rated confidence, and only the rated ones
      // count (lead decision I-5: an answer the learner did not rate has no confidence, not 0).
      calibration_gap: reaches(acc.ratedBy) ? round(acc.confSum / acc.ratedN - acc.ratedCorrect / acc.ratedN, 3) : null,
      mean_time_s: reaches(acc.timedBy) ? round(acc.timeMs / acc.timed / 1000, 1) : null,
    },
    withheld: short(acc.measuredBy) || short(acc.ratedBy) || short(acc.timedBy),
  };
}

/** Add a published scene to its concept, figure by figure: a part enters the concept only when the scene
 * published that figure, so the concept row minus the scene rows recovers nothing the floor withheld
 * (SEC-3). */
function addPublished(concept: Acc, scene: Acc, published: Figures): void {
  concept.attempts += scene.attempts;
  for (const m of scene.attempting) concept.attempting.add(m);
  for (const m of scene.hintedBy) if (scene.attempting.has(m)) concept.hintedBy.add(m);
  if (published.accuracy !== null) {
    concept.measured += scene.measured; concept.correct += scene.correct;
    for (const m of scene.measuredBy) concept.measuredBy.add(m);
  }
  if (published.calibration_gap !== null) {
    concept.ratedN += scene.ratedN; concept.ratedCorrect += scene.ratedCorrect; concept.confSum += scene.confSum;
    for (const m of scene.ratedBy) concept.ratedBy.add(m);
  }
  if (published.mean_time_s !== null) {
    concept.timeMs += scene.timeMs; concept.timed += scene.timed;
    for (const m of scene.timedBy) concept.timedBy.add(m);
  }
}

/** Same on-disk segment as deps.ts `durableScopeDir`: a bundle_id is one sanitized path segment. */
const bundleSegment = (bundleId: string): string => bundleId.replace(/[^A-Za-z0-9_.-]/g, "_");

/** telemetry.jsonl files whose folder is `segment`, found without following symlinks. */
async function findStreams(root: string, segment: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= MAX_TELEMETRY_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) await visit(full, depth + 1);
      else if (entry.isFile() && entry.name === "telemetry.jsonl" && dirname(full).endsWith(`${sep}${segment}`)) found.push(full);
    }
  };
  await visit(root, 0);
  return found.sort();
}

export type SceneRow = { scene_id: string; title: string | null; type: string | null; concept: string } & Figures;
export type ConceptRow = { concept: string; title: string | null } & Figures;

export interface DataFolder { label: string; fingerprint: string }

export type ClassReportResult =
  | { status: "suppressed"; min_learners: number; has_data: true; reason: string }
  | { status: "no_data"; min_learners: number; has_data: false; reason: string }
  | {
    status: "ok"; course_id: string; bundle_id: string; min_learners: number;
    /** Which folder was aggregated, without its path: the folder's name (and the configured sub-folder
     * under it, when there is one) and the first 8 hex of the sha256 of its real path, to tell two
     * folders of the same name apart (RT-5). */
    data_folder: DataFolder;
    /** The whole run's learner count, banded. */
    cohort_band: string;
    /** Completed over started, null unless at least `min_learners` learners started. */
    completion_rate: number | null;
    scenes: SceneRow[];
    concepts: ConceptRow[];
    withheld_below_floor: boolean;
    reteach_priority: string[];
    not_included: string[];
    non_attribution: string;
    note?: string;
  };

export async function classReport(ctx: TeacherToolsContext, courseId: string): Promise<ClassReportResult> {
  if (!COURSE_ID_PATTERN.test(courseId)) throw new TeacherToolError(`invalid course_id: ${courseId}`);
  const lessonPath = (await findUnderRoots(ctx, join(courseId, "lesson.json"), "course_id")).target;
  if (!existsSync(lessonPath)) throw new TeacherToolError(`unknown course: ${courseId}`);
  if ((await stat(lessonPath)).size > MAX_LESSON_BYTES) throw new TeacherToolError("lesson.json is too large to read here");
  let bundle: Bundle;
  try { bundle = loadBundleJson(JSON.parse(await readFile(lessonPath, "utf8"))); }
  catch { throw new TeacherToolError(`course ${courseId} has no valid lesson.json: run review_lesson`); }

  if (ctx.dataDir === null) {
    throw new TeacherToolError("no durable data folder is configured on this server (STUDIUM_DATA_DIR / STUDIUM_HOME), so no class telemetry exists");
  }
  const root = await confine(ctx.dataDir, ctx.telemetryDir ?? ".", "telemetry_dir");
  if (!existsSync(root) || !(await stat(root)).isDirectory()) throw new TeacherToolError("the configured telemetry folder is not a folder inside the data folder");

  const floor = Math.max(K_FLOOR, ctx.minLearners ?? K_FLOOR);
  const locale = localeOf(bundle.metadata.language);
  const T = CLASS_REPORT_TEXT[locale];
  const sceneInfo = new Map(bundle.scenes.map((s) => [s.id, s]));
  const conceptTitle = new Map(bundle.concepts.map((c) => [c.id, c.title]));
  const conceptOf = (sceneId: string): string => sceneInfo.get(sceneId)?.concept_refs[0] ?? sceneId;

  const scenes = new Map<string, Acc>();
  const learners = new Set<string>();
  const startedBy = new Set<string>();
  let started = 0;
  let completed = 0;
  let unknownIdentity = false;
  let totalBytes = 0;

  for (const file of await findStreams(root, bundleSegment(bundle.bundle_id))) {
    totalBytes += (await stat(file)).size;
    if (totalBytes > MAX_TELEMETRY_BYTES) throw new TeacherToolError("telemetry is too large to aggregate here: use tools/class_report.py");
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (line.trim() === "") continue;
      let e: unknown;
      try { e = JSON.parse(line); } catch { continue; } // a torn line is not an event
      if (!isRecord(e)) continue;
      const pseudonym = e["learner_pseudonym"];
      const lesson = e["lesson_id"];
      if (typeof pseudonym !== "string" || pseudonym === "" || typeof lesson !== "string" || lesson === "") { unknownIdentity = true; continue; }
      if (lesson !== bundle.bundle_id) continue; // another lesson's event: not this class
      learners.add(pseudonym);
      const type = e["type"];
      if (type === "lesson_started") { started += 1; startedBy.add(pseudonym); continue; }
      if (type === "lesson_completed") { completed += 1; continue; }
      if (type !== "quiz_answered" && type !== "critique_submitted" && type !== "hint_requested") continue;
      const sceneId = typeof e["scene_id"] === "string" ? e["scene_id"] : "";
      if (sceneId === "") continue;
      const acc = scenes.get(sceneId) ?? scenes.set(sceneId, newAcc()).get(sceneId)!;
      if (type === "hint_requested") { acc.hintedBy.add(pseudonym); continue; }
      acc.attempts += 1;
      acc.attempting.add(pseudonym);
      if (type === "quiz_answered") {
        const ok = e["correct"] === true;
        acc.measured += 1; acc.correct += ok ? 1 : 0; acc.measuredBy.add(pseudonym);
        if (typeof e["confidence"] === "number") {
          acc.ratedN += 1; acc.ratedCorrect += ok ? 1 : 0; acc.confSum += e["confidence"]; acc.ratedBy.add(pseudonym);
        }
        if (typeof e["response_time_ms"] === "number") { acc.timeMs += e["response_time_ms"]; acc.timed += 1; acc.timedBy.add(pseudonym); }
      } else if (e["score_source"] === "llm" || e["score_source"] === "verdict_deck") {
        acc.measured += 1; acc.measuredBy.add(pseudonym);
        acc.correct += typeof e["llm_score"] === "number" && e["llm_score"] >= 0.6 ? 1 : 0;
      }
    }
  }

  if (unknownIdentity) return { status: "suppressed" as const, min_learners: floor, has_data: true, reason: T.identity };
  if (learners.size === 0) return { status: "no_data" as const, min_learners: floor, has_data: false, reason: T.no_data };
  if (learners.size < floor) return { status: "suppressed" as const, min_learners: floor, has_data: true, reason: T.floor(floor) };

  // A scene is published when at least `floor` learners answered it; inside it, each figure needs its own
  // population at the floor. A concept is rebuilt from the published figures of its published scenes only.
  let withheld = false;
  const sceneRows: SceneRow[] = [];
  const concepts = new Map<string, Acc>();
  for (const [id, acc] of scenes) {
    if (acc.attempting.size === 0) continue; // hints only: no answer, nothing to report or withhold
    if (acc.attempting.size < floor) { withheld = true; continue; }
    const { figures: published, withheld: partly } = figures(acc, floor);
    if (partly) withheld = true;
    const scene = sceneInfo.get(id);
    sceneRows.push({ scene_id: id, title: scene?.title ?? null, type: scene?.type ?? null, concept: conceptOf(id), ...published });
    const concept = concepts.get(conceptOf(id)) ?? concepts.set(conceptOf(id), newAcc()).get(conceptOf(id))!;
    addPublished(concept, acc, published);
  }
  sceneRows.sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || a.scene_id.localeCompare(b.scene_id));
  const conceptRows = [...concepts].map(([id, acc]): ConceptRow => ({
    concept: id, title: conceptTitle.get(id) ?? null, ...figures(acc, floor).figures,
  })).sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || (b.hint_reliance ?? 0) - (a.hint_reliance ?? 0) || a.concept.localeCompare(b.concept));

  const anyWithheld = withheld || (startedBy.size > 0 && startedBy.size < floor);
  const dataRoot = await realpath(ctx.dataDir);
  const sub = relative(dataRoot, root);
  return {
    status: "ok" as const,
    course_id: courseId,
    bundle_id: bundle.bundle_id,
    min_learners: floor,
    data_folder: { label: sub === "" ? basename(dataRoot) : `${basename(dataRoot)}/${sub.split(sep).join("/")}`, fingerprint: sha256(root).slice(0, 8) },
    cohort_band: cohortBand(learners.size, floor),
    // The figure's population is the learners who started the lesson.
    completion_rate: startedBy.size >= floor ? round(completed / started, 3) : null,
    scenes: sceneRows,
    concepts: conceptRows,
    withheld_below_floor: anyWithheld,
    // Concepts a class most needs re-taught: measured accuracy under 0.8, worst first.
    reteach_priority: conceptRows.filter((c) => c.accuracy !== null && c.accuracy < 0.8).map((c) => c.concept).slice(0, 5),
    not_included: T.not_included,
    non_attribution: T.non_attribution,
    ...(anyWithheld ? { note: T.withheld } : {}),
  };
}

// --- registration -----------------------------------------------------------------------------

/**
 * Register `review_lesson` and `class_report` on `server`; returns the registered tool names.
 * Both are read-only. The floor and the roots come from `ctx`, never from tool arguments: no argument
 * lets the model change which learners a report covers (see TeacherToolsContext.telemetryDir).
 */
/** class_report takes course_id and nothing else: an extra argument is refused with a message, never
 * stripped (RT-5: a caller passing telemetry_dir got the whole folder and believed it narrowed). */
const CLASS_REPORT_INPUT = z.object({ course_id: z.string().min(1).max(64) }, {
  errorMap: (issue, ctx) => issue.code === "unrecognized_keys"
    ? { message: `class_report takes only course_id; ${issue.keys.join(", ")} refused: the data folder (telemetry_dir) is server configuration (STUDIUM_DATA_DIR / STUDIUM_HOME), never a tool argument` }
    : { message: ctx.defaultError },
}).strict();

export function registerTeacherTools(server: McpServer, ctx: TeacherToolsContext): string[] {
  server.registerTool("review_lesson", {
    description: "Teacher: review a lesson draft before approving it. Returns the scene plan, who holds each answer key " +
      "(author_keyed / production / externally_grounded), the linter's verdict, remaining TODO placeholders, and whether an " +
      "approval record exists for this exact lesson.json. Also returns a review inbox: one item per scene, sorted by " +
      "consequence (blocks, grading, wording, media) and marked new / changed / unchanged since the last review receipt; " +
      "a scene that holds an answer key gets no fingerprint, because a hash of its keys would let anyone test guesses " +
      "against it. Never returns answer keys, hints or reveals. Read-only.",
    inputSchema: { course_ref: z.string().min(1).max(512) },
  }, async ({ course_ref }) => {
    try { return text(await reviewLesson(ctx, course_ref)); }
    catch (e) { return fail(e instanceof TeacherToolError ? e.message : "review_lesson failed"); }
  });
  server.registerTool("class_report", {
    description: "Teacher: class-level report for a course over consented telemetry: per scene and per concept accuracy " +
      "(only where a key or a model judge graded), hint reliance (share of answering learners who asked for a hint), " +
      "calibration gap (rated answers only), completion. Aggregate only, behind a minimum-cohort floor applied to the " +
      "learners each figure is computed over; never a learner identifier, and a scene, concept or figure with too few " +
      "contributors is withheld. Learner counts are banded (cohort_band); per-row attempt counts are exact. Each report " +
      "respects the floor, but two reports taken before and after a learner plays can be compared: treat figures as a live " +
      "class view, not a release. course_id is the name of the course's top-level folder under the server's lessons root " +
      "(the folder holding lesson.json; lowercase letters, digits, '.', '_' or '-', no '/'). It covers the whole data folder " +
      "the server is configured with, named by data_folder; the folder is server configuration and cannot be chosen from " +
      "here. Read-only.",
    inputSchema: CLASS_REPORT_INPUT,
  }, async ({ course_id }) => {
    try { return text(await classReport(ctx, course_id)); }
    catch (e) { return fail(e instanceof TeacherToolError ? e.message : "class_report failed"); }
  });
  return [...TEACHER_TOOL_NAMES];
}
