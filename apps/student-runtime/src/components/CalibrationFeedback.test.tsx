/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultLearnerState, defaultConceptState, type LearnerState } from "@studium/learner-state";
import CalibrationFeedback from "./CalibrationFeedback";
import ReviewDueIndicator from "./ReviewDueIndicator";

afterEach(cleanup);

function stateWithCalibration(conceptId: string, calibration: number, attempts = 3): LearnerState {
  const s = defaultLearnerState("lesson-x");
  s.concept_states[conceptId] = {
    ...defaultConceptState(conceptId),
    total_attempts: attempts,
    confidence_calibration: calibration,
  };
  return s;
}

describe("CalibrationFeedback", () => {
  it("shows a qualitative overconfident message and never a number", () => {
    const state = stateWithCalibration("c1", 0.6);
    render(<CalibrationFeedback conceptId="c1" state={state} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/surconfiant/i);
    // mastery / raw numbers must NOT leak to the learner
    expect(dialog.textContent ?? "").not.toMatch(/[0-9]/);
  });

  it("shows the well-calibrated message for a small gap", () => {
    const state = stateWithCalibration("c1", 0.1);
    render(<CalibrationFeedback conceptId="c1" state={state} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog").textContent).toMatch(/bien calibrée/i);
  });

  it("renders nothing before any attempt", () => {
    const state = stateWithCalibration("c1", 0, 0);
    const { container } = render(<CalibrationFeedback conceptId="c1" state={state} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("calls onClose on the OK button", () => {
    const onClose = vi.fn();
    render(<CalibrationFeedback conceptId="c1" state={stateWithCalibration("c1", -0.6)} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /ok/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ReviewDueIndicator", () => {
  it("renders nothing when no concept is due", () => {
    const { container } = render(<ReviewDueIndicator state={defaultLearnerState("l")} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a due count once a concept has decayed past retention", () => {
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const s = defaultLearnerState("l");
    s.concept_states["c1"] = defaultConceptState("c1");
    s.history.push({
      timestamp: new Date(t0).toISOString(),
      scene_id: "scn",
      signal: {
        kind: "answer_submitted",
        concept_id: "c1",
        scene_id: "scn",
        correct: true,
        time_ms: 1,
        hint_count: 0,
        difficulty: 0.5,
      },
      decision: { next_action: { kind: "advance_to_next_scene" }, rule_id: null, explanation_short: null, modulator: null },
    });
    render(<ReviewDueIndicator state={s} nowMs={t0 + 90 * 86_400_000} />);
    expect(screen.getByRole("status").textContent).toMatch(/À réviser\s*:\s*1 concept/);
  });
});
