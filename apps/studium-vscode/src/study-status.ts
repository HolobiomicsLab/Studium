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

export function statusBarText(
  status: StudyStatus | null, locale: Locale, lessonLine?: string | null,
): { text: string; tooltip: string } | null {
  // INT-STUDIUM-058: while a lesson plays, the bar shows the lesson's own status line (the view's
  // status_line); what is due moves to the tooltip. One line, no control character (\p{Cc}: U+0000 to
  // U+001F and U+007F to U+009F).
  const line = (lessonLine ?? "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (line) {
    const due = statusBarText(status, locale);
    return { text: line, tooltip: due ? due.tooltip : hostPhrase("status_tooltip_lesson", {}, locale) };
  }
  if (!status || status.dueCount === 0) return null;
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
