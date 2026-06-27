// Operation->judgment loop: a spot_the_flaw with `reference_from_run` is grounded on the LEARNER's OWN
// captured run (injected by scene() as reference_result), so the learner audits a flawed AI reading of
// the result THEY produced — and that judgment feeds trust_calibration (the north-star destination).
import { describe, it, expect } from "vitest";
import type { LessonBundle, ReferenceRun } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";

function loopBundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "LR", source_plan_id: "p1",
    metadata: { title: "T", target: "grad", duration_minutes: 10, language: "fr", discipline: "chem" },
    concepts: [{ id: "c-kin", title: "C", description: "d", bloom_level_target: "evaluate" }],
    scenes: [
      { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c-kin"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" },
      {
        id: "s-flaw", type: "spot_the_flaw", title: "Audite", objective_refs: ["c-kin"], concept_refs: ["c-kin"],
        estimated_seconds: 0, adaptation_hooks: [],
        flawed_content: "Lecture IA : k est sans dimension, demi-vie > 1h.",
        claims: [{ id: "f1", text: "sans dimension", flaws_expected: ["unites"] }],
        model_correction: "k est un taux ; demi-vie = ln2/k.",
        rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
        reference_from_run: "demo-decay-fit", // grounded on the LEARNER's run, not a pre-baked author run
      },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-06-28T00:00:00Z",
  } as unknown as LessonBundle;
}

const LEARNER_RUN: ReferenceRun = {
  ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", figure_path: "figures/decay.png",
  checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
  provenance: { capsule_doi: null, cmd: ["python", "scripts/run.py"], env: "learner workspace" },
};

describe("learner-run grounding (operation->judgment loop)", () => {
  it("a recorded learner run grounds the reference_from_run judgment (reference_result injected)", async () => {
    const s = new LessonSession(loopBundle(), buildTestDeps());
    await s.start();
    s.recordLearnerRun("demo-decay-fit", LEARNER_RUN);
    await s.respond({ kind: "ack" }); // intro -> s-flaw
    const scene = s.currentPresentation().scene as { type: string; reference_result?: { landmark?: string } };
    expect(scene.type).toBe("spot_the_flaw");
    expect(scene.reference_result).toBeDefined();
    expect(scene.reference_result!.landmark).toContain("k_fit=0.4212"); // the learner's OWN run
  });

  it("WITHOUT a recorded run, the judgment stays UNGROUNDED (no fabricated grounding)", async () => {
    const s = new LessonSession(loopBundle(), buildTestDeps());
    await s.start();
    await s.respond({ kind: "ack" }); // intro -> s-flaw, no run recorded
    const scene = s.currentPresentation().scene as { reference_result?: unknown };
    expect(scene.reference_result).toBeUndefined();
  });

  it("a run recorded under a DIFFERENT task_card_id does NOT ground this judgment (key must match)", async () => {
    const s = new LessonSession(loopBundle(), buildTestDeps());
    await s.start();
    s.recordLearnerRun("some-other-capsule", LEARNER_RUN); // mismatched key
    await s.respond({ kind: "ack" }); // -> s-flaw (reference_from_run = "demo-decay-fit")
    const scene = s.currentPresentation().scene as { reference_result?: unknown };
    expect(scene.reference_result).toBeUndefined(); // Map miss -> authored (ungrounded) scene
  });

  it("grading the learner-grounded judgment feeds trust_calibration (the destination dimension)", async () => {
    const s = new LessonSession(loopBundle(), buildTestDeps());
    await s.start();
    s.recordLearnerRun("demo-decay-fit", LEARNER_RUN);
    await s.respond({ kind: "ack" }); // -> s-flaw (grounded)
    await s.respond({ kind: "flaw_report", text: "k a des unites (1/temps), pas sans dimension" });
    const cs = (s.getState().concept_states as Record<string, { trust_calibration_samples?: number }>)["c-kin"];
    expect(cs?.trust_calibration_samples).toBeGreaterThanOrEqual(1);
  });
});
