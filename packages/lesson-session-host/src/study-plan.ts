// packages/lesson-session-host/src/study-plan.ts
//
// The one "what should I study now" answer (HJ-5, SL-2, R2): reviews due, concepts to relearn,
// lessons in progress, the next lesson, and one sentence saying what to do now — computed from the
// learner's first-class FSRS memory, their study record and the lessons on disk. Pure.
//
// Three review categories, one schedule (HJ-1 point 3, lead decision I-3):
//   due         a concept mastered earlier (mastery >= FSRS minMastery) whose recall is due — the
//               engine's dueForReinforcement, most urgent first;
//   relearn     a reviewed concept still below that mastery AFTER graded attempts, whose review is due
//               (a lapse, or a lesson finished without consolidating it);
//   unmeasured  a reviewed concept below that mastery that no graded attempt ever measured — only
//               self-rated (C4): its review is due, but nothing says it is weak, so it is shown as
//               « due for review » (fr « À revoir »), never as one to relearn.
// `next_due_at` is the earliest FUTURE review of any kind, so it is never in the past while
// nothing is listed (it used to be computed over every concept while `due` excluded the weak ones).
//
// Every date is a day in one time zone, the host's (calendar.ts, RFR-13): due_date and
// next_review_date name the day display_markdown prints. The next step's arguments carry the plan's
// language to the tool that takes one (L-4). With the minutes a day the learner said they have
// (RFR-06), the next step says how long it takes: a lesson longer than that is proposed in several
// sittings, and a review session longer than that is cut with max_items.
import { nextCourseLesson } from "@studium/lesson-bundle-schema";
import { dueAt, dueForReinforcement, isDue, retrievability, type ConceptMemoryState } from "./fsrs-memory.js";
import { formatReviewDate, type DisplayLocale } from "./chat-display.js";
import { calendarDate, localTimeZone } from "./calendar.js";
import { DEFAULT_REVIEW_ITEMS } from "./review-session.js";
import type { Catalog, CatalogLesson } from "./lesson-catalog.js";
import type { StudyRecord } from "./study-record.js";
import { frenchSpacing } from "../../lesson-session/src/phrases.js";

/** FSRS reinforcement's mastery gate (dueForReinforcement's default minMastery). */
export const REVIEW_MIN_MASTERY = 0.6;

export interface ScheduledConcept { concept_id: string; due_at: number; retrievability: number }

export interface ReviewSchedule {
  /** Mastered and due, most urgent first (the engine's order). */
  due: ScheduledConcept[];
  /** Reviewed, measured (graded attempts) below the mastery gate, and due, earliest first. */
  relearn: ScheduledConcept[];
  /** Reviewed, below the gate with no graded attempt (self-rated only), and due, earliest first. */
  unmeasured: ScheduledConcept[];
  /** Earliest review still in the future, or null. */
  next_due_at: number | null;
  /** Any concept with at least one review. */
  has_history: boolean;
}

/** `measured`: the concepts at least one graded attempt measured (ConceptState.total_attempts > 0). */
export function scheduleFromMemory(
  memory: Readonly<Record<string, ConceptMemoryState>>,
  mastery: Readonly<Record<string, number>>,
  nowMs: number,
  measured: ReadonlySet<string>,
): ReviewSchedule {
  const reviewed = Object.values(memory).filter((m) => m.reps > 0);
  const item = (m: ConceptMemoryState): ScheduledConcept =>
    ({ concept_id: m.concept_id, due_at: dueAt(m), retrievability: retrievability(m, nowMs) });
  const due = dueForReinforcement(memory, mastery, nowMs, { minMastery: REVIEW_MIN_MASTERY })
    .map((id) => item(memory[id] as ConceptMemoryState));
  const belowGate = reviewed
    .filter((m) => (mastery[m.concept_id] ?? 0) < REVIEW_MIN_MASTERY && isDue(m, nowMs))
    .map(item)
    .sort((a, b) => a.due_at - b.due_at);
  const relearn = belowGate.filter((s) => measured.has(s.concept_id));
  const unmeasured = belowGate.filter((s) => !measured.has(s.concept_id));
  const future = reviewed.filter((m) => !isDue(m, nowMs)).map((m) => dueAt(m));
  return {
    due, relearn, unmeasured,
    next_due_at: future.length ? Math.min(...future) : null,
    has_history: reviewed.length > 0,
  };
}

export interface StudyItem {
  concept_id: string;
  /** The concept's title in the lesson it was learned in, else its id. */
  concept: string;
  lesson: { bundle_ref: string; title: string } | null;
  scene_id: string | null;
  due_at: number;
  /** yyyy-mm-dd, the day of due_at in the server's time zone (get_server_info.time_zone): the day
   * display_markdown prints. */
  due_date: string;
  /** start_review_session has a scene to replay it with (a retrieval scene playable outside its
   * lesson). An unplayable concept stays listed but never becomes the next step. */
  playable: boolean;
}

export interface StudyPlan {
  due_reviews: StudyItem[];
  /** Concepts graded below the mastery gate, due again (« À reprendre » / "To relearn"). */
  relearn: StudyItem[];
  /** Concepts due for review that no graded attempt measured — self-rated only (« À revoir » /
   * "Due for review"): never called weak (lead decision I-3). */
  unmeasured_reviews: StudyItem[];
  in_progress: Array<{ bundle_ref: string; title: string; scenes_completed: number; total_scenes: number }>;
  next_lesson: { bundle_ref: string; title: string } | null;
  next_review_at: number | null;
  next_review_date: string | null;
  /** RFR-06: the minutes a day the learner said they have (their study record, else the self-study
   * lesson the plan proposes), or null. */
  minutes_per_day: number | null;
  next_step: {
    action: "review" | "continue" | "start" | "author" | "wait";
    tool: string | null;
    /** The call's arguments: learner_id when the caller named one, bundle_ref for a lesson, language
     * for start_review_session and get_authoring_guide (L-4), max_items for a review cut to the
     * learner's minutes a day. */
    arguments: Record<string, string | number>;
    text: string;
    /** RFR-06, with minutes_per_day: about how long the step takes (what is left of a lesson in
     * progress; a review as cut by max_items). */
    estimated_minutes?: number;
  };
  display_markdown: string;
}

export interface StudyPlanInput {
  nowMs: number;
  memory: Readonly<Record<string, ConceptMemoryState>>;
  mastery: Readonly<Record<string, number>>;
  record: StudyRecord;
  completedLessons: readonly string[];
  catalog: Catalog;
  locale: DisplayLocale;
  /** Echoed into the suggested tool call only when the caller named a learner. */
  learnerId?: string;
  /** The due or relearn concepts start_review_session can play now — decided by the host with the
   * same lesson lookup and scene choice the review session uses (reviewSources + pickReviewScene). */
  playableReviews: ReadonlySet<string>;
  /** For each playable review, the lesson and scene start_review_session plays it from (L-8): the
   * item names them, so the plan and the review agree. Absent ⇒ the lesson it was last graded in, else
   * the first lesson on disk that lists it. */
  reviewFrom?: ReadonlyMap<string, { bundle_ref: string; title: string; scene_id: string }>;
  /** The concepts a graded attempt measured (ConceptState.total_attempts > 0); see scheduleFromMemory. */
  measured: ReadonlySet<string>;
  /** The time zone every date is taken in (calendar.ts): the host's. Absent ⇒ the machine's. */
  timeZone?: string;
  /** RFR-06: the learner's minutes a day when the caller knows it; else the study record's, else the
   * one kept in the self-study lesson the plan proposes (CatalogLesson.minutes_per_day). */
  minutesPerDay?: number;
  /** RFR-06: each playable review's estimated seconds (its review scene's estimated_seconds); a
   * review without one counts DEFAULT_REVIEW_SECONDS. */
  reviewSeconds?: ReadonlyMap<string, number>;
}

/** What a review scene takes when nothing says (RFR-06's estimate of a review session). */
export const DEFAULT_REVIEW_SECONDS = 60;

const PLAN = {
  fr: {
    heading: "### Ton plan d'étude",
    due_heading: "**À réviser**",
    relearn_heading: "**À reprendre**",
    unmeasured_heading: "**À revoir**",
    progress_heading: "**En cours**",
    next_heading: "**Leçon suivante**",
    due_line: "- {concept} — prévu le {date}{lesson}",
    overdue_line: "- {concept} — en retard depuis le {date}{lesson}",
    lesson_suffix: " (leçon « {title} »)",
    unplayable_suffix: " — aucune question de révision ne la reprend pour l'instant",
    progress_line_one: "- « {title} » : {done} étape sur {total}",
    progress_line_many: "- « {title} » : {done} étapes sur {total}",
    next_line: "- « {title} »",
    now: "**Maintenant :** {text}",
    review_one: "tu as 1 notion à revoir ({list}). Lance une séance de révision.",
    review_many: "tu as {count} notions à revoir ({list}). Lance une séance de révision.",
    continue: "reprends « {title} » là où tu t'étais arrêté·e.",
    start: "commence « {title} ».",
    author: "aucune leçon n'est encore disponible. Choisis un sujet et tes sources : l'assistant prépare une leçon avec toi.",
    wait: "rien à revoir pour l'instant.",
    wait_next: "rien à revoir pour l'instant. Prochaine révision : {date}.",
    lesson_fits: "Elle dure environ {minutes} minutes, dans tes {budget} minutes par jour.",
    lesson_split: "Elle dure environ {minutes} minutes : avec tes {budget} minutes par jour, fais-la en {sittings} fois.",
    left_fits: "Il en reste environ {minutes} minutes, dans tes {budget} minutes par jour.",
    left_split: "Il en reste environ {minutes} minutes : avec tes {budget} minutes par jour, finis-la en {sittings} fois.",
    review_fits: "Elle dure environ {minutes} minutes, dans tes {budget} minutes par jour.",
    review_cut: "Avec tes {budget} minutes par jour, elle en reprend {count} aujourd'hui (environ {minutes} minutes).",
  },
  en: {
    heading: "### Your study plan",
    due_heading: "**To review**",
    relearn_heading: "**To relearn**",
    unmeasured_heading: "**Due for review**",
    progress_heading: "**In progress**",
    next_heading: "**Next lesson**",
    due_line: "- {concept} — due {date}{lesson}",
    overdue_line: "- {concept} — overdue since {date}{lesson}",
    lesson_suffix: " (lesson “{title}”)",
    unplayable_suffix: " — no review question covers it yet",
    progress_line_one: "- “{title}”: {done} of {total} step",
    progress_line_many: "- “{title}”: {done} of {total} steps",
    next_line: "- “{title}”",
    now: "**Now:** {text}",
    review_one: "you have 1 concept to review ({list}). Start a review session.",
    review_many: "you have {count} concepts to review ({list}). Start a review session.",
    continue: "pick up “{title}” where you left off.",
    start: "start “{title}”.",
    author: "no lesson is available yet. Choose a topic and your sources: the assistant prepares a lesson with you.",
    wait: "nothing to review right now.",
    wait_next: "nothing to review right now. Next review: {date}.",
    lesson_fits: "It takes about {minutes} minutes, within your {budget} minutes a day.",
    lesson_split: "It takes about {minutes} minutes: with your {budget} minutes a day, take it in {sittings} sittings.",
    left_fits: "About {minutes} minutes are left, within your {budget} minutes a day.",
    left_split: "About {minutes} minutes are left: with your {budget} minutes a day, take them in {sittings} sittings.",
    review_fits: "It takes about {minutes} minutes, within your {budget} minutes a day.",
    review_cut: "With your {budget} minutes a day, it takes {count} of them today (about {minutes} minutes).",
  },
} as const;

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/g, (token, name: string) => (params[name] === undefined ? token : String(params[name])));
}

/** A recorded lesson is still there when the catalog lists it. The catalog does not list community
 * .zip bundles, so a route to one is trusted as is. */
function stillThere(bundleRef: string, input: StudyPlanInput): boolean {
  return bundleRef.endsWith(".zip") || input.catalog.lessons.some((l) => l.bundle_ref === bundleRef);
}

/** The lesson a concept is reviewed from — the lesson and scene it was last graded in while that
 * lesson is still there, else a lesson on disk whose concepts list it — or null when none is left
 * (the same choice start_review_session makes). */
function lessonFor(conceptId: string, input: StudyPlanInput): { lesson: StudyItem["lesson"]; scene_id: string | null; concept: string } {
  const route = input.record.concepts[conceptId];
  const listing = input.catalog.lessons.find((l) => l.concepts.some((c) => c.id === conceptId));
  const concept = input.catalog.lessons.flatMap((l) => l.concepts).find((c) => c.id === conceptId)?.title ?? conceptId;
  if (route && stillThere(route.bundle_ref, input)) {
    return { lesson: { bundle_ref: route.bundle_ref, title: route.lesson_title }, scene_id: route.scene_id, concept };
  }
  return { lesson: listing ? { bundle_ref: listing.bundle_ref, title: listing.title } : null, scene_id: null, concept };
}

function toItem(s: ScheduledConcept, input: StudyPlanInput, timeZone: string): StudyItem {
  const where = lessonFor(s.concept_id, input);
  const from = input.reviewFrom?.get(s.concept_id);
  return {
    concept_id: s.concept_id, concept: where.concept,
    lesson: from ? { bundle_ref: from.bundle_ref, title: from.title } : where.lesson,
    scene_id: from ? from.scene_id : where.scene_id,
    due_at: Math.round(s.due_at), due_date: calendarDate(s.due_at, timeZone),
    playable: from !== undefined || (where.lesson !== null && input.playableReviews.has(s.concept_id)),
  };
}

/** RFR-06: the learner's minutes a day — given, kept in their study record, else kept in the
 * self-study lesson the plan proposes, else in the newest lesson of their library that keeps one. */
function dailyBudget(input: StudyPlanInput, proposed: readonly (string | undefined)[]): number | null {
  if (input.minutesPerDay !== undefined) return input.minutesPerDay;
  if (input.record.minutes_per_day !== undefined) return input.record.minutes_per_day;
  const byRef = (ref: string | undefined) => input.catalog.lessons.find((l) => l.bundle_ref === ref);
  const own = proposed.map(byRef).find((l) => l?.minutes_per_day !== undefined);
  const library = input.catalog.lessons.filter((l) => l.root === "library" && l.minutes_per_day !== undefined)
    .sort((a, b) => b.modified_at - a.modified_at)[0];
  return own?.minutes_per_day ?? library?.minutes_per_day ?? null;
}

/** The sentence a lesson step gets with a daily budget: how long it takes, in how many sittings. */
function lessonBudgetText(t: (typeof PLAN)[DisplayLocale], minutes: number, budget: number, left: boolean): string {
  const sittings = Math.ceil(minutes / budget);
  const key = sittings > 1 ? (left ? "left_split" : "lesson_split") : (left ? "left_fits" : "lesson_fits");
  return fill(t[key], { minutes, budget, sittings });
}

/** The next lesson: a course's next unlocked lesson (a course the learner has started first), else the
 * most recent lesson they have not opened yet — from their own library first, then the bundles root. */
function nextLesson(input: StudyPlanInput, started: ReadonlySet<string>): CatalogLesson | null {
  const known = (id: string) => started.has(id) || input.completedLessons.includes(id);
  const byId = new Map(input.catalog.lessons.map((l) => [l.bundle_id, l]));
  const courses = [...input.catalog.courses].sort((a, b) =>
    Number(b.course.lessons.some((l) => known(l.lesson_id))) - Number(a.course.lessons.some((l) => known(l.lesson_id))));
  for (const { course } of courses) {
    const next = nextCourseLesson(course, input.completedLessons);
    const listed = next ? byId.get(next.lesson_id) : undefined;
    if (listed && !started.has(listed.bundle_id)) return listed;
  }
  const unopened = input.catalog.lessons.filter((l) => !known(l.bundle_id)).sort((a, b) => b.modified_at - a.modified_at);
  return unopened.find((l) => l.root === "library") ?? unopened[0] ?? null;
}

export function buildStudyPlan(input: StudyPlanInput): StudyPlan {
  const t = PLAN[input.locale];
  const timeZone = input.timeZone ?? localTimeZone();
  const schedule = scheduleFromMemory(input.memory, input.mastery, input.nowMs, input.measured);
  const due = schedule.due.map((s) => toItem(s, input, timeZone));
  const relearn = schedule.relearn.map((s) => toItem(s, input, timeZone));
  const unmeasured = schedule.unmeasured.map((s) => toItem(s, input, timeZone));
  const inProgress = Object.values(input.record.lessons)
    .filter((l) => !l.completed && l.scenes_completed > 0 && !input.completedLessons.includes(l.bundle_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((l) => ({ bundle_ref: l.bundle_ref, title: l.title, scenes_completed: l.scenes_completed, total_scenes: l.total_scenes }));
  const started = new Set(Object.keys(input.record.lessons));
  const next = nextLesson(input, started);
  const learner: Record<string, string> = input.learnerId ? { learner_id: input.learnerId } : {};
  const budget = dailyBudget(input, [inProgress[0]?.bundle_ref, next?.bundle_ref]);
  const durationOf = (ref: string) => input.catalog.lessons.find((l) => l.bundle_ref === ref)?.duration_minutes;

  let nextStep: StudyPlan["next_step"];
  // A review no scene can play (its lesson is gone, or teaches it only through scenes a review cannot
  // replay) stays listed but never becomes the next step: the review session would answer it with
  // « nothing to review », the memory would never move, and the learner would be sent back every day.
  const reviewItems = [...due, ...relearn, ...unmeasured].filter((i) => i.playable);
  if (reviewItems.length) {
    const text = fill(reviewItems.length === 1 ? t.review_one : t.review_many,
      { count: reviewItems.length, list: reviewItems.map((i) => i.concept).join(", ") });
    nextStep = { action: "review", tool: "start_review_session", arguments: { ...learner, language: input.locale }, text };
    if (budget !== null) {
      // The session takes its items in this order, DEFAULT_REVIEW_ITEMS of them unless told otherwise.
      const seconds = reviewItems.slice(0, DEFAULT_REVIEW_ITEMS)
        .map((i) => input.reviewSeconds?.get(i.concept_id) ?? DEFAULT_REVIEW_SECONDS);
      let count = 0;
      let total = 0;
      for (const s of seconds) {
        if (count > 0 && total + s > budget * 60) break;
        count += 1;
        total += s;
      }
      const minutes = Math.max(1, Math.ceil(total / 60));
      const cut = count < seconds.length;
      if (cut) nextStep.arguments["max_items"] = count;
      nextStep.estimated_minutes = minutes;
      nextStep.text = `${text} ${fill(cut ? t.review_cut : t.review_fits, { budget, count, minutes })}`;
    }
  } else if (inProgress[0]) {
    const current = inProgress[0];
    nextStep = { action: "continue", tool: "start_lesson_session", arguments: { bundle_ref: current.bundle_ref, ...learner },
      text: fill(t.continue, { title: current.title }) };
    const duration = durationOf(current.bundle_ref);
    if (budget !== null && duration !== undefined && current.total_scenes > 0) {
      const minutes = Math.max(1, Math.ceil(duration * (current.total_scenes - current.scenes_completed) / current.total_scenes));
      nextStep.estimated_minutes = minutes;
      nextStep.text = `${nextStep.text} ${lessonBudgetText(t, minutes, budget, true)}`;
    }
  } else if (next) {
    nextStep = { action: "start", tool: "start_lesson_session", arguments: { bundle_ref: next.bundle_ref, ...learner },
      text: fill(t.start, { title: next.title }) };
    if (budget !== null && next.duration_minutes !== undefined) {
      nextStep.estimated_minutes = next.duration_minutes;
      nextStep.text = `${nextStep.text} ${lessonBudgetText(t, next.duration_minutes, budget, false)}`;
    }
  } else if (input.catalog.lessons.length === 0) {
    nextStep = { action: "author", tool: "get_authoring_guide", arguments: { language: input.locale }, text: t.author };
  } else {
    nextStep = { action: "wait", tool: null, arguments: {},
      text: schedule.next_due_at !== null
        ? fill(t.wait_next, { date: formatReviewDate(schedule.next_due_at, input.locale, timeZone) }) : t.wait };
  }

  const line = (i: StudyItem) => fill(i.due_at < input.nowMs ? t.overdue_line : t.due_line, {
    concept: i.concept, date: formatReviewDate(i.due_at, input.locale, timeZone),
    lesson: (i.lesson ? fill(t.lesson_suffix, { title: i.lesson.title }) : "") + (i.playable ? "" : t.unplayable_suffix),
  });
  const sections = [
    t.heading,
    due.length ? `${t.due_heading}\n\n${due.map(line).join("\n")}` : "",
    relearn.length ? `${t.relearn_heading}\n\n${relearn.map(line).join("\n")}` : "",
    unmeasured.length ? `${t.unmeasured_heading}\n\n${unmeasured.map(line).join("\n")}` : "",
    inProgress.length ? `${t.progress_heading}\n\n${inProgress.map((l) => fill(
      (input.locale === "en" ? l.total_scenes : l.scenes_completed) === 1 ? t.progress_line_one : t.progress_line_many,
      { title: l.title, done: l.scenes_completed, total: l.total_scenes },
    )).join("\n")}` : "",
    next && nextStep.action !== "start" ? `${t.next_heading}\n\n${fill(t.next_line, { title: next.title })}` : "",
    fill(t.now, { text: nextStep.text }),
  ].filter(Boolean);

  if (input.locale === "fr") nextStep.text = frenchSpacing(nextStep.text);
  const displayMarkdown = sections.join("\n\n");
  return {
    due_reviews: due,
    relearn,
    unmeasured_reviews: unmeasured,
    in_progress: inProgress,
    next_lesson: next ? { bundle_ref: next.bundle_ref, title: next.title } : null,
    next_review_at: schedule.next_due_at === null ? null : Math.round(schedule.next_due_at),
    next_review_date: schedule.next_due_at === null ? null : calendarDate(schedule.next_due_at, timeZone),
    minutes_per_day: budget,
    next_step: nextStep,
    display_markdown: input.locale === "fr" ? frenchSpacing(displayMarkdown) : displayMarkdown,
  };
}
