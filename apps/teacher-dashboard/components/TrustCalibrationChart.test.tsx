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
};

function render(data: TrustCalibrationResponse, learner?: string) {
  return renderToStaticMarkup(createElement(TrustCalibrationChart, { data, learner }));
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

  it("labels the learner when a pseudonym is given", () => {
    const html = render(base, "hmac:p1");
    expect(html).toContain("hmac:p1");
  });
});
