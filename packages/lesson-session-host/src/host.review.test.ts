// packages/lesson-session-host/src/host.review.test.ts
// B1 — the spaced-repetition (FSRS) review queue + the learner-facing calibration verdict are
// computed by the engine today but were invisible. These cover the host reads that SURFACE them.
import { describe, it, expect, afterEach } from "vitest";
import { FixedClock } from "@studium/lesson-session/testing";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLearnerState,
  defaultConceptState,
  type LearnerState,
  type ConceptState,
  type Signal,
  type Decision,
} from "@studium/learner-state";
import {
  SessionHost,
  reviewQueueFromState,
  calibrationVerdict,
  CALIBRATION_WELL_BAND,
} from "./host.js";

const DAY = 86_400_000;
/** Non-null array index that also narrows the type (the package builds with noUncheckedIndexedAccess). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected element at index ${i}, got undefined`);
  return v;
}
const NOOP_DECISION: Decision = {
  next_action: { kind: "advance_to_next_scene" },
  rule_id: null,
  explanation_short: null,
  modulator: null,
};

/** Build a LearnerState whose history is a list of graded answers for one concept. */
function stateWithAnswers(
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
    s.history.push({
      timestamp: new Date(a.atMs).toISOString(),
      scene_id: "scn",
      signal,
      decision: NOOP_DECISION,
    });
  }
  return s;
}

describe("reviewQueueFromState (FSRS review queue surface)", () => {
  it("omits concepts with no graded answers (reps=0 → handled by the prereq path, not review)", () => {
    const s = defaultLearnerState("lesson-x");
    s.concept_states["c-unseen"] = defaultConceptState("c-unseen");
    expect(reviewQueueFromState(s, Date.now())).toEqual([]);
  });

  it("a freshly-answered concept is NOT due immediately, then becomes due after its interval", () => {
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const s = stateWithAnswers("c1", [{ correct: true, hint_count: 0, atMs: t0 }]);

    const justAfter = reviewQueueFromState(s, t0 + 60_000);
    expect(justAfter).toHaveLength(1);
    expect(at(justAfter, 0).concept_id).toBe("c1");
    expect(at(justAfter, 0).due).toBe(false); // retrievability still high right after review
    expect(at(justAfter, 0).due_at).toBeGreaterThan(t0);
    expect(at(justAfter, 0).reps).toBe(1);

    // 60 days later the forgetting curve has decayed past requestRetention ⇒ due for review.
    const muchLater = reviewQueueFromState(s, t0 + 60 * DAY);
    expect(at(muchLater, 0).due).toBe(true);
    expect(at(muchLater, 0).retrievability).toBeLessThan(at(justAfter, 0).retrievability);
  });

  it("sorts most-urgent (lowest retrievability) first", () => {
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const s = defaultLearnerState("lesson-x");
    // c-recent: reviewed yesterday; c-stale: reviewed long ago ⇒ lower retrievability.
    const recent = stateWithAnswers("c-recent", [{ correct: true, hint_count: 0, atMs: t0 - 1 * DAY }]);
    const stale = stateWithAnswers("c-stale", [{ correct: true, hint_count: 0, atMs: t0 - 40 * DAY }]);
    s.concept_states = { ...recent.concept_states, ...stale.concept_states };
    s.history = [...recent.history, ...stale.history];

    const q = reviewQueueFromState(s, t0);
    expect(q.map((i) => i.concept_id)).toEqual(["c-stale", "c-recent"]);
    expect(at(q, 0).retrievability).toBeLessThanOrEqual(at(q, 1).retrievability);
  });

  it("answering WITH hints earns a weaker schedule than a clean answer (anti-offloading, M5)", () => {
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const clean = stateWithAnswers("c1", [{ correct: true, hint_count: 0, atMs: t0 }]);
    const hinted = stateWithAnswers("c1", [{ correct: true, hint_count: 2, atMs: t0 }]);
    const probe = t0 + 30 * DAY;
    const rClean = at(reviewQueueFromState(clean, probe), 0).retrievability;
    const rHinted = at(reviewQueueFromState(hinted, probe), 0).retrievability;
    // a hinted "good" maps to FSRS grade "hard" ⇒ lower stability ⇒ decays faster ⇒ lower R later.
    expect(rHinted).toBeLessThan(rClean);
  });
});

describe("calibrationVerdict (learner-facing, NUMBER-FREE)", () => {
  function cs(partial: Partial<ConceptState>): ConceptState {
    return { ...defaultConceptState("c1"), total_attempts: 3, calibration_samples: 1, ...partial };
  }

  it("returns null before any attempt (nothing to reflect on yet)", () => {
    expect(calibrationVerdict(cs({ total_attempts: 0, confidence_calibration: 0 }))).toBeNull();
  });

  it("returns null until calibration is MEASURED (attempts, but no confidence sample yet)", () => {
    // default-0 gap is in-band, so without this guard the learner would get a fabricated "bien calibrée"
    expect(calibrationVerdict(cs({ calibration_samples: 0, confidence_calibration: 0.6 }))).toBeNull();
  });

  it("near-zero gap ⇒ 'bien' calibrée", () => {
    const v = calibrationVerdict(cs({ confidence_calibration: 0.1 }));
    expect(v?.band).toBe("bien");
    expect(v?.message).toMatch(/bien calibrée/);
  });

  it("positive gap above the band ⇒ 'sur' (overconfident)", () => {
    const v = calibrationVerdict(cs({ confidence_calibration: 0.6 }));
    expect(v?.band).toBe("sur");
    expect(v?.message).toMatch(/surconfiant/);
  });

  it("negative gap below -band ⇒ 'sous' (underconfident)", () => {
    const v = calibrationVerdict(cs({ confidence_calibration: -0.6 }));
    expect(v?.band).toBe("sous");
    expect(v?.message).toMatch(/sous-confiant/);
  });

  it("NEVER leaks a numeric mastery or the raw gap in the message", () => {
    for (const g of [-0.9, -0.5, 0, 0.2, 0.5, 0.9]) {
      const v = calibrationVerdict(cs({ confidence_calibration: g }));
      if (v) expect(v.message).not.toMatch(/[0-9]/);
    }
  });

  it("the well-calibrated band matches the engine's calibration-rule threshold", () => {
    expect(CALIBRATION_WELL_BAND).toBe(0.4);
    expect(calibrationVerdict(cs({ confidence_calibration: 0.39 }))?.band).toBe("bien");
    expect(calibrationVerdict(cs({ confidence_calibration: 0.41 }))?.band).toBe("sur");
  });
});

// --- integration: the host methods over a real session -----------------------------------------
const MINI = {
  schema_version: "1.4",
  bundle_id: "review-001",
  source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "remember" }],
  scenes: [
    {
      id: "q1",
      type: "quiz",
      title: "Q1",
      objective_refs: [],
      concept_refs: ["c1"],
      estimated_seconds: 0,
      adaptation_hooks: [],
      question: "?",
      choices: [
        { id: "a", text: "A", correct: false },
        { id: "b", text: "B", correct: true },
      ],
      feedback_correct: "y",
      feedback_incorrect: "n",
      hints: [],
    },
  ],
  rules: [],
  validated_by: "teacher",
  validated_at: "2026-06-20T08:00:00Z",
};

const dirs: string[] = [];
function bundlesDir(): string {
  const d = mkdtempSync(join(tmpdir(), "host-review-"));
  dirs.push(d);
  writeFileSync(join(d, "mini.json"), JSON.stringify(MINI));
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function correctChoice(h: SessionHost, sid: string) {
  const scene = h.currentPresentation(sid).scene;
  if (scene.type !== "quiz") throw new Error(`expected quiz, got ${scene.type}`);
  const choice = scene.choices.find((c) => c.correct);
  if (!choice) throw new Error("no correct choice");
  return { kind: "quiz_choice" as const, choiceId: choice.id };
}

describe("SessionHost.reviewQueue / calibrationFor (integration)", () => {
  it("reviewQueue surfaces the just-answered concept and reflects its FSRS schedule", async () => {
    // The answer is stamped by the host clock and the FSRS replay reads that stamp, so the clock
    // is fixed at t0: with the wall-clock the test turned red once the calendar passed t0 + 90 days.
    const t0 = Date.parse("2026-06-20T10:00:00Z");
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false, clock: new FixedClock("2026-06-20T10:00:00Z") });
    const { sessionId } = await host.create("mini.json");
    await host.respond(sessionId, correctChoice(host, sessionId));

    const now = host.reviewQueue(sessionId, t0);
    expect(now.find((i) => i.concept_id === "c1")).toBeDefined();
    expect(now.find((i) => i.concept_id === "c1")?.due).toBe(false); // just answered

    const later = host.reviewQueue(sessionId, t0 + 90 * DAY);
    expect(later.find((i) => i.concept_id === "c1")?.due).toBe(true);
  });

  it("calibrationFor returns NO verdict for a concept answered but never self-assessed (no fabrication)", async () => {
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
    const { sessionId } = await host.create("mini.json");
    await host.respond(sessionId, correctChoice(host, sessionId));
    // The learner answered but never declared a confidence → confidence_calibration is its default 0,
    // which must NOT become a fabricated "bien calibré" verdict. The gate keys on the
    // confidence_declared history (h.signal.kind), so the result is empty — and never leaks a number.
    const verdicts = host.calibrationFor(sessionId, "c1");
    expect(verdicts).toHaveLength(0);
    for (const v of verdicts) expect(v.message).not.toMatch(/[0-9]/);
  });
});
