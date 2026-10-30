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
// count. The floor bounds each report, not the difference between two: a report run before and after
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BundleSchemaError, loadBundleJson } from "@studium/lesson-session/node";
import {
  COURSE_ID_PATTERN, REDACTED_SCENE_FIELDS, SCENE_KEY_CLASS, authoringOf, placeholderPaths, publicScene, readApproval,
  type ApprovalStatus, type AuthoringBlock, type KeyClass,
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
  /** Root of durable learner data (`<pseudonym>/<bundle_id>/telemetry.jsonl`); null when ephemeral. */
  dataDir: string | null;
  /** Runs the bundle linter on one lesson.json. Defaults to tools/bundle_lint.mjs. */
  lint?: LintRunner;
  /** Path of tools/bundle_lint.mjs when it is not next to this checkout. */
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
  const target = await confine(ctx.bundlesRoot, courseRef, "course_ref");
  let info;
  try { info = await stat(target); } catch { throw new TeacherToolError(`no such course: ${courseRef}`); }
  if (info.isDirectory()) {
    const lessonJson = join(target, "lesson.json");
    if (!existsSync(lessonJson)) throw new TeacherToolError(`no lesson.json in course folder: ${courseRef}`);
    return { lessonJson: await insideRoot(ctx.bundlesRoot, lessonJson, "course_ref", courseRef), courseDir: target };
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

/** Linter messages can quote the key: the flaw keyword, a parser snippet. Say where, not what. */
function sanitizeFinding(finding: LintFinding, keys: string[]): LintFinding {
  let message = finding.message;
  if (finding.code === "flaw_reveal_gap") {
    message = message.replace(/flaw ".*?" is absent from model_correction/, "a planted flaw (keyword withheld) is absent from model_correction");
  }
  if (finding.code === "invalid_json") message = "lesson.json is not valid JSON";
  for (const key of keys) message = message.split(key).join("[withheld]");
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

function defaultLintScript(ctx: TeacherToolsContext): string | null {
  if (ctx.lintScript) return existsSync(ctx.lintScript) ? ctx.lintScript : null;
  try {
    const guess = fileURLToPath(new URL("../../../tools/bundle_lint.mjs", import.meta.url));
    return existsSync(guess) ? guess : null;
  } catch { return null; } // bundled build without a file URL
}

export type LintSummary =
  | { status: "ok"; errors: number; warnings: number; infos: number; findings: LintFinding[] }
  | { status: "unavailable" | "failed"; reason: string; findings: LintFinding[] };

async function runLint(ctx: TeacherToolsContext, lessonJson: string, keys: string[]): Promise<LintSummary> {
  let runner = ctx.lint;
  if (!runner) {
    const script = defaultLintScript(ctx);
    if (!script) return { status: "unavailable", reason: "tools/bundle_lint.mjs was not found next to this server", findings: [] };
    runner = scriptLintRunner(script);
  }
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
export type ReviewAuthoring = Omit<AuthoringBlock, "notice"> & { notice: null; drafted_by: string | null };

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
    withheld: "At least one scene or concept is not shown: too few learners contributed to it. How many were withheld is not stated.",
    not_included: ["trust calibration (use tools/class_report.py)", "per-learner anything (never produced)"],
  },
  fr: {
    non_attribution: "Lecture au niveau de la classe sur les contributeurs que ce rapport nomme, et non une affirmation sur un étudiant : elle décrit comment un groupe a travaillé, rien ici ne la ramène à une personne.",
    floor: (k: number) => `Seuil d'anonymat : un rapport de classe exige au moins ${k} apprenants distincts dans la leçon, et cette leçon en compte moins. L'effectif est tu pour la même raison.`,
    identity: "Aucune cohorte ne peut être établie : au moins un événement de télémétrie n'a ni learner_pseudonym ni lesson_id, la population serait en partie inconnue. Rien n'est publié.",
    no_data: "Aucune télémétrie trouvée pour ce cours. Elle n'est écrite que pour les apprenants consentants (STUDIUM_TELEMETRY_CONSENT) dans un dossier de données durable ; vérifiez le dossier, ou que quelqu'un a joué la leçon.",
    withheld: "Au moins une scène ou un concept n'est pas montré : trop peu d'apprenants y ont contribué. Leur nombre n'est pas indiqué.",
    not_included: ["calibration de la confiance (utiliser tools/class_report.py)", "tout chiffre individuel (jamais produit)"],
  },
};

interface Acc {
  attempts: number; measured: number; correct: number; hints: number;
  /** Quiz answers the learner rated (confidence present), their correct ones and their summed confidence. */
  ratedN: number; ratedCorrect: number; confSum: number; timeMs: number; timed: number; members: Set<string>;
}
const newAcc = (): Acc => ({ attempts: 0, measured: 0, correct: 0, hints: 0, ratedN: 0, ratedCorrect: 0, confSum: 0, timeMs: 0, timed: 0, members: new Set() });

const round = (value: number, digits: number): number => { const f = 10 ** digits; return Math.round(value * f) / f; };

export interface Figures {
  /** The row's learner count, banded. */
  cohort_band: string;
  /** Exact counts (lead decision I-8): on a scene each learner answers once, so these equal the row's
   * learner count; only learner counts are banded. */
  n_attempts: number;
  n_measured: number;
  accuracy: number | null;
  hint_reliance: number | null;
  calibration_gap: number | null;
  mean_time_s: number | null;
}

function figures(acc: Acc, floor: number): Figures {
  return {
    cohort_band: cohortBand(acc.members.size, floor),
    n_attempts: acc.attempts,
    // `measured` = answers a key or a model judge graded. A keyword score nobody judged is not a
    // measure of understanding, so it counts as an attempt and never as accuracy.
    n_measured: acc.measured,
    accuracy: acc.measured > 0 ? round(acc.correct / acc.measured, 3) : null,
    hint_reliance: acc.attempts > 0 ? round(acc.hints / acc.attempts, 3) : null,
    // + = over-confident; only quiz answers carry a self-rated confidence, and only the rated ones
    // count (lead decision I-5: an answer the learner did not rate has no confidence, not 0).
    calibration_gap: acc.ratedN > 0 ? round(acc.confSum / acc.ratedN - acc.ratedCorrect / acc.ratedN, 3) : null,
    mean_time_s: acc.timed > 0 ? round(acc.timeMs / acc.timed / 1000, 1) : null,
  };
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

export type ClassReportResult =
  | { status: "suppressed"; min_learners: number; has_data: true; reason: string }
  | { status: "no_data"; min_learners: number; has_data: false; reason: string }
  | {
    status: "ok"; course_id: string; bundle_id: string; min_learners: number;
    /** The whole run's learner count, banded. */
    cohort_band: string;
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
  const lessonPath = await confine(ctx.bundlesRoot, join(courseId, "lesson.json"), "course_id");
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
  const concepts = new Map<string, Acc>();
  const learners = new Set<string>();
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
      if (type === "lesson_started") { started += 1; continue; }
      if (type === "lesson_completed") { completed += 1; continue; }
      if (type !== "quiz_answered" && type !== "critique_submitted" && type !== "hint_requested") continue;
      const sceneId = typeof e["scene_id"] === "string" ? e["scene_id"] : "";
      if (sceneId === "") continue;
      for (const acc of [scenes.get(sceneId) ?? scenes.set(sceneId, newAcc()).get(sceneId)!,
        concepts.get(conceptOf(sceneId)) ?? concepts.set(conceptOf(sceneId), newAcc()).get(conceptOf(sceneId))!]) {
        acc.members.add(pseudonym);
        if (type === "hint_requested") { acc.hints += 1; continue; }
        acc.attempts += 1;
        if (type === "quiz_answered") {
          const ok = e["correct"] === true;
          acc.measured += 1; acc.correct += ok ? 1 : 0;
          if (typeof e["confidence"] === "number") { acc.ratedN += 1; acc.ratedCorrect += ok ? 1 : 0; acc.confSum += e["confidence"]; }
          if (typeof e["response_time_ms"] === "number") { acc.timeMs += e["response_time_ms"]; acc.timed += 1; }
        } else if (e["score_source"] === "llm" || e["score_source"] === "verdict_deck") {
          acc.measured += 1;
          acc.correct += typeof e["llm_score"] === "number" && e["llm_score"] >= 0.6 ? 1 : 0;
        }
      }
    }
  }

  if (unknownIdentity) return { status: "suppressed" as const, min_learners: floor, has_data: true, reason: T.identity };
  if (learners.size === 0) return { status: "no_data" as const, min_learners: floor, has_data: false, reason: T.no_data };
  if (learners.size < floor) return { status: "suppressed" as const, min_learners: floor, has_data: true, reason: T.floor(floor) };

  let withheld = false;
  const publishable = <K extends string>(map: Map<K, Acc>): Array<[K, Acc]> => {
    const rows = [...map].filter(([, acc]) => acc.members.size >= floor);
    if (rows.length < map.size) withheld = true;
    return rows;
  };
  const sceneRows = publishable(scenes).map(([id, acc]): SceneRow => {
    const scene = sceneInfo.get(id);
    return { scene_id: id, title: scene?.title ?? null, type: scene?.type ?? null, concept: conceptOf(id), ...figures(acc, floor) };
  }).sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || a.scene_id.localeCompare(b.scene_id));
  const conceptRows = publishable(concepts).map(([id, acc]): ConceptRow => ({
    concept: id, title: conceptTitle.get(id) ?? null, ...figures(acc, floor),
  })).sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || (b.hint_reliance ?? 0) - (a.hint_reliance ?? 0) || a.concept.localeCompare(b.concept));

  return {
    status: "ok" as const,
    course_id: courseId,
    bundle_id: bundle.bundle_id,
    min_learners: floor,
    cohort_band: cohortBand(learners.size, floor),
    completion_rate: started > 0 ? round(completed / started, 3) : null,
    scenes: sceneRows,
    concepts: conceptRows,
    withheld_below_floor: withheld,
    // Concepts a class most needs re-taught: measured accuracy under 0.8, worst first.
    reteach_priority: conceptRows.filter((c) => c.accuracy !== null && c.accuracy < 0.8).map((c) => c.concept).slice(0, 5),
    not_included: T.not_included,
    non_attribution: T.non_attribution,
    ...(withheld ? { note: T.withheld } : {}),
  };
}

// --- registration -----------------------------------------------------------------------------

/**
 * Register `review_lesson` and `class_report` on `server`; returns the registered tool names.
 * Both are read-only. The floor and the roots come from `ctx`, never from tool arguments: no argument
 * lets the model change which learners a report covers (see TeacherToolsContext.telemetryDir).
 */
export function registerTeacherTools(server: McpServer, ctx: TeacherToolsContext): string[] {
  server.registerTool("review_lesson", {
    description: "Teacher: review a lesson draft before approving it. Returns the scene plan, who holds each answer key " +
      "(author_keyed / production / externally_grounded), the linter's verdict, remaining TODO placeholders, and whether an " +
      "approval record exists for this exact lesson.json. Never returns answer keys, hints or reveals. Read-only.",
    inputSchema: { course_ref: z.string().min(1).max(512) },
  }, async ({ course_ref }) => {
    try { return text(await reviewLesson(ctx, course_ref)); }
    catch (e) { return fail(e instanceof TeacherToolError ? e.message : "review_lesson failed"); }
  });
  server.registerTool("class_report", {
    description: "Teacher: class-level report for a course over consented telemetry: per scene and per concept accuracy " +
      "(only where a key or a model judge graded), hint reliance, calibration gap, completion. Aggregate only, behind a " +
      "minimum-cohort floor; never a learner identifier, and a scene or concept with too few contributors is withheld. " +
      "Learner counts are banded (cohort_band); per-row attempt counts are exact. Each report respects the floor, but two " +
      "reports taken before and after a learner plays can be compared: treat figures as a live class view, not a release. " +
      "It covers the whole data folder the server is configured with; the folder cannot be narrowed from here. Read-only.",
    inputSchema: { course_id: z.string().min(1).max(64) },
  }, async ({ course_id }) => {
    try { return text(await classReport(ctx, course_id)); }
    catch (e) { return fail(e instanceof TeacherToolError ? e.message : "class_report failed"); }
  });
  return [...TEACHER_TOOL_NAMES];
}
