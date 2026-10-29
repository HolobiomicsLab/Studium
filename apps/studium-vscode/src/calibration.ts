// calibration.ts — client-side metacognitive calibration verdict for the VS Code lesson pane.
//
// The authoritative version is packages/lesson-session-host/src/host.ts `calibrationVerdict` (over
// packages/learner-state ConceptState). The extension can't import those (not declared deps; esbuild
// bundles only vscode + the MCP SDK + typed-graph-lens), so this is a VERBATIM copy operating on the
// same `concept_states` the get_session_state MCP tool already returns. Keep it in lockstep with
// host.ts — calibration.driver.ts asserts the messages + banding match.
//
// It maps a concept's hidden signed `confidence_calibration` gap to a NUMBER-FREE, learner-facing
// verdict (bien / sur / sous). The raw gap and the numeric mastery are NEVER exposed — calibration is
// a metacognitive mirror (am I as sure as I should be?), so it is safe to show the learner.
import { phrase, type Locale } from "./phrases.js";

export type CalibrationBand = "bien" | "sur" | "sous";
export interface CalibrationVerdict { concept_id: string; band: CalibrationBand; message: string; }

/** |gap| below this ⇒ "bien calibré·e". Matches the engine's calibration rule (host.ts CALIBRATION_WELL_BAND, |gap| ≥ 0.4 trips an adaptation). */
export const CALIBRATION_WELL_BAND = 0.4;

type AnyJson = Record<string, any>;

/** Verbatim port of host.ts `calibrationVerdict`. Returns null until calibration is MEASURED (a
 * confidence sample) — without one, the gap defaults to 0 and "bien calibrée" would be fabricated. */
export function calibrationVerdict(cs: AnyJson, locale: Locale = "fr"): CalibrationVerdict | null {
  if (!cs || (cs.total_attempts | 0) === 0 || (cs.calibration_samples | 0) === 0) return null;
  const gap = Number(cs.confidence_calibration) || 0;
  if (Math.abs(gap) < CALIBRATION_WELL_BAND) {
    return {
      concept_id: cs.concept_id,
      band: "bien",
      message: phrase("calibration_well", {}, locale),
    };
  }
  if (gap > 0) {
    return {
      concept_id: cs.concept_id,
      band: "sur",
      message: phrase("calibration_over", {}, locale),
    };
  }
  return {
    concept_id: cs.concept_id,
    band: "sous",
    message: phrase("calibration_under", {}, locale),
  };
}

/** Every seen concept's verdict (skipping concepts with no attempt yet), from a LearnerState. */
export function calibrationVerdicts(state: AnyJson, locale: Locale = "fr"): CalibrationVerdict[] {
  const cs = (state && state.concept_states) || {};
  const out: CalibrationVerdict[] = [];
  for (const cid of Object.keys(cs)) {
    const v = calibrationVerdict(cs[cid], locale);
    if (v) out.push(v);
  }
  return out;
}
