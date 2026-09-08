/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UnavailableNotice from "./UnavailableNotice";
import NonAttribution from "./NonAttribution";
import type { Unavailable } from "@/lib/api";

const info: Unavailable = {
  status: "unavailable",
  reason: "les instantanés par concept ne sont jamais écrits (`concept_states`)",
};

describe("UnavailableNotice", () => {
  it("prints the server's reason rather than a reason of its own", () => {
    // The same rule SuppressedNotice follows: the page cannot drift from the decision the
    // collector actually made if it never restates it.
    expect(renderToStaticMarkup(createElement(UnavailableNotice, { info }))).toContain(
      "les instantanés par concept ne sont jamais écrits",
    );
  });

  it("says this is not a floor, so a teacher does not read it as a small class", () => {
    // The failure this exists to prevent: rendering a withdrawn instrument with the floor's
    // words tells a teacher something false about their class instead of something true about
    // the instrument. (INT-STUDIUM-030)
    const html = renderToStaticMarkup(createElement(UnavailableNotice, { info }));
    expect(html).toContain("aucune");
    expect(html).not.toContain("plancher d’anonymat");
    expect(html).not.toContain("trop peu");
  });

  it("names no cohort size, on either notice", () => {
    // The floor must not publish the number it exists to withhold, and neither may the
    // withdrawal — a count would be a disclosure whichever panel carried it.
    const html = renderToStaticMarkup(createElement(UnavailableNotice, { info }));
    expect(html).not.toMatch(/\b\d+\s*(apprenant|élève)/);
  });
});

describe("NonAttribution", () => {
  it("states that the number is a class reading and not about a student", () => {
    const html = renderToStaticMarkup(createElement(NonAttribution));
    expect(html).toContain("de classe");
    expect(html).toContain("pas un énoncé sur un·e élève");
  });

  it("does not tell the reader how to narrow, because nothing narrows any more", () => {
    // It replaced « Astuce : ajouter ?learner=<pseudonyme> … », so the one thing it must never
    // do is reintroduce that instruction in gentler words.
    const html = renderToStaticMarkup(createElement(NonAttribution));
    expect(html).not.toContain("learner=");
    expect(html).not.toContain("pseudonyme=");
    expect(html).not.toContain("Astuce");
  });
});
