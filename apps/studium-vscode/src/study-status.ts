// study-status.ts — VSC-6: what is due for review, shaped for the status bar and the sidebar's Reviews
// node. Fed by get_next_reinforcement {learner_id} (works without a live session, so a week-old learner
// sees their reviews on opening VS Code). Pure: no VS Code import.
import { hostPhrase } from "./host-phrases.js";
import type { Locale } from "./phrases.js";
import type { TreeNode } from "./lesson-tree.js";

export interface StudyStatus {
  dueCount: number;
  /** Distinct due concept ids, most urgent first. */
  concepts: string[];
  /** Epoch ms of the next review when none is due yet, else null. */
  nextDueAt: number | null;
  /** False for a learner who has never studied: nothing to review, nothing to announce. */
  hasHistory: boolean;
}

const EMPTY: StudyStatus = { dueCount: 0, concepts: [], nextDueAt: null, hasHistory: false };

/** Read the get_next_reinforcement payload `{due, reason, next_due_at}`. Anything unrecognised is an empty
 * status: the status bar is a convenience and must never throw into the extension host. */
export function parseReinforcement(payload: unknown): StudyStatus {
  if (!payload || typeof payload !== "object") return EMPTY;
  const p = payload as { due?: unknown; reason?: unknown; next_due_at?: unknown };
  const due = Array.isArray(p.due) ? p.due : [];
  const concepts = [...new Set(due.map((t) => (t as { concept_id?: unknown })?.concept_id).filter((c): c is string => typeof c === "string"))];
  return {
    dueCount: due.length,
    concepts,
    nextDueAt: typeof p.next_due_at === "number" ? p.next_due_at : null,
    hasHistory: p.reason === "due" || p.reason === "nothing_due",
  };
}

/** The status-bar item, or null when nothing is due (the item is then hidden: no news is not shown). */
export function statusBarText(status: StudyStatus | null, locale: Locale): { text: string; tooltip: string } | null {
  if (!status || status.dueCount === 0) return null;
  const params = { count: status.dueCount };
  return { text: hostPhrase("status_due", params, locale), tooltip: hostPhrase("status_tooltip_due", params, locale) };
}

/** The sidebar's Reviews node, or null for a learner with no history. `formatDate` is injectable for tests. */
export function reviewsNode(
  status: StudyStatus | null,
  locale: Locale,
  formatDate: (epochMs: number) => string = (ms) => new Date(ms).toLocaleDateString(locale, { dateStyle: "medium" }),
): TreeNode | null {
  if (!status || !status.hasHistory) return null;
  const label = hostPhrase("reviews_label", {}, locale);
  if (status.dueCount > 0) {
    return {
      id: "reviews", label, icon: "history",
      description: hostPhrase("reviews_due", { count: status.dueCount }, locale),
      children: status.concepts.map((concept) => ({ id: `review:${concept}`, label: concept, icon: "circle-small" })),
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
