import { describe, expect, it } from "vitest";
import {
  defaultLearnerState,
  defaultConceptState,
  type ConceptState,
  type LearnerState,
  type Signal,
  type Decision,
} from "@studium/learner-state";
import {
  reviewQueue,
  dueConcepts,
  calibrationVerdict,
  CALIBRATION_WELL_BAND,
} from "./reviewQueue";

const DAY = 86_400_000;
const NOOP: Decision = {
  next_action: { kind: "advance_to_next_scene" },
  rule_id: null,
  explanation_short: null,
  modulator: null,
};

function stateWith(
  concept_id: string,
  answers: Array<{ correct: boolean; hint_count: number; atMs: number }>,
): LearnerState {
  const s = defaultLearnerState("lesson-x");
  s.concept_states[concept_id] = defaultConceptState(concept_id);
  for (const a of answers) {
    const signal: Signal = {
      kind: "answer_submitted",
      concept_id,
      scene_id: "scn",
      correct: a.correct,
      time_ms: 1000,
      hint_count: a.hint_count,
      difficulty: 0.5,
    };
    s.history.push({ timestamp: new Date(a.atMs).toISOString(), scene_id: "scn", signal, decision: NOOP });
  }
  return s;
}

describe("reviewQueue (real FSRS scheduler)", () => {
  it("omits unseen concepts and surfaces answered ones", () => {
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const s = stateWith("c1", [{ correct: true, hint_count: 0, atMs: t0 }]);
    s.concept_states["c-unseen"] = defaultConceptState("c-unseen");
    const q = reviewQueue(s, t0 + 60_000);
    expect(q.map((i) => i.concept_id)).toEqual(["c1"]);
  });

  it("not due right after review, due after decay", () => {
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const s = stateWith("c1", [{ correct: true, hint_count: 0, atMs: t0 }]);
    expect(dueConcepts(s, t0 + 60_000)).toHaveLength(0);
    expect(dueConcepts(s, t0 + 60 * DAY).map((d) => d.concept_id)).toEqual(["c1"]);
  });
});

describe("calibrationVerdict (number-free, learner-facing)", () => {
  function cs(p: Partial<ConceptState>): ConceptState {
    return { ...defaultConceptState("c1"), total_attempts: 3, ...p };
  }
  it("null before any attempt", () => {
    expect(calibrationVerdict(cs({ total_attempts: 0 }))).toBeNull();
  });
  it("bands by sign and magnitude", () => {
    expect(calibrationVerdict(cs({ confidence_calibration: 0.1 }))?.band).toBe("bien");
    expect(calibrationVerdict(cs({ confidence_calibration: 0.6 }))?.band).toBe("sur");
    expect(calibrationVerdict(cs({ confidence_calibration: -0.6 }))?.band).toBe("sous");
  });
  it("threshold matches the engine calibration rule and never leaks a number", () => {
    expect(CALIBRATION_WELL_BAND).toBe(0.4);
    for (const g of [-0.9, -0.4, 0, 0.4, 0.9]) {
      const v = calibrationVerdict(cs({ confidence_calibration: g }));
      if (v) expect(v.message).not.toMatch(/[0-9]/);
    }
  });
});
