/**
 * @vitest-environment node
 */
// CohortLine / WithheldNotice — the dashboard half of INT-STUDIUM-030 R1: every published
// number names the population it was computed over, that population is counted by one rule,
// and the rule operates inside one lesson.
//
// The collector already refuses to publish a cohort COUNT beside a judgement metric; these
// tests are about the last stretch, where a count could come back — a band re-rendered as a
// number, or a withheld state rendered as "n rows hidden". The property the suite protects is
// the same one the collector's property test protects: the page must not know how many.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import CohortLine, { WithheldNotice } from "./CohortLine";
import type { Judgement } from "@/lib/api";

// The collector's own sentences, copied from metrics.NON_ATTRIBUTION / Population.counts_note.
// They are the KEYS of the French map, so this fixture is also what pins the map to the
// server: change one here without changing the component and the verbatim branch shows.
const NON_ATTRIBUTION =
  "class-level reading over the contributors this family names, and not a statement about " +
  "any student: it describes how a group judged, and no control on this surface narrows it " +
  "to a person";

const inOneLesson: Judgement = {
  cohort_band: "10–19",
  cohort_counts: "distinct learners within one lesson",
  non_attribution: NON_ATTRIBUTION,
};

function render(judgement: Judgement) {
  return renderToStaticMarkup(createElement(CohortLine, { judgement }));
}

/** What a teacher actually reads. Tailwind class names carry digits (`text-gray-500`), so a
 * digit assertion over raw markup measures the stylesheet and not the disclosure. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

describe("CohortLine", () => {
  it("publishes the band and names the unit it counts", () => {
    const html = render(inOneLesson);
    expect(html).toContain('data-testid="cohort-line"');
    expect(html).toContain("10–19");
    expect(html).toContain("apprenant");
    expect(html).toContain("même leçon");
  });

  it("says pairs, not learners, once the scope crosses lessons", () => {
    // A pseudonym is HMAC(learnerId:lessonId), so the same human holds one per lesson and a
    // union counts learner-lesson pairs. Rendering "20+ apprenant·e·s" over two lessons would
    // overstate the class by exactly the amount the salt makes uncountable.
    const html = render({
      ...inOneLesson,
      cohort_band: "20+",
      cohort_counts: "learner-lesson pairs across the lessons in scope",
    });
    expect(html).toContain("paires apprenant");
    expect(html).toContain("salé par leçon");
    expect(html).not.toContain("même leçon");
  });

  it("renders the two absences differently", () => {
    // Nobody contributed, versus contributors who could not be counted by the one rule. The
    // first is an empty store; the second is a defect in the events. A reader shown the
    // second message for the first goes looking for a fault that is not there.
    const nobody = render({
      cohort_band: null,
      cohort_counts: "no contributors: this number was computed over nobody",
      non_attribution: NON_ATTRIBUTION,
    });
    const unknown = render({
      cohort_band: null,
      cohort_counts:
        "no population: at least one counted event carries no learner_pseudonym or no lesson_id",
      non_attribution: NON_ATTRIBUTION,
    });
    expect(nobody).toContain("calculé sur personne");
    expect(unknown).toContain("learner_pseudonym");
    expect(nobody).not.toEqual(unknown);
  });

  it("prints an unrecognised counting rule verbatim rather than a stale translation", () => {
    // The map is keyed on the collector's exact sentence. If that sentence changes upstream,
    // the reader must see the new English rather than a fluent French claim that no longer
    // describes the number — stale-and-fluent is the failure mode a translation introduces,
    // and it is worse than untranslated because nothing signals it.
    const html = render({
      ...inOneLesson,
      cohort_counts: "distinct learners within one COHORT, whatever that turns out to mean",
    });
    expect(html).toContain("whatever that turns out to mean");
    expect(html).not.toContain("même leçon");
  });

  it("never renders an exact cohort size, even when the band is one", () => {
    // The band is a string from the server and the component prints it unchanged, so the
    // only way a count reaches the page is if the server sends one. This asserts the
    // component adds none of its own arithmetic on top.
    const digits = text(render(inOneLesson)).match(/\d+/g) ?? [];
    expect(digits).toEqual(["10", "19"]);
  });
});

describe("WithheldNotice", () => {
  it("says a reading is incomplete without saying how incomplete", () => {
    // The whole path from metrics.Population to this markup carries a BOOLEAN. This is the
    // last place the count could be reintroduced, so the absence of digits is asserted rather
    // than assumed — the collector's own property test caught `n_audits` republishing exactly
    // this number from a neighbouring key.
    const html = renderToStaticMarkup(createElement(WithheldNotice, {}));
    expect(html).toContain('data-testid="withheld-notice"');
    expect(html).toContain("plancher");
    expect(text(html)).not.toMatch(/\d/);
  });
});
