/**
 * @vitest-environment node
 */
// TrustCalibrationChart — server-rendered verdict for the judgment-over-artifact
// (trust_calibration) dimension. Asserts the band → French verdict mapping and the
// documented honesty boundary (over-distrust unfed live) is surfaced to the teacher.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import TrustCalibrationChart from "./TrustCalibrationChart";
import type { TrustCalibrationResponse } from "@/lib/api";

const base: TrustCalibrationResponse = {
  trust_calibration: 0, band: "bien", n_audits: 2,
  over_trust: 0, over_distrust: 0, per_scene: [],
  // INT-STUDIUM-030 R1: the population of the OVERALL gap is the union of the PUBLISHED
  // scorable scenes' auditors — not the course cohort, which is what the endpoint's floor
  // checked and what a reader would otherwise assume.
  withheld_below_floor: false,
  judgement: {
    cohort_band: "10–19",
    cohort_counts: "distinct learners within one lesson",
    non_attribution: "class-level reading over the contributors this family names",
  },
};

function render(data: TrustCalibrationResponse) {
  return renderToStaticMarkup(createElement(TrustCalibrationChart, { data }));
}

describe("TrustCalibrationChart", () => {
  it("renders the well-calibrated verdict for band 'bien'", () => {
    const html = render(base);
    expect(html).toContain('data-testid="trust-calibration-chart"');
    expect(html).toContain("bien calibré");
    expect(html).toContain("0.00"); // exactly-zero gap shows no sign prefix
  });

  it("renders over-trust verdict + signed positive gap for band 'sur'", () => {
    const html = render({ ...base, band: "sur", trust_calibration: 0.67, over_trust: 0.67 });
    expect(html).toContain("Surconfiance");
    expect(html).toContain("+0.67");
    expect(html).toContain("67 %"); // over_trust percentage
  });

  it("renders over-distrust verdict + signed negative gap for band 'sous'", () => {
    const html = render({ ...base, band: "sous", trust_calibration: -1, over_distrust: 1 });
    expect(html).toContain("Méfiance");
    expect(html).toContain("-1.00");
  });

  it("renders an insufficient-data state when band is null", () => {
    const html = render({ ...base, band: null, trust_calibration: null, n_audits: 0, over_trust: null, over_distrust: null });
    expect(html).toContain("insuffisantes");
    expect(html).toContain("—");
  });

  it("states the measurement boundary the panel actually has (INT-STUDIUM-003)", () => {
    // The footnote used to say the offline detector emits no false positives, so only
    // over-trust is ever fed. The verdict deck ended that: a scene declaring
    // `sound_claims` produces real false_positives and sound_total
    // (`grading/graders.ts:151`), and only the free-text keyword path is fixed at
    // fp=0/sound=0 (`graders.ts:158`, `ai-audit-matcher.ts:39`), which the collector
    // reports as UNMEASURED and not zero (`metrics._over_distrust_rate`).
    const html = render(base);
    expect(html).toContain("sound_claims");
    expect(html).toContain("non mesurée");
    // the sentence the panel above it contradicts
    expect(html).not.toContain("false_positives = 0");
    expect(html).not.toContain("structurellement");
  });

  it("does not deny the over-distrust it is rendering", () => {
    // A "sous" verdict with a measured over-distrust and a footnote saying that
    // direction is never fed is one panel making two opposite claims.
    const html = render({ ...base, band: "sous", trust_calibration: -1, over_distrust: 1 });
    expect(html).toContain("Méfiance");
    expect(html).toContain("100 %");
    expect(html).not.toContain("seule la surconfiance est mesurée");
  });

  it("names the reading as aggregated, and cannot name a person", () => {
    // Replaces "labels the learner when a pseudonym is given" (INT-STUDIUM-030). The chart no
    // longer takes a `learner` prop because the collector no longer serves a narrowed number,
    // and a per-learner TITLE over class-wide DATA would be the worst of the three states.
    const html = render(base);
    expect(html).toContain("agrégée");
    expect(html).not.toContain("hmac:");
  });

  it("names the population behind the gap, not just the scene count (INT-STUDIUM-030 R1)", () => {
    // « Calculé sur 2 scènes » is a count of ARTIFACTS. Two scenes can be two people, and the
    // panel gave a reader nothing to tell the difference with — the scene count reads as
    // reassurance about cohort size while saying nothing about it.
    const html = render(base);
    expect(html).toContain('data-testid="cohort-line"');
    expect(html).toContain("10–19");
  });

  it("distinguishes a withheld measurement from an unmeasured one", () => {
    // Both arrive as band=null. « Aucun audit n'a encore été joué » is false when the audits
    // ran and were withheld under the floor, and it is the more expensive falsehood of the
    // two: it sends a teacher to repair a bundle that is correct.
    const withheld = render({
      ...base, band: null, trust_calibration: null, n_audits: 0,
      over_trust: null, over_distrust: null, withheld_below_floor: true,
      judgement: { cohort_band: null,
                   cohort_counts: "no contributors: this number was computed over nobody",
                   non_attribution: base.judgement.non_attribution },
    });
    expect(withheld).toContain("plancher");
    expect(withheld).not.toContain("n’a encore été joué");
  });

  it("says a reading was withheld without saying how much of it was", () => {
    // The R1 lesson the collector's own property test surfaced: a count removed from one key
    // comes back from a neighbouring one. On this panel the neighbour is `n_audits`, which
    // now counts PUBLISHED scenes only — so one withheld scene and three withheld scenes
    // reach the page as the same payload, and must leave it as the same markup.
    const on = render({ ...base, withheld_below_floor: true });
    const off = render(base);
    expect(off).not.toContain('data-testid="withheld-notice"');
    const notice = on.match(/<p[^>]*data-testid="withheld-notice"[^>]*>.*?<\/p>/s);
    expect(notice).not.toBeNull();
    // The flag adds a sentence and changes NO number: strip the notice and the withheld
    // render is the un-withheld one, character for character.
    expect(on.replace(notice![0], "")).toEqual(off);
    // Digits stripped of tags: Tailwind class names carry numbers (`text-amber-700`), and a
    // colour ramp is not a disclosure.
    expect(notice![0].replace(/<[^>]*>/g, "")).not.toMatch(/\d/);
  });
});
