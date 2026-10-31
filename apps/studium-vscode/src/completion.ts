// completion.ts — L-6: the end-of-lesson lists, as honest as the host's chat text. A concept is "consolidated"
// only with at least MIN_MASTERY_ATTEMPTS graded answers and a mastery at or above REVIEW_MIN_MASTERY (the
// study plan's threshold); below that, a graded concept was "practised (n answers)"; a concept no graded answer
// measured is "not measured yet". The host computes this split (lesson-session-host chat-display.ts); the
// extension reads it from the transition when the host sends it and only falls back to the same rule for an
// older host. The two constants MIRROR the host packages (the extension cannot import them):
// completion.driver.ts pins them against packages/lesson-session/src/graph-nav.ts and
// packages/lesson-session-host/src/study-plan.ts. Pure: no VS Code import.

/** packages/lesson-session/src/graph-nav.ts MIN_MASTERY_ATTEMPTS. */
export const MIN_MASTERY_ATTEMPTS = 3;
/** packages/lesson-session-host/src/study-plan.ts REVIEW_MIN_MASTERY. */
export const REVIEW_MIN_MASTERY = 0.6;

export interface CompletionSplit {
  consolidated: string[];
  practised: Array<{ id: string; answers: number }>;
  not_measured: string[];
}

type Json = Record<string, any>;

const idOf = (entry: unknown): string | null => {
  if (typeof entry === "string") return entry;
  const e = entry as { concept_id?: unknown; id?: unknown } | null;
  return typeof e?.concept_id === "string" ? e.concept_id : typeof e?.id === "string" ? e.id : null;
};
const answersOf = (entry: unknown): number | null => {
  const e = entry as { answers?: unknown; graded_answers?: unknown; attempts?: unknown } | null;
  const n = [e?.answers, e?.graded_answers, e?.attempts].find((v) => typeof v === "number" && Number.isFinite(v));
  return typeof n === "number" ? n : null;
};

/** The host's split when the transition carries one (`completion`, or `summary.completion`), else null. */
function servedSplit(t: Json, attempts: (id: string) => number): CompletionSplit | null {
  const served = (t?.completion ?? t?.summary?.completion) as Json | undefined;
  if (!served || typeof served !== "object" || !Array.isArray(served.consolidated)) return null;
  const ids = (list: unknown) => (Array.isArray(list) ? list : []).map(idOf).filter((id): id is string => id !== null);
  return {
    consolidated: ids(served.consolidated),
    practised: (Array.isArray(served.practised) ? served.practised : [])
      .map((entry: unknown) => {
        const id = idOf(entry);
        return id === null ? null : { id, answers: answersOf(entry) ?? attempts(id) };
      })
      .filter((p: { id: string; answers: number } | null): p is { id: string; answers: number } => p !== null),
    not_measured: ids(served.not_measured),
  };
}

/** The completion split of a `complete` transition: the host's, else the same rule over its summary. */
export function completionSplit(t: Json): CompletionSplit {
  const states: Record<string, Json> = t?.summary?.finalState?.concept_states ?? {};
  const attempts = (id: string) => Number(states[id]?.total_attempts ?? 0) || 0;
  const served = servedSplit(t, attempts);
  if (served) return served;
  const mastery: Record<string, number | null> = t?.summary?.mastery ?? {};
  const split: CompletionSplit = { consolidated: [], practised: [], not_measured: [] };
  for (const id of Object.keys(mastery)) {
    const n = attempts(id);
    const m = mastery[id];
    if (n === 0 || typeof m !== "number") split.not_measured.push(id);
    else if (n >= MIN_MASTERY_ATTEMPTS && m >= REVIEW_MIN_MASTERY) split.consolidated.push(id);
    else split.practised.push({ id, answers: n });
  }
  return split;
}

/** A finished lesson's review plan as the host sends it on the complete transition: its earliest review and the
 * lesson's reviewed concepts, earliest first. */
export interface LessonReviewPlan { next_due_at: number | null; concepts: string[] }

/** UX-11: the lesson's earliest review once the learner rated the last answer, for the end screen — never the
 * cross-lesson reinforcement date. Inputs: the plan the complete transition carried and rate_recall's reply (its
 * own `review_plan` when the host sends one, else the rated concept(s) and their new date). Output: the date, or
 * undefined when it cannot be known without the other concepts' dates (the end screen then keeps its date). */
export function lessonNextReviewAfterRating(plan: LessonReviewPlan | null | undefined, rated: Json): number | undefined {
  const served = rated?.review_plan?.next_due_at;
  if (typeof served === "number") return served;
  const at = rated?.next_review_at;
  if (typeof at !== "number") return undefined;
  const ratedIds = new Set<string>(Array.isArray(rated.concept_ids) ? rated.concept_ids : typeof rated.concept_id === "string" ? [rated.concept_id] : []);
  const concepts = Array.isArray(plan?.concepts) ? plan!.concepts : [];
  const previous = plan?.next_due_at;
  if (typeof previous !== "number" || !concepts.length || concepts.every((id) => ratedIds.has(id))) return at;
  // The earliest concept was not rated: it still holds `previous`, so the lesson's earliest is the sooner date.
  if (!ratedIds.has(concepts[0]!)) return Math.min(previous, at);
  // It was rated: the other concepts were due no sooner than `previous`, so a sooner rating stays the earliest;
  // a later one leaves the earliest among concepts whose dates this reply does not carry.
  return at <= previous ? at : undefined;
}
