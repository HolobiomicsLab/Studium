/**
 * @vitest-environment node
 */
// AutonomyBar — the collector's course-level anti-offloading ratio.
//
// INT-STUDIUM-023: the runtime publishes a DIFFERENT measurement under the same wire key
// `autonomy_ratio` — scenes completed over scenes completed plus scaffolding, per session,
// which `tools/class_report.py` averages as "scaffolding independence". Neither wire key
// moves (historical streams carry them); what must not collide is the name a teacher
// reads, and this panel is one of the two places it is read.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import AutonomyBar from "./AutonomyBar";
import type { AutonomyResponse } from "@/lib/api";

const data: AutonomyResponse = {
  autonomy_ratio: 0.6,
  critique_completion_rate: 0.9,
  n_critique: 3,
  n_hints: 2,
};

function render(payload: AutonomyResponse) {
  return renderToStaticMarkup(createElement(AutonomyBar, { data: payload }));
}

describe("AutonomyBar", () => {
  it("still reports the collector's ratio", () => {
    const html = render(data);
    expect(html).toContain('data-testid="autonomy-bar"');
    expect(html).toContain("60%");
    expect(html).toContain("90%");
  });

  it("names the construct instead of calling it autonomy (INT-STUDIUM-023)", () => {
    const html = render(data);
    expect(html).toContain("Équilibre critique / indice");
    expect(html).not.toMatch(/autonomie/i);
  });

  it("says which measurement it is not", () => {
    // The class report's per-session ratio ships under the same wire key. A teacher who
    // reads both surfaces has to be told they are two numbers, not one disagreeing.
    const html = render(data);
    expect(html).toContain("étayage");
    expect(html).toContain("autonomy_ratio");
  });
});
