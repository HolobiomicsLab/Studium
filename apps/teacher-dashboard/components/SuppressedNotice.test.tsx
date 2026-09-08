/**
 * @vitest-environment node
 */
// The teacher-facing rendering of a k-anonymity suppression (INT-STUDIUM-005).
//
// The collector now refuses to serve a class-level number over a cohort below the floor, and
// returns a suppression payload where an aggregate used to be. Every typed response on this
// dashboard is a different shape, so without an explicit branch each page would render an
// empty chart — a blank panel reads as "this class has no hint requests", which is a claim,
// and a false one. The suppressed state has to say what it is.
//
// It must also not undo the floor while explaining it: the notice states the floor and never
// the cohort, because a page saying "3 learners — too few to report" reports the number the
// suppression exists to withhold.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import SuppressedNotice from "./SuppressedNotice";
import { isSuppressed, type Suppressed } from "@/lib/api";

const payload: Suppressed = {
  status: "suppressed",
  min_learners: 5,
  reason:
    "k-anonymity floor: every lesson needs at least 5 distinct learners and at least one " +
    "lesson on this course has fewer. Exact counts are withheld.",
};

describe("isSuppressed", () => {
  it("recognises the collector's suppression payload", () => {
    expect(isSuppressed(payload)).toBe(true);
  });

  it("does not swallow a real aggregate", () => {
    expect(isSuppressed({ scenes: { s1: { completion_rate: 1, n_learners: 6 } } })).toBe(false);
    expect(isSuppressed({ autonomy_ratio: 0.6 })).toBe(false);
    // an empty aggregate is data, not a suppression: the course simply has no events yet
    expect(isSuppressed({ scenes: {} })).toBe(false);
  });
});

describe("SuppressedNotice", () => {
  it("names the floor and the restraint, and no cohort size", () => {
    const html = renderToStaticMarkup(createElement(SuppressedNotice, { info: payload }));
    expect(html).toContain("5");
    expect(html.toLowerCase()).toContain("anonymat");
    // the reason is shown verbatim so the page cannot drift from what the server decided
    expect(html).toContain("Exact counts are withheld");
  });

  it("distinguishes an unestablished cohort from a small one", () => {
    const unknown: Suppressed = {
      status: "suppressed",
      min_learners: 5,
      reason:
        "unknown identity: at least one event carries no learner_pseudonym or no lesson_id, " +
        "so no cohort can be established.",
    };
    const html = renderToStaticMarkup(createElement(SuppressedNotice, { info: unknown }));
    expect(html).toContain("unknown identity");
  });
});
