/**
 * @vitest-environment node
 */
// INT-STUDIUM-058 task 6.3: the review inbox on screen. This app has no DOM test library, so a click
// is exercised through the component's own reducer (the onClick handlers dispatch exactly these
// actions) and the markup is rendered from the resulting state.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import {
  ReviewSession, ReviewInboxList, ReviewApproval, reviewReducer, emptyReviewState,
  unopenedGrading, openedInSceneOrder, type InboxEntry, type ReviewState,
} from "./ReviewInbox";

const ok = [{ check: "schema", passed: true }, { check: "todo", passed: true }] as InboxEntry["checks"];
// Already sorted by consequence, as buildReviewInbox returns them; `index` is the scene order.
const ENTRIES: InboxEntry[] = [
  { id: "s2-todo", index: 2, title: "Scene with a TODO", type: "concept", consequence: "blocks", whatChanged: "changed", checks: [{ check: "schema", passed: true }, { check: "todo", passed: false }] },
  { id: "s3-quiz", index: 3, title: "Quiz three", type: "quiz", consequence: "grading", whatChanged: "new", checks: ok },
  { id: "s1-quiz", index: 1, title: "Quiz one", type: "quiz", consequence: "grading", whatChanged: "unchanged", checks: ok },
  { id: "s0-intro", index: 0, title: "Intro", type: "intro", consequence: "wording", whatChanged: "unchanged", checks: ok },
];
const RECEIPT = { reviewer: "A. Teacher", decidedAt: "2026-11-01T09:00:00Z", decision: "approved" as const, opened: 2, notOpened: 1 };

function page(state: ReviewState, locale: "fr" | "en" = "fr", lastReceipt: typeof RECEIPT | null = RECEIPT): string {
  const children: ReactNode = [
    createElement(ReviewInboxList, { key: "list", lastReceipt, unreadableReceipts: 0 }),
    createElement(ReviewApproval, { key: "approval", bundlePath: "/lib/course/lesson.json" }),
  ];
  return renderToStaticMarkup(createElement(ReviewSession, { entries: ENTRIES, locale, initialState: state }, children));
}
const itemHtml = (html: string, id: string) => {
  const start = html.indexOf(`data-item="${id}"`);
  return html.slice(start, html.indexOf("</li>", start));
};

describe("review inbox list", () => {
  it("keeps the consequence order in the DOM and labels each item", () => {
    const html = page(emptyReviewState());
    const positions = ENTRIES.map((e) => html.indexOf(`data-item="${e.id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(itemHtml(html, "s2-todo")).toContain("bloque");
    expect(itemHtml(html, "s3-quiz")).toContain("note");
    expect(itemHtml(html, "s0-intro")).toContain("formulation");
    expect(itemHtml(html, "s3-quiz")).toContain("Quiz three");
    expect(itemHtml(html, "s2-todo")).toContain("modifié");
    expect(itemHtml(html, "s2-todo")).toContain("2026-11-01");
    expect(page(emptyReviewState(), "en")).toContain("blocks");
  });
  it("says there is no earlier receipt when none was found", () => {
    expect(page(emptyReviewState(), "fr", null)).toContain("aucun reçu antérieur");
    expect(page(emptyReviewState(), "en", null)).toContain("no earlier receipt");
  });
  it("folds a grading item's automatic verdict until the teacher gives their own", () => {
    const before = itemHtml(page(emptyReviewState()), "s3-quiz");
    expect(before).toContain("Avis automatique");
    expect(before).toMatch(/<details class="inbox-checks"(?![^>]*open)/);
    expect(before).toContain(">Correct<");
    expect(before).toContain("À corriger");
    const after = reviewReducer(emptyReviewState(), { type: "verdict", id: "s3-quiz", verdict: "to_fix" });
    expect(after.opened.has("s3-quiz")).toBe(true);
    expect(after.verdicts["s3-quiz"]).toBe("to_fix");
    const html = itemHtml(page(after), "s3-quiz");
    expect(html).toMatch(/<details class="inbox-checks"[^>]*open/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>À corriger/);
  });
  it("marks a non-grading item opened when its details are opened, and never un-opens it", () => {
    const opened = reviewReducer(emptyReviewState(), { type: "toggle", id: "s0-intro", open: true });
    expect(opened.opened.has("s0-intro")).toBe(true);
    expect(reviewReducer(opened, { type: "toggle", id: "s0-intro", open: false }).opened.has("s0-intro")).toBe(true);
  });
});

describe("approval panel", () => {
  it("warns, as a status, about unopened grading items until all are opened", () => {
    const html = page(emptyReviewState());
    expect(unopenedGrading(ENTRIES, emptyReviewState())).toEqual(["s3-quiz", "s1-quiz"]);
    expect(html).toContain('role="status"');
    expect(html).toContain("2 éléments");
    expect(html).toContain("non ouverts");
    expect(html).toContain("s3-quiz, s1-quiz");
    expect(html).not.toContain('role="alert"');
    let state = reviewReducer(emptyReviewState(), { type: "verdict", id: "s3-quiz", verdict: "ok" });
    expect(page(state)).toContain("1 élément");
    expect(page(state, "en")).toContain("1 grading item not opened");
    state = reviewReducer(state, { type: "verdict", id: "s1-quiz", verdict: "ok" });
    expect(page(state)).not.toContain("non ouvert");
  });
  it("carries --opened with the opened ids in scene order, and no flag when none", () => {
    expect(page(emptyReviewState())).not.toContain("--opened");
    let state = reviewReducer(emptyReviewState(), { type: "verdict", id: "s3-quiz", verdict: "ok" });
    state = reviewReducer(state, { type: "toggle", id: "s0-intro", open: true });
    state = reviewReducer(state, { type: "verdict", id: "s1-quiz", verdict: "ok" });
    expect(openedInSceneOrder(ENTRIES, state)).toEqual(["s0-intro", "s1-quiz", "s3-quiz"]);
    const html = page(state);
    expect(html).toContain("experience_packet.py approve --bundle &#x27;/lib/course/lesson.json&#x27; --validated-by &#x27;VOTRE NOM&#x27; --opened &#x27;s0-intro,s1-quiz,s3-quiz&#x27;");
    expect(html).toContain("experience_packet.py receipt --bundle &#x27;/lib/course/lesson.json&#x27; --reviewer &#x27;VOTRE NOM&#x27; --decision returned --opened &#x27;s0-intro,s1-quiz,s3-quiz&#x27;");
    expect(html).toContain("Renvoyer la leçon");
  });
});
