"use client";
// INT-STUDIUM-058 task 6.3: the review inbox and the approval commands share one state, the items the
// teacher opened and their own verdicts. React state only: no network, no storage, nothing written.
// The page has no authentication, so `opened` reaches the receipt through `--opened` in the command
// the teacher runs (see lib/review-commands.ts), not through a file written by the dashboard.
import { createContext, useContext, useReducer, type ReactNode, type SyntheticEvent } from "react";
import { fill, messages, sceneTypeLabel, type Locale } from "@/lib/i18n";
import { approvalCommand, returnCommand } from "@/lib/review-commands";

export type Verdict = "ok" | "to_fix";
/** One inbox item joined with its outline entry; `index` is the scene's position in the lesson. */
export type InboxEntry = {
  id: string; index: number; title: string; type: string;
  consequence: "blocks" | "grading" | "wording" | "media";
  whatChanged: "new" | "changed" | "unchanged";
  checks: Array<{ check: "schema" | "todo" | "lint"; passed: boolean }>;
};
export type InboxReceiptView = { reviewer: string; decidedAt: string; decision: "approved" | "returned" } | null;
export type ReviewState = { opened: ReadonlySet<string>; verdicts: Readonly<Record<string, Verdict>> };
export type ReviewAction = { type: "toggle"; id: string; open: boolean } | { type: "verdict"; id: string; verdict: Verdict };

export const emptyReviewState = (): ReviewState => ({ opened: new Set(), verdicts: {} });

/** Opening is one-way: closing a panel again does not undo having looked. */
export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  if (action.type === "toggle") {
    if (!action.open || state.opened.has(action.id)) return state;
    return { ...state, opened: new Set(state.opened).add(action.id) };
  }
  return { opened: new Set(state.opened).add(action.id), verdicts: { ...state.verdicts, [action.id]: action.verdict } };
}

export function unopenedGrading(entries: readonly InboxEntry[], state: ReviewState): string[] {
  return entries.filter((e) => e.consequence === "grading" && !state.opened.has(e.id)).map((e) => e.id);
}
export function openedInSceneOrder(entries: readonly InboxEntry[], state: ReviewState): string[] {
  return entries.filter((e) => state.opened.has(e.id)).sort((a, b) => a.index - b.index).map((e) => e.id);
}

type Session = { entries: readonly InboxEntry[]; locale: Locale; state: ReviewState; dispatch: (action: ReviewAction) => void };
const ReviewContext = createContext<Session | null>(null);
function useSession(): Session {
  const session = useContext(ReviewContext);
  if (!session) throw new Error("ReviewInboxList and ReviewApproval must sit inside ReviewSession");
  return session;
}

/** Holds the shared state; the server page passes the inbox and its own layout as children. */
export function ReviewSession({ entries, locale, initialState, children }: { entries: InboxEntry[]; locale: Locale; initialState?: ReviewState; children: ReactNode }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState ?? emptyReviewState());
  return <ReviewContext.Provider value={{ entries, locale, state, dispatch }}>{children}</ReviewContext.Provider>;
}

function Checks({ entry, locale }: { entry: InboxEntry; locale: Locale }) {
  const t = messages(locale);
  const label = { schema: t.checkSchema, todo: t.checkTodo, lint: t.checkLint };
  return <ul className="inbox-checks__list">{entry.checks.map((c) => <li key={c.check} className={c.passed ? "inbox-check--passed" : "inbox-check--failed"}>
    {label[c.check]}{t.colon}{c.passed ? t.checkPassed : t.checkFailed}
  </li>)}</ul>;
}

export function ReviewInboxList({ lastReceipt, unreadableReceipts }: { lastReceipt: InboxReceiptView; unreadableReceipts: number }) {
  const { entries, locale, state, dispatch } = useSession();
  const t = messages(locale);
  const changed = { new: t.changedNew, changed: t.changedChanged, unchanged: t.changedUnchanged };
  const date = lastReceipt?.decidedAt.slice(0, 10) ?? "";
  const since = lastReceipt ? fill(t.sinceReceipt, { date }) : t.noEarlierReceipt;
  return (
    <section aria-labelledby="inbox-heading" className="review-inbox">
      <header className="section-heading"><h2 id="inbox-heading">{t.inbox}</h2><p>{t.inboxHelp}</p>
        {lastReceipt && <p>{fill(t.lastReceipt, { date, reviewer: lastReceipt.reviewer, decision: lastReceipt.decision === "approved" ? t.decisionApproved : t.decisionReturned })}</p>}
        {unreadableReceipts > 0 && <p className="approval-note">{fill(t.unreadableReceipts, { n: unreadableReceipts })}</p>}
      </header>
      <ol className="inbox-list">{entries.map((entry) => {
        const grading = entry.consequence === "grading";
        const verdict = state.verdicts[entry.id];
        const opened = state.opened.has(entry.id);
        // Grading: the automatic verdict stays folded until the teacher's own verdict, so it cannot anchor it.
        const holdFolded = (event: SyntheticEvent) => { if (grading && !verdict) event.preventDefault(); };
        const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => dispatch({ type: "toggle", id: entry.id, open: event.currentTarget.open });
        return <li key={entry.id} data-item={entry.id} className={`inbox-item inbox-item--${entry.consequence}`}>
          <div className="inbox-item__head">
            <span className={`inbox-chip inbox-chip--${entry.consequence}`}>{t[entry.consequence]}</span>
            <span className="scene-type">{sceneTypeLabel(entry.type, locale)}</span>
            {opened && <span className="inbox-item__opened">· {t.openedMark}</span>}
          </div>
          <h3>{entry.title}</h3>
          <p className="inbox-item__changed"><b>{changed[entry.whatChanged]}</b> · {since} · <code>{entry.id}</code></p>
          {grading && <div className="inbox-verdict" role="group" aria-label={`${t.yourVerdict} — ${entry.title}`}>
            <button type="button" aria-pressed={verdict === "ok"} onClick={() => dispatch({ type: "verdict", id: entry.id, verdict: "ok" })}>{t.verdictOk}</button>
            <button type="button" aria-pressed={verdict === "to_fix"} onClick={() => dispatch({ type: "verdict", id: entry.id, verdict: "to_fix" })}>{t.verdictToFix}</button>
          </div>}
          <details className="inbox-checks" open={grading ? verdict !== undefined : undefined} onToggle={grading ? undefined : onToggle}>
            <summary onClick={holdFolded}>{t.automaticVerdict}{grading && !verdict && <span className="inbox-checks__later"> {t.automaticVerdictLater}</span>}</summary>
            <Checks entry={entry} locale={locale} />
          </details>
        </li>;
      })}</ol>
    </section>
  );
}

/** The warning and the two commands, rebuilt as items are opened. */
export function ReviewApproval({ bundlePath }: { bundlePath: string }) {
  const { entries, locale, state } = useSession();
  const t = messages(locale);
  const unopened = unopenedGrading(entries, state);
  const opened = openedInSceneOrder(entries, state);
  return <>
    {/* The live region stays in the DOM (empty once all are opened) so screen readers hear the change. */}
    <p className="inbox-warning" role="status">
      {unopened.length > 0 ? fill(unopened.length === 1 ? t.inboxWarningOne : t.inboxWarningMany, { n: unopened.length, ids: unopened.join(", ") }) : null}
    </p>
    <p>{t.approvalHelp}</p>
    <pre className="approval-command"><code>{approvalCommand(bundlePath, locale, opened)}</code></pre>
    <h3 className="return-heading">{t.returnHeading}</h3>
    <p>{t.returnHelp}</p>
    <pre className="approval-command"><code>{returnCommand(bundlePath, locale, opened)}</code></pre>
  </>;
}
