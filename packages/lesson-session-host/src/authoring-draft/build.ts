// packages/lesson-session-host/src/authoring-draft/build.ts
//
// create_lesson (contract C1): a LessonDraft (C2) over a prepared source set becomes a complete
// LessonBundle 1.4 in the learner's library, `<library>/<course_id>/lesson.json`. The builder fills
// what an author should not have to write — ids, defaults, the prerequisite graph, each scene's
// evidence from its quotes, metadata.authoring (C3: self-study, drafted by the agent) — and
// refuses, with readable {path, message, hint} errors, anything that would make the lesson
// unplayable or unfounded: a quote not found in its passage, an unfilled TODO, a dangling concept,
// a quiz without one right answer, or any ERROR of the repository linter. Nothing is written
// unless the whole lesson passes.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { LessonBundleSchema, formatBundleError, type BundleIssue, type LessonBundle } from "@studium/lesson-bundle-schema";
import { hasUnvalidatedPlaceholder } from "../authoring.js";
import { COURSE_ID_PATTERN } from "../community-bundles.js";
import { SCENE_KEY_CLASS, type KeyClass } from "../key-class.js";
import { LessonDraftSchema, type DraftScene, type DraftSceneType, type LessonDraft } from "./draft-schema.js";
import { lintBundleData, placeholderPaths, type LintFinding } from "./lint.js";
import { checkQuote, sourceSpan } from "./quotes.js";
import { asciiSlug } from "./slug.js";
import { AuthoringInputError, DEFAULT_LICENSE, readSourceSet, type SourceSet } from "./source-set.js";

/** The `validated_by` of a lesson no teacher validated (the same marker as experience_packet.py). */
export const SELF_STUDY_VALIDATED_BY = "SELF-STUDY — not teacher-validated";
export const LESSON_FILENAME = "lesson.json";
const ENRICHER_VERSION = "studium-authoring-draft/1";
const DEFAULT_RUBRIC = Object.freeze({ completeness: 0.6, evidence_quality: 0.3, tone: 0.1 });
/** Time a learner usually spends on a scene of each type, when the draft does not say. */
const DEFAULT_SECONDS: Readonly<Record<DraftSceneType, number>> = Object.freeze({
  intro: 60, concept: 120, quiz: 60, meta_checkpoint: 30, discussion: 300, ai_critique: 240, spot_the_flaw: 240,
  explain_back: 240, comparison: 240, summary_audit: 240, prompt_practice: 240, communication_sim: 240,
});
const LOCALIZED = Object.freeze({
  fr: {
    target: "Apprenant autonome",
    scale_labels: ["Pas du tout", "Un peu", "Moyennement", "Plutôt bien", "Tout à fait"],
    // French typography (L-5): a no-break space before the colon.
    replay: "Deux erreurs sur ce concept\u00a0: on reprend la scène avec un appui.",
  },
  en: {
    target: "Self-directed learner",
    scale_labels: ["Not at all", "A little", "Moderately", "Fairly well", "Completely"],
    replay: "Two errors on this concept: replay the scene with support.",
  },
});
const CHOICE_LETTERS = "abcdef";
/** COURSE_ID_PATTERN allows 64 characters. */
const MAX_COURSE_ID_CHARS = 64;
const PLACEHOLDER_EXCERPT_CHARS = 60;
/** Hints for the linter's ERRORs a draft can cause, and the scene field each one concerns. */
const LINT_REMEDIES: Readonly<Record<string, { hint: string; field?: string }>> = Object.freeze({
  flaw_reveal_gap: { hint: "name every expected flaw in model_correction, in the words of flaws_expected", field: "model_correction" },
  quiz_answer_key: { hint: "mark the one right answer correct: true", field: "choices" },
  lwg_locked_before_prereq: { hint: "order the scenes so a prerequisite concept is taught before the concepts that depend on it, or remove the prerequisite" },
  lwg_cycle: { hint: "remove one prerequisite of the cycle" },
  unresolved_asset: { hint: "a draft cannot ship files: give the asset an inline payload instead of a path", field: "render_assets" },
  duplicate_scene_id: { hint: "give each scene its own id, or leave ids out" },
  unfilled_placeholder: { hint: "write the real text: a lesson is created complete, with no TODO" },
});

export interface CreateLessonInput {
  source_set_id: string;
  draft: unknown;
  course_id?: string | undefined;
  overwrite?: boolean | undefined;
}

/** A finding of create_lesson: the linter's, or the builder's own advice, with a hint when the
 * builder knows what to change in the draft. */
export type CreateLessonFinding = LintFinding & { hint?: string };

export interface CreateLessonOptions {
  /** The build time (validated_at, evidence timestamps); the wall clock by default. */
  now?: () => Date;
  /** Whether the server already serves a lesson of this course id from a folder it reads before the
   * library (BUNDLES_ROOT): a lesson written under that id would never be the one played. */
  servedElsewhere?: (courseId: string) => boolean;
}

/** The lesson as the agent may show it to the learner before they play: no key of any kind. */
export interface LessonOutline {
  title: string;
  language: string;
  goal: string;
  concepts: Array<{ id: string; label: string; prerequisites: string[] }>;
  scenes: Array<{ id: string; type: string; title: string; concepts: string[]; key_class: KeyClass; passages: string[] }>;
}

/** The scene ids of each key class (who holds the key that grades them, key-class.ts). */
export type KeyClasses = Record<KeyClass, string[]>;

export type CreateLessonResult =
  | {
    ok: true; course_id: string; course_ref: string; lesson_path: string; bundle: LessonBundle;
    outline: LessonOutline; key_classes: KeyClasses; findings: CreateLessonFinding[];
  }
  | { ok: false; errors: BundleIssue[] };

type Refusal = Extract<CreateLessonResult, { ok: false }>;
const refused = (errors: BundleIssue[]): Refusal => ({ ok: false, errors });

/**
 * Build the draft `input.draft` over source set `input.source_set_id` and write it to
 * `<libraryRoot>/<course_id>/lesson.json` (course_id defaults to the title's slug). An existing
 * lesson is replaced only with `overwrite`. Returns the bundle, a keyless outline, the key classes
 * and the linter's WARN/INFO findings, or the errors that refused it (nothing written then).
 */
export async function createLesson(libraryRoot: string, input: CreateLessonInput, options: CreateLessonOptions = {}): Promise<CreateLessonResult> {
  try {
    const sourceSet = await readSourceSet(libraryRoot, input.source_set_id);
    const parsed = LessonDraftSchema.safeParse(input.draft);
    if (!parsed.success) return refused(formatBundleError(parsed.error, input.draft));
    const draft = parsed.data;
    const courseId = input.course_id ?? asciiSlug(draft.title, MAX_COURSE_ID_CHARS, "lesson");
    if (!COURSE_ID_PATTERN.test(courseId)) {
      return refused([{
        path: "course_id", message: `${JSON.stringify(courseId)} is not a course id`,
        hint: "use lowercase letters, digits, dots, dashes or underscores, starting with a letter or a digit (at most 64)",
      }]);
    }
    if (options.servedElsewhere?.(courseId)) {
      return refused([{
        path: "course_id", message: `${JSON.stringify(courseId)} is already a lesson in the lessons folder this server reads before the library`,
        hint: "choose another course_id",
      }]);
    }
    const now = (options.now ?? (() => new Date()))();
    const built = buildBundle(draft, sourceSet, courseId, now);
    if (!built.ok) return built;
    const { bundle } = built;
    const lint = lintBundleData(bundle, { bundleDir: join(libraryRoot, courseId) });
    const lintErrors = lint.findings.filter((item) => item.level === "ERROR");
    if (lintErrors.length > 0) return refused(lintErrors.map((item) => lintIssue(item, bundle)));
    const written = await writeLesson(libraryRoot, courseId, bundle, input.overwrite === true);
    if (!written.ok) return written;
    return {
      ok: true, course_id: courseId, course_ref: `${courseId}/${LESSON_FILENAME}`, lesson_path: written.path, bundle,
      outline: outlineOf(bundle, draft), key_classes: keyClassesOf(bundle),
      findings: [
        ...lint.findings.map((item) => withHint(item, draft)),
        ...diagnosticFindings(bundle, Boolean(draft.learner_profile)),
        ...dailyBudgetFindings(draft, bundle),
      ],
    };
  } catch (error) {
    if (error instanceof AuthoringInputError) return refused(error.issues);
    throw error;
  }
}

/** The bundle a parsed draft becomes, or the reasons it cannot (pure: no disk access). */
function buildBundle(draft: LessonDraft, sourceSet: SourceSet, courseId: string, now: Date): { ok: true; bundle: LessonBundle } | Refusal {
  const goal = draft.goal ?? sourceSet.goal;
  const issues = draftIssues(draft, sourceSet, goal);
  if (issues.length > 0 || goal === null) return refused(issues);
  const locale = draft.language.trim().slice(0, 2).toLowerCase() === "fr" ? LOCALIZED.fr : LOCALIZED.en;
  const conceptIds = draft.concepts.map((concept) => concept.id);
  const sceneIds = sceneIdsOf(draft.scenes);
  const scenes = draft.scenes.map((scene, index) => sceneOf(scene, sceneIds[index]!, conceptIds, sourceSet, locale, now));
  const seconds = scenes.reduce((total, scene) => total + Number(scene["estimated_seconds"]), 0);
  const bundleId = `self-study-${courseId}`;
  const parsed = LessonBundleSchema.safeParse({
    schema_version: "1.4",
    bundle_id: bundleId,
    source_plan_id: sourceSet.source_set_id,
    metadata: {
      title: draft.title,
      target: draft.target ?? locale.target,
      duration_minutes: draft.duration_minutes ?? Math.max(1, Math.ceil(seconds / 60)),
      language: draft.language,
      discipline: draft.discipline ?? "",
      authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent", note: goal, ...profileOf(draft) },
    },
    concepts: draft.concepts.map((concept) => ({
      id: concept.id, title: concept.label, description: concept.description ?? concept.label, bloom_level_target: concept.bloom,
    })),
    scenes,
    rules: [{
      id: "rule_2err_replay_concept", when: { consecutive_errors_same_concept: ">=2" },
      action: { kind: "replay_current_scene", reason: "errors_threshold" }, modulator: "M1", explanation_short: locale.replay,
    }],
    validated_by: SELF_STUDY_VALIDATED_BY,
    validated_at: now.toISOString(),
    learning_workflow_graph: graphOf(draft, bundleId),
  });
  // The draft schema mirrors the bundle's, so this only fails on a builder bug: report it as is.
  if (!parsed.success) return refused(formatBundleError(parsed.error));
  return { ok: true, bundle: parsed.data };
}

/** RFR-06: the scheduling part of the learner profile (the study plan reads minutes_per_day), or
 * nothing. A lesson file can be shared, so prior knowledge and interests stay out of it. */
function profileOf(draft: LessonDraft): { learner_profile?: { minutes_per_day?: number; target_date?: string } } {
  const { minutes_per_day, target_date } = draft.learner_profile ?? {};
  if (minutes_per_day === undefined && target_date === undefined) return {};
  return { learner_profile: { ...(minutes_per_day !== undefined ? { minutes_per_day } : {}), ...(target_date !== undefined ? { target_date } : {}) } };
}

/** Everything wrong with a schema-valid draft, in reading order. */
function draftIssues(draft: LessonDraft, sourceSet: SourceSet, goal: string | null): BundleIssue[] {
  const issues: BundleIssue[] = placeholderPaths(draft).map((path) => ({
    path, message: `unfilled placeholder ${JSON.stringify(excerpt(String(valueAt(draft, path))))}`,
    hint: LINT_REMEDIES["unfilled_placeholder"]!.hint,
  }));
  if (goal === null) {
    issues.push({ path: "goal", message: "required field is missing", hint: "state the learner's goal in their own words (or pass goal to prepare_sources)" });
  }
  const conceptIds = draft.concepts.map((concept) => concept.id);
  const known = new Set(conceptIds);
  const useOneOf = `use one of: ${conceptIds.join(", ")}`;
  draft.concepts.forEach((concept, index) => {
    if (conceptIds.indexOf(concept.id) !== index) {
      issues.push({ path: `concepts.${index}.id`, message: `duplicate concept id "${concept.id}"`, hint: "give each concept its own id" });
    }
    (concept.prerequisites ?? []).forEach((prerequisite, position) => {
      const path = `concepts.${index}.prerequisites.${position}`;
      if (prerequisite === concept.id) issues.push({ path, message: "a concept cannot be its own prerequisite", hint: "remove it" });
      else if (!known.has(prerequisite)) issues.push({ path, message: `unknown concept "${prerequisite}"`, hint: useOneOf });
    });
  });
  const taught = new Set<string>();
  const givenSceneIds = draft.scenes.map((scene) => scene.id);
  draft.scenes.forEach((scene, index) => {
    const at = `scenes.${index}`;
    if (scene.id !== undefined && givenSceneIds.indexOf(scene.id) !== index) {
      issues.push({ path: `${at}.id`, message: `duplicate scene id "${scene.id}"`, hint: LINT_REMEDIES["duplicate_scene_id"]!.hint });
    }
    if (scene.concept_refs === undefined && conceptIds.length > 1) {
      issues.push({ path: `${at}.concept_refs`, message: "required when the draft has several concepts", hint: `name the concept this scene teaches: one of ${conceptIds.join(", ")}` });
    }
    (scene.concept_refs ?? conceptIds.slice(0, 1)).forEach((ref, position) => {
      if (known.has(ref)) taught.add(ref);
      else issues.push({ path: `${at}.concept_refs.${position}`, message: `unknown concept "${ref}"`, hint: useOneOf });
    });
    if (scene.type === "quiz") {
      const correct = scene.choices.filter((choice) => choice.correct).length;
      if (correct !== 1) issues.push({ path: `${at}.choices`, message: `exactly one choice must be correct, found ${correct}`, hint: LINT_REMEDIES["quiz_answer_key"]!.hint });
    }
    issues.push(...nestedIdIssues(scene, at));
    (scene.quotes ?? []).forEach((quote, position) => {
      const check = checkQuote(quote.passage_id, quote.text, sourceSet.passages);
      if (check.ok) return;
      const knownPassage = sourceSet.passages.some((passage) => passage.id === quote.passage_id);
      issues.push({ path: `${at}.quotes.${position}.${knownPassage ? "text" : "passage_id"}`, message: check.message, hint: check.hint });
    });
  });
  draft.concepts.forEach((concept, index) => {
    if (!taught.has(concept.id) && conceptIds.indexOf(concept.id) === index) {
      issues.push({ path: `concepts.${index}`, message: `concept "${concept.id}" has no scene`, hint: "add a scene that teaches it, or remove it" });
    }
  });
  return issues;
}

/** Duplicate ids among a scene's choices, key points or claims (the builder fills missing ones). */
function nestedIdIssues(scene: DraftScene, at: string): BundleIssue[] {
  const lists: Array<[string, ReadonlyArray<{ id?: string | undefined }>]> = [];
  if ("choices" in scene) lists.push(["choices", scene.choices]);
  if ("key_points" in scene) lists.push(["key_points", scene.key_points]);
  if ("claims" in scene) lists.push(["claims", scene.claims]);
  if ("sound_claims" in scene && scene.sound_claims) lists.push(["sound_claims", scene.sound_claims]);
  return lists.flatMap(([field, items]) => {
    const ids = items.map((item) => item.id);
    return items.flatMap((item, index) => item.id !== undefined && ids.indexOf(item.id) !== index
      ? [{ path: `${at}.${field}.${index}.id`, message: `duplicate id "${item.id}"`, hint: "give each its own id, or leave ids out" }]
      : []);
  });
}

/** Scene ids: the draft's own, else `s<n>-<type>`, never colliding with a given one. */
function sceneIdsOf(scenes: DraftScene[]): string[] {
  const used = new Set(scenes.flatMap((scene) => (scene.id === undefined ? [] : [scene.id])));
  return scenes.map((scene, index) => {
    if (scene.id !== undefined) return scene.id;
    const base = `s${index + 1}-${scene.type}`;
    let candidate = base;
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
    used.add(candidate);
    return candidate;
  });
}

/** Fill the missing ids of `items` with `nextId(n)`, skipping ids already given. */
function withIds<T extends { id?: string | undefined }>(items: readonly T[], nextId: (n: number) => string): Array<T & { id: string }> {
  const used = new Set(items.flatMap((item) => (item.id === undefined ? [] : [item.id])));
  let n = 0;
  return items.map((item) => {
    if (item.id !== undefined) return { ...item, id: item.id };
    let id = nextId(n++);
    while (used.has(id)) id = nextId(n++);
    used.add(id);
    return { ...item, id };
  });
}

const numbered = (prefix: string) => (n: number): string => `${prefix}${n + 1}`;
const lettered = (n: number): string => CHOICE_LETTERS[n] ?? `choice-${n + 1}`;

/** One bundle scene from one draft scene: defaults, filled ids, evidence from the quotes. The
 * result is checked by LessonBundleSchema with the rest of the bundle. */
function sceneOf(
  draftScene: DraftScene, id: string, conceptIds: string[], sourceSet: SourceSet,
  locale: (typeof LOCALIZED)[keyof typeof LOCALIZED], now: Date,
): Record<string, unknown> {
  const { quotes, ...fields } = draftScene;
  const scene: Record<string, unknown> = {
    ...fields,
    id,
    objective_refs: fields.objective_refs ?? [],
    concept_refs: fields.concept_refs ?? conceptIds.slice(0, 1),
    estimated_seconds: fields.estimated_seconds ?? DEFAULT_SECONDS[fields.type],
    adaptation_hooks: fields.adaptation_hooks ?? [],
  };
  if (hasRubric(fields.type)) scene["rubric"] = ("rubric" in fields ? fields.rubric : undefined) ?? { ...DEFAULT_RUBRIC };
  if (fields.type === "quiz") {
    scene["choices"] = withIds(fields.choices, lettered);
    scene["hints"] = fields.hints ?? [];
  }
  if (fields.type === "meta_checkpoint") scene["scale_labels"] = fields.scale_labels ?? [...locale.scale_labels];
  if ("key_points" in fields) scene["key_points"] = withIds(fields.key_points, numbered("kp"));
  if (fields.type === "ai_critique" || fields.type === "summary_audit") scene["claims"] = withIds(fields.claims, numbered("c"));
  if (fields.type === "spot_the_flaw") {
    scene["claims"] = withIds(fields.claims, numbered("f"));
    if (fields.sound_claims) scene["sound_claims"] = withIds(fields.sound_claims, numbered("s"));
  }
  const evidence = evidenceOf(quotes ?? [], sourceSet, now);
  if (evidence) scene["evidence"] = evidence;
  return scene;
}

function hasRubric(type: DraftSceneType): boolean {
  return !["intro", "concept", "quiz", "meta_checkpoint", "discussion"].includes(type);
}

/** `prov_derived_from` of a citation taken from a conversation excerpt (source kind `conversation`).
 * authoringOf reads it to tell the learner what the lesson rests on. */
export const CONVERSATION_PROVENANCE_PREFIX = "conversation:";

/** ADR 014 evidence of a scene: one bibliographic ref per quote, its excerpt in the source's own
 * characters, `prov_derived_from` the source URL (`source:<id>` for a text without one,
 * `conversation:<id>` for a conversation excerpt) and
 * `license` the source's declared licence. */
function evidenceOf(quotes: ReadonlyArray<{ passage_id: string; text: string }>, sourceSet: SourceSet, now: Date): Record<string, unknown> | undefined {
  if (quotes.length === 0) return undefined;
  return {
    bibliographic_refs: quotes.map((quote) => {
      // draftIssues refused any quote whose passage is unknown, and each passage has its source.
      const passage = sourceSet.passages.find((candidate) => candidate.id === quote.passage_id)!;
      const source = sourceSet.sources.find((candidate) => candidate.source_id === passage.source_id)!;
      return {
        perspicacite_doc_id: passage.id, title: source.title, authors: [], excerpt: sourceSpan(quote.text, passage.text),
        relevance_score: 1,
        prov_derived_from: source.kind === "conversation" ? `${CONVERSATION_PROVENANCE_PREFIX}${source.source_id}`
          : source.url ?? `source:${source.source_id}`,
        // L-3: an attribution licence is honoured only if it travels with the citation. A source
        // prepared without one records DEFAULT_LICENSE, which is no licence to show.
        ...(source.license === DEFAULT_LICENSE ? {} : { license: source.license }),
      };
    }),
    enrichment_metadata: { enricher_version: ENRICHER_VERSION, perspicacite_mode_used: "passages", timestamp: now.toISOString(), degraded: false },
  };
}

/** The Learning Workflow Graph of the concepts: an edge from each dependent concept to each of its
 * prerequisites (engine convention, packages/lesson-session/src/graph-nav.ts). */
function graphOf(draft: LessonDraft, courseId: string): Record<string, unknown> {
  return {
    schema_version: "1.0",
    course_id: courseId,
    nodes: draft.concepts.map((concept) => ({
      id: `concept:${concept.id}`, node_kind: "concept", title: concept.label, bloom_level: concept.bloom,
      description: concept.description ?? concept.label,
    })),
    edges: draft.concepts.flatMap((concept) => [...new Set(concept.prerequisites ?? [])].map((prerequisite) => ({
      id: `prerequisite:${concept.id}:${prerequisite}`, relation: "prerequisite_for",
      source: `concept:${concept.id}`, target: `concept:${prerequisite}`,
    }))),
  };
}

/** A linter ERROR as a draft error: its path when the message starts with one, else the scene it
 * names (and the field that code concerns). */
function lintIssue(item: LintFinding, bundle: LessonBundle): BundleIssue {
  const remedy = LINT_REMEDIES[item.code];
  const leadingPath = /^([a-z_]+(?:\.[A-Za-z0-9_-]+)+): /.exec(item.message)?.[1];
  const sceneIndex = bundle.scenes.findIndex((scene) => item.message.startsWith(`${scene.id}:`));
  const scenePath = sceneIndex < 0 ? "" : [`scenes.${sceneIndex}`, remedy?.field].filter(Boolean).join(".");
  return {
    path: leadingPath ?? scenePath,
    message: `${item.code}: ${item.message}`,
    hint: remedy?.hint ?? "fix the draft as the message says",
  };
}

function outlineOf(bundle: LessonBundle, draft: LessonDraft): LessonOutline {
  return {
    title: bundle.metadata.title,
    language: bundle.metadata.language,
    goal: bundle.metadata.authoring?.note ?? "",
    concepts: draft.concepts.map((concept) => ({ id: concept.id, label: concept.label, prerequisites: [...new Set(concept.prerequisites ?? [])] })),
    scenes: bundle.scenes.map((scene) => ({
      id: scene.id, type: scene.type, title: scene.title, concepts: scene.concept_refs, key_class: SCENE_KEY_CLASS[scene.type],
      passages: [...new Set((scene.evidence?.bibliographic_refs ?? []).map((ref) => ref.perspicacite_doc_id))],
    })),
  };
}

export function keyClassesOf(bundle: Pick<LessonBundle, "scenes">): KeyClasses {
  const classes: KeyClasses = { ungraded: [], author_keyed: [], production: [], externally_grounded: [] };
  for (const scene of bundle.scenes) classes[SCENE_KEY_CLASS[scene.type]].push(scene.id);
  return classes;
}

/** SL-6: with a learner profile, the guide asks for an opening diagnostic — a meta_checkpoint and a
 * short production scene, first or right after the intro, both marked `diagnostic: true`. Advice,
 * not a refusal. The flags matter: once any scene of a bundle is flagged, the review picker no
 * longer infers the diagnostic from its position (L-8), so an unflagged diagnostic production
 * scene could come back as a review. */
function diagnosticFindings(bundle: LessonBundle, hasProfile: boolean): LintFinding[] {
  if (!hasProfile) return [];
  const opening = bundle.scenes.filter((scene) => scene.type !== "intro").slice(0, 2);
  const hasCheckpoint = opening.some((scene) => scene.type === "meta_checkpoint");
  const hasProduction = opening.some((scene) => SCENE_KEY_CLASS[scene.type] === "production");
  if (!hasCheckpoint || !hasProduction) {
    return [{
      level: "WARN", code: "no_opening_diagnostic",
      message: "learner_profile is given but the lesson does not open (after its intro, if it has one) with the two-item " +
        "diagnostic: a meta_checkpoint and a short production scene, both marked diagnostic: true",
    }];
  }
  const unflagged = opening.filter((scene) => scene.diagnostic !== true).map((scene) => scene.id);
  if (unflagged.length === 0) return [];
  return [{
    level: "WARN", code: "no_opening_diagnostic_flag",
    message: `the opening diagnostic is not marked: set diagnostic: true on ${unflagged.join(" and ")}, so that ` +
      "neither diagnostic scene is ever replayed as a review",
  }];
}

/** RFR-17: the linter's unmeasurable-prerequisite WARN, with the draft concept to give a quiz and
 * the concepts that depend on it. Other findings are returned as they are. */
function withHint(item: LintFinding, draft: LessonDraft): CreateLessonFinding {
  if (item.code !== "lwg_prereq_unassessable") return item;
  const conceptId = /^concept:(\S+) /.exec(item.message)?.[1];
  if (conceptId === undefined) return item;
  const dependents = draft.concepts.filter((concept) => (concept.prerequisites ?? []).includes(conceptId)).map((concept) => concept.id);
  const of = dependents.length > 0 ? ` (a prerequisite of ${dependents.join(", ")})` : "";
  return {
    ...item,
    hint: `add a quiz on "${conceptId}"${of} with concept_refs ["${conceptId}", …]: without a judge model only a quiz ` +
      "or an ai_critique measures a concept, so the learner otherwise moves on with this prerequisite never checked",
  };
}

/** RFR-06: a lesson longer than the learner's minutes a day is advice to split it, not a refusal. */
function dailyBudgetFindings(draft: LessonDraft, bundle: LessonBundle): LintFinding[] {
  const budget = draft.learner_profile?.minutes_per_day;
  const minutes = bundle.metadata.duration_minutes;
  if (budget === undefined || minutes <= budget) return [];
  return [{
    level: "WARN", code: "duration_over_daily_minutes",
    message: `the lesson takes about ${minutes} minutes, more than the learner's ${budget} minutes a day: split it into ` +
      "two lessons, or keep fewer scenes",
  }];
}

/** Write atomically; refuse an existing lesson without `overwrite`, an existing lesson that is not
 * a self-study lesson (SEC-1: overwrite never replaces a teacher's or an approved lesson), and a
 * course folder that resolves outside the library (a link). */
async function writeLesson(root: string, courseId: string, bundle: LessonBundle, overwrite: boolean): Promise<{ ok: true; path: string } | Refusal> {
  const courseDir = join(root, courseId);
  const lessonPath = join(courseDir, LESSON_FILENAME);
  if (await exists(lessonPath)) {
    if (!overwrite) {
      return refused([{
        path: "course_id", message: `a lesson already exists at ${courseId}/${LESSON_FILENAME}`,
        hint: "pass overwrite: true to replace it, or choose another course_id",
      }]);
    }
    const kept = await replaceableIssue(courseDir, `${courseId}/${LESSON_FILENAME}`);
    if (kept) return refused([kept]);
  }
  await mkdir(courseDir, { recursive: true });
  const placed = relative(await realpath(root), await realpath(courseDir));
  if (placed === "" || placed.startsWith("..") || isAbsolute(placed) || placed.includes(sep)) {
    return refused([{ path: "course_id", message: `${courseId} resolves outside the library`, hint: "choose another course_id" }]);
  }
  const temporary = `${lessonPath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  await rename(temporary, lessonPath);
  return { ok: true, path: lessonPath };
}

/** Why the lesson in `courseDir` must not be replaced, or null: only a self-study lesson that no
 * teacher validated and nobody approved (no approval.json) may be overwritten. */
async function replaceableIssue(courseDir: string, shown: string): Promise<BundleIssue | null> {
  const hint = "choose another course_id";
  if (await exists(join(courseDir, "approval.json"))) {
    return { path: "course_id", message: `${shown} has an approval.json: overwrite replaces only a self-study lesson nobody approved`, hint };
  }
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(join(courseDir, LESSON_FILENAME), "utf8"));
  } catch {
    return { path: "course_id", message: `${shown} is unreadable: overwrite replaces only a self-study lesson`, hint };
  }
  const metadata = isRecord(existing) && isRecord(existing["metadata"]) ? existing["metadata"] : undefined;
  const authoring = metadata && isRecord(metadata["authoring"]) ? metadata["authoring"] : undefined;
  if (authoring?.["mode"] !== "self_study") {
    return { path: "course_id", message: `${shown} is not a self-study lesson: overwrite replaces only those`, hint };
  }
  const validatedBy = typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>)["validated_by"] : undefined;
  if (typeof validatedBy !== "string" || !hasUnvalidatedPlaceholder(validatedBy)) {
    return { path: "course_id", message: `${shown} was validated by a teacher: overwrite replaces only a self-study lesson nobody validated`, hint };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > PLACEHOLDER_EXCERPT_CHARS ? `${trimmed.slice(0, PLACEHOLDER_EXCERPT_CHARS)}…` : trimmed;
}

/** The value at a dotted path ("scenes.2.question") of `value`. */
function valueAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) =>
    current !== null && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
}
