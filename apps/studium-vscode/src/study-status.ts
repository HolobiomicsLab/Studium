// study-status.ts — VSC-6: what is due for review, shaped for the status bar and the sidebar's Reviews
// node. Fed by get_next_reinforcement {learner_id} (works without a live session, so a week-old learner
// sees their reviews on opening VS Code). Pure: no VS Code import.
import { hostPhrase } from "./host-phrases.js";
import type { Locale } from "./phrases.js";
import type { TreeNode } from "./lesson-tree.js";

export interface StudyStatus {
  /** Everything due for review: mastered concepts (`due`), concepts to take up again (`relearn`) and concepts no
   * graded answer measured (`unmeasured`) — the same set get_study_plan and start_review_session play (H3). */
  dueCount: number;
  counts: { due: number; relearn: number; unmeasured: number };
  /** Distinct due concept ids, most urgent first (due, then relearn, then unmeasured). */
  concepts: string[];
  /** How each concept is named to the learner (UX-06: a title, never the raw id) and which group it is in. */
  labels: Record<string, string>;
  groups: Record<string, ReviewGroup>;
  /** Epoch ms of the next review when none is due yet, else null. */
  nextDueAt: number | null;
  /** False for a learner who has never studied: nothing to review, nothing to announce. */
  hasHistory: boolean;
}

export type ReviewGroup = "due" | "relearn" | "unmeasured";
const GROUPS: readonly ReviewGroup[] = ["due", "relearn", "unmeasured"];

const EMPTY: StudyStatus = {
  dueCount: 0, counts: { due: 0, relearn: 0, unmeasured: 0 }, concepts: [], labels: {}, groups: {}, nextDueAt: null, hasHistory: false,
};

/** A concept title a target may carry (`concept_title`, or `concept` as review items name it). */
function targetTitle(target: unknown): string | undefined {
  const t = target as { concept_title?: unknown; concept?: unknown } | null;
  const title = typeof t?.concept_title === "string" ? t.concept_title : typeof t?.concept === "string" ? t.concept : "";
  return title.trim() ? title : undefined;
}

/** Read the get_next_reinforcement payload `{due, relearn, unmeasured, reason, next_due_at}` (an older server sends
 * `due` alone). Anything unrecognised is an empty status: the status bar is a convenience and must never throw into
 * the extension host. `titleOf` names a concept the payload does not title (the open lesson's own titles). */
export function parseReinforcement(payload: unknown, titleOf: (conceptId: string) => string | undefined = () => undefined): StudyStatus {
  if (!payload || typeof payload !== "object") return EMPTY;
  const p = payload as Record<string, unknown>;
  const counts = { due: 0, relearn: 0, unmeasured: 0 };
  const concepts: string[] = [];
  const labels: Record<string, string> = {};
  const groups: Record<string, ReviewGroup> = {};
  for (const group of GROUPS) {
    const list = Array.isArray(p[group]) ? p[group] as unknown[] : [];
    counts[group] = list.length;
    for (const target of list) {
      const id = (target as { concept_id?: unknown })?.concept_id;
      if (typeof id !== "string" || groups[id]) continue;
      concepts.push(id);
      groups[id] = group;
      const bare = id.replace(/^concept:/, "");
      labels[id] = targetTitle(target) ?? titleOf(id) ?? titleOf(bare) ?? bare;
    }
  }
  const dueCount = counts.due + counts.relearn + counts.unmeasured;
  return {
    dueCount, counts, concepts, labels, groups,
    nextDueAt: dueCount === 0 && typeof p.next_due_at === "number" ? p.next_due_at : null,
    hasHistory: p.reason === "due" || p.reason === "nothing_due" || dueCount > 0,
  };
}

/** The status-bar item, or null when nothing is due (the item is then hidden: no news is not shown). */
// H3 / I-3: each group in its own words, due first, singular for one.
const TOOLTIP_PHRASE = {
  due: ["status_tooltip_due_one", "status_tooltip_due"],
  relearn: ["status_tooltip_relearn_one", "status_tooltip_relearn"],
  unmeasured: ["status_tooltip_unmeasured_one", "status_tooltip_unmeasured"],
} as const;

/** BN-4: what the assistant is preparing a lesson from (library-watch.ts), shown while the lesson is not there yet. */
export interface Preparing { title: string }

/** BN-7: where list_lessons says a lesson lives: the lessons folder, the learner's library, or Studium's shipped lessons. */
export type ProgressSource = "bundles" | "library" | "shipped";
/** BN-7: one lesson's progress as list_lessons reports it for the learner (a new lesson has none). */
export interface LessonProgress { state: "in_progress" | "completed"; done: number; total: number }
/** BN-7: the lesson to continue: get_study_plan's newest in_progress entry that list_lessons still lists, with the root it
 * opens from and the minutes left (null when the lesson gives no duration). */
export interface ContinueLesson { ref: string; title: string; done: number; total: number; source: ProgressSource; minutesLeft: number | null }
/** BN-7: Continue, and the progress of each listed lesson keyed `<source>:<ref>` (progressKey). */
export interface StudyProgress { continueWith: ContinueLesson | null; lessons: Record<string, LessonProgress> }

const SOURCES: ReadonlySet<string> = new Set<ProgressSource>(["bundles", "library", "shipped"]);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function progressKey(source: ProgressSource, ref: string): string {
  return `${source}:${ref}`;
}

/** Minutes left in a lesson: its duration (metadata.duration_minutes) times the share of steps not done, rounded up and
 * at least 1; null when the duration is unknown or every step is done. */
export function minutesLeft(durationMinutes: unknown, done: number, total: number): number | null {
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  if (total <= 0 || done >= total) return null;
  return Math.max(1, Math.ceil((durationMinutes * (total - Math.max(0, done))) / total));
}

/** Read get_study_plan (`in_progress`, newest first) and list_lessons (`lessons`, `shipped_lessons`, each with `source` and
 * `status`) for one learner. A lesson list_lessons does not list (a community bundle, a deleted lesson) or whose steps
 * are all done is not offered to continue. Anything unrecognised gives no progress: never a throw. */
export function parseStudyProgress(
  plan: unknown, listing: unknown,
  durationOf: (ref: string, source: ProgressSource) => number | undefined = () => undefined,
): StudyProgress {
  const lessons: Record<string, LessonProgress> = {};
  const sourceOf = new Map<string, ProgressSource>();
  const l = listing && typeof listing === "object" ? listing as Record<string, unknown> : {};
  const listed = [...(Array.isArray(l["lessons"]) ? l["lessons"] : []), ...(Array.isArray(l["shipped_lessons"]) ? l["shipped_lessons"] : [])];
  for (const entry of listed) {
    const e = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const ref = typeof e["bundle_ref"] === "string" ? e["bundle_ref"] : "";
    const source = typeof e["source"] === "string" && SOURCES.has(e["source"]) ? e["source"] as ProgressSource : null;
    if (!ref || !source) continue;
    if (!sourceOf.has(ref)) sourceOf.set(ref, source);
    const s = e["status"] && typeof e["status"] === "object" ? e["status"] as Record<string, unknown> : {};
    const done = count(s["scenes_completed"]);
    const total = count(s["total_scenes"]);
    if ((s["state"] === "in_progress" || s["state"] === "completed") && done !== null && total !== null) {
      lessons[progressKey(source, ref)] = { state: s["state"], done, total };
    }
  }
  const p = plan && typeof plan === "object" ? plan as Record<string, unknown> : {};
  for (const item of Array.isArray(p["in_progress"]) ? p["in_progress"] : []) {
    const i = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const ref = typeof i["bundle_ref"] === "string" ? i["bundle_ref"] : "";
    const done = count(i["scenes_completed"]);
    const total = count(i["total_scenes"]);
    const source = sourceOf.get(ref);
    if (!ref || !source || done === null || total === null || done >= total) continue;
    const title = typeof i["title"] === "string" && i["title"].trim() ? i["title"].trim() : ref;
    let duration: number | undefined;
    try { duration = durationOf(ref, source); } catch { duration = undefined; }
    return { continueWith: { ref, title, done, total, source, minutesLeft: minutesLeft(duration, done, total) }, lessons };
  }
  return { continueWith: null, lessons };
}

/** The command arguments that open the lesson to continue from its own root (studium.openLesson). */
export function continueArgs(c: Pick<ContinueLesson, "ref" | "source">): unknown[] {
  return c.source === "bundles" ? [c.ref] : [c.ref, c.source];
}

/** What the Continue entry and the status bar say on hover: the next step, the minutes left when known, and whose
 * progress this is (VS Code's own: progress made with other assistants is not in it). */
export function continueTooltip(c: Pick<ContinueLesson, "title" | "done" | "total" | "minutesLeft">, locale: Locale): string {
  return [
    hostPhrase("status_tooltip_continue", { title: c.title, step: c.done + 1, total: c.total }, locale),
    c.minutesLeft === null ? "" : hostPhrase("continue_minutes_left", { minutes: c.minutesLeft }, locale),
    hostPhrase("continue_scope", {}, locale),
  ].filter(Boolean).join(" ");
}

const STATUS_TITLE_MAX = 40;

export function statusBarText(
  status: StudyStatus | null, locale: Locale, lessonLine?: string | null, preparing?: Preparing | null,
  continueWith?: Pick<ContinueLesson, "title" | "done" | "total" | "minutesLeft"> | null,
): { text: string; tooltip: string; resume?: true } | null {
  // INT-STUDIUM-058: while a lesson plays, the bar shows the lesson's own status line (the view's
  // status_line); what is due moves to the tooltip. One line, no control character (\p{Cc}: U+0000 to
  // U+001F and U+007F to U+009F).
  const line = (lessonLine ?? "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (line) {
    const due = statusBarText(status, locale);
    return { text: line, tooltip: due ? due.tooltip : hostPhrase("status_tooltip_lesson", {}, locale) };
  }
  // BN-4: a lesson being prepared outranks the review count while it lasts (minutes); the count moves to the tooltip.
  if (preparing) {
    const source = preparing.title.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
    const lead = source
      ? hostPhrase("status_tooltip_preparing", { source }, locale)
      : hostPhrase("status_tooltip_preparing_untitled", {}, locale);
    const due = statusBarText(status, locale);
    return {
      text: hostPhrase("status_preparing", {}, locale),
      tooltip: [`${lead} ${hostPhrase("status_tooltip_preparing_wait", {}, locale)}`, due?.tooltip].filter(Boolean).join("\n"),
    };
  }
  if (!status || status.dueCount === 0) {
    // BN-7: with nothing due, the rule « no news is not shown » gives way to one piece of news: the lesson in progress.
    // Clicking the item then resumes it (resume).
    if (!continueWith) return null;
    const title = continueWith.title.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
    const short = title.length > STATUS_TITLE_MAX ? `${title.slice(0, STATUS_TITLE_MAX - 1).trimEnd()}…` : title;
    return { text: hostPhrase("status_continue", { title: short }, locale), tooltip: continueTooltip({ ...continueWith, title }, locale), resume: true };
  }
  const counts = status.counts;
  const groups = GROUPS.filter((group) => counts[group] > 0)
    .map((group) => hostPhrase(TOOLTIP_PHRASE[group][counts[group] === 1 ? 0 : 1], { count: counts[group] }, locale));
  const onlyDue = counts.relearn === 0 && counts.unmeasured === 0;
  return {
    // A relearn or unmeasured concept is not a review of something learnt: the bar then says « à travailler ».
    text: hostPhrase(onlyDue ? "status_due" : "status_pending", { count: status.dueCount }, locale),
    tooltip: hostPhrase("status_tooltip", { groups: groups.join(", ") }, locale),
  };
}

const GROUP_PHRASE = { due: "reviews_group_due", relearn: "reviews_group_relearn", unmeasured: "reviews_group_unmeasured" } as const;

/** The sidebar's Reviews node, or null for a learner with no history. `formatDate` is injectable for tests. */
export function reviewsNode(
  status: StudyStatus | null,
  locale: Locale,
  formatDate: (epochMs: number) => string = (ms) => new Date(ms).toLocaleDateString(locale, { dateStyle: "medium" }),
): TreeNode | null {
  if (!status || !status.hasHistory) return null;
  const label = hostPhrase("reviews_label", {}, locale);
  if (status.dueCount > 0) {
    // Only several groups need telling apart; a list of mastered concepts alone reads as before.
    const mixed = status.counts.relearn + status.counts.unmeasured > 0;
    return {
      id: "reviews", label, icon: "history",
      description: hostPhrase("reviews_due", { count: status.dueCount }, locale),
      children: status.concepts.map((concept) => ({
        id: `review:${concept}`, label: status.labels[concept] ?? concept.replace(/^concept:/, ""), icon: "circle-small",
        ...(mixed ? { description: hostPhrase(GROUP_PHRASE[status.groups[concept] ?? "due"], {}, locale) } : {}),
      })),
    };
  }
  const children: TreeNode[] = [{ id: "reviews:none", label: hostPhrase("reviews_none", {}, locale), icon: "check" }];
  if (status.nextDueAt !== null) {
    children.push({ id: "reviews:next", label: hostPhrase("reviews_next", { date: formatDate(status.nextDueAt) }, locale), icon: "calendar" });
  }
  return { id: "reviews", label, icon: "history", children };
}

/** What the pane is told when « Réviser maintenant » (start_review_session) did not start a review: nothing due
 * is an `action_notice` naming the next review date in the lesson's language (or that none is scheduled); any
 * other reply is an `action_error`, in the server's words or a host phrase, never empty. `formatDate` is
 * injectable for tests. */
export function reviewStartReply(
  reply: unknown,
  locale: Locale,
  formatDate: (epochMs: number) => string = (ms) =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "full" }).format(ms),
): { type: "action_notice" | "action_error"; message: string } {
  const r = reply && typeof reply === "object" ? reply as { status?: unknown; next_review_at?: unknown; display_markdown?: unknown } : {};
  if (r.status === "nothing_due") {
    const next = typeof r.next_review_at === "number" && Number.isFinite(r.next_review_at) ? r.next_review_at : null;
    return {
      type: "action_notice",
      message: next === null
        ? hostPhrase("review_nothing_scheduled", {}, locale)
        : hostPhrase("review_nothing_due", { date: formatDate(next) }, locale),
    };
  }
  const text = typeof r.display_markdown === "string" ? r.display_markdown.trim() : "";
  return { type: "action_error", message: text || hostPhrase("review_unavailable", {}, locale) };
}
