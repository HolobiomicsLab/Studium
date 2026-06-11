import { describe, it, expect } from "vitest";
import { buildLwgMastery, sceneConceptId, firstSceneForConcept, firstAnswerGradedSceneForConcept, graphAwareNextIndex, MIN_MASTERY_ATTEMPTS } from "./graph-nav";
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";

const LWG: LearningWorkflowGraph = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:fourier", node_kind: "concept", title: "Fourier", bloom_level: "understand" },
    { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }],
};

const scenes = [
  { id: "s0", type: "intro", concept_refs: [] },
  { id: "s1", type: "concept", concept_refs: ["fourier"] },
  { id: "s2", type: "quiz", concept_refs: ["fft"] },
] as any[];

function cs(alpha: number, beta: number, total_attempts = MIN_MASTERY_ATTEMPTS) {
  return { concept_id: "x", alpha, beta, consecutive_errors: 0, total_attempts, total_correct: 0, confidence_calibration: 0 };
}

describe("graph-nav helpers", () => {
  it("buildLwgMastery re-prefixes concept_states keys to LWG concept ids", () => {
    const m = buildLwgMastery({ fourier: cs(9, 1) });
    expect(m["concept:fourier"]).toBeCloseTo(0.9);
  });

  it("MIN_MASTERY_ATTEMPTS is 3 (minimum-attempts floor before a concept can count as mastered)", () => {
    expect(MIN_MASTERY_ATTEMPTS).toBe(3);
  });

  it("buildLwgMastery OMITS a concept below the attempts floor (high mastery but too few attempts)", () => {
    // alpha=4,beta=1 -> mastery 0.8 (>= theta) but only 2 attempts -> NOT yet mastered -> omitted
    const m = buildLwgMastery({ fourier: cs(4, 1, 2) });
    expect("concept:fourier" in m).toBe(false);
  });

  it("buildLwgMastery INCLUDES a concept once it reaches the attempts floor", () => {
    const m = buildLwgMastery({ fourier: cs(4, 1, MIN_MASTERY_ATTEMPTS) });
    expect(m["concept:fourier"]).toBeCloseTo(0.8);
  });

  it("buildLwgMastery omits a concept exactly one attempt short of the floor", () => {
    const m = buildLwgMastery({ fourier: cs(9, 1, MIN_MASTERY_ATTEMPTS - 1) });
    expect("concept:fourier" in m).toBe(false);
  });

  it("buildLwgMastery honors a custom minAttempts argument", () => {
    expect("concept:fourier" in buildLwgMastery({ fourier: cs(9, 1, 1) }, 2)).toBe(false);
    expect(buildLwgMastery({ fourier: cs(9, 1, 2) }, 2)["concept:fourier"]).toBeCloseTo(0.9);
  });
  it("sceneConceptId prefixes concept_refs[0]; null when none", () => {
    expect(sceneConceptId(scenes[1])).toBe("concept:fourier");
    expect(sceneConceptId(scenes[0])).toBeNull();
  });
  it("firstSceneForConcept finds the scene index by LWG concept id", () => {
    expect(firstSceneForConcept(scenes, "concept:fourier")).toBe(1);
    expect(firstSceneForConcept(scenes, "concept:nope")).toBe(-1);
  });
  it("advances normally when the next scene's concept is available", () => {
    const r = graphAwareNextIndex(scenes, 1, LWG, { "concept:fourier": 0.9 }, 0.8);
    expect(r.index).toBe(2);
    expect(r.reason).toBe("advance");
  });
  it("advances to a concept-less scene without gating", () => {
    const r = graphAwareNextIndex(scenes, -1, LWG, {}, 0.8);
    expect(r.index).toBe(0);
  });
  it("advances to candidate when locked prereq has no answer-graded scene (no loop)", () => {
    // s1 is type:"concept" (ack-graded), so no answer-graded fourier scene -> advance to candidate (2)
    const r = graphAwareNextIndex(scenes, 1, LWG, { "concept:fourier": 0.3 }, 0.8);
    expect(r.index).toBe(2);
  });
  it("returns null at end of scenes", () => {
    const r = graphAwareNextIndex(scenes, 2, LWG, { "concept:fourier": 0.9 }, 0.8);
    expect(r.index).toBeNull();
  });
});

describe("graph-nav remediation is answer-graded", () => {
  const lwg = {
    schema_version: "1.0", course_id: "c",
    nodes: [
      { id: "concept:fourier", node_kind: "concept", title: "F", bloom_level: "understand" },
      { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
    ],
    edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }],
  } as any;

  it("routes remediation to the answer-graded quiz scene, not the ack intro", () => {
    // s0 intro(fourier, ack), s1 quiz(fourier, answer-graded), s2 quiz(fft, locked)
    // currentIdx=1 -> candidate=s2(fft, locked); unmet prereq=fourier; answer-graded fourier scene is s1
    const scenesAG = [
      { id: "s0", type: "intro", concept_refs: ["fourier"] },
      { id: "s1", type: "quiz", concept_refs: ["fourier"] },
      { id: "s2", type: "quiz", concept_refs: ["fft"] },
    ] as any[];
    const r = graphAwareNextIndex(scenesAG, 1, lwg, { "concept:fourier": 0.2 }, 0.8);
    expect(r.index).toBe(1);
    expect(r.reason).toBe("remediate");
  });

  it("firstAnswerGradedSceneForConcept skips ack scenes, returns quiz index", () => {
    const scenesAG = [
      { id: "s0", type: "intro", concept_refs: ["fourier"] },
      { id: "s1", type: "quiz", concept_refs: ["fourier"] },
    ] as any[];
    expect(firstAnswerGradedSceneForConcept(scenesAG, "concept:fourier")).toBe(1); // the quiz, not the intro
  });

  it("advances (no loop) when the prereq has only non-answer-graded scenes", () => {
    // fourier taught only by an intro (ack) -> cannot remediate -> advance to candidate (1)
    const scenesAck = [
      { id: "s0", type: "intro", concept_refs: ["fourier"] },
      { id: "s1", type: "quiz", concept_refs: ["fft"] },
    ] as any[];
    const r = graphAwareNextIndex(scenesAck, 0, lwg, { "concept:fourier": 0.2 }, 0.8);
    expect(r.index).toBe(1);
  });
});

describe("graphAwareNextIndex — skipMastered (pacing)", () => {
  // s0 concept(fourier), s1 quiz(fourier), s2 quiz(fft); fft requires fourier
  const scenes = [
    { id: "s0", type: "concept", concept_refs: ["fourier"] },
    { id: "s1", type: "quiz", concept_refs: ["fourier"] },
    { id: "s2", type: "quiz", concept_refs: ["fft"] },
  ] as any[];

  it("skips a mastered-concept scene and advances to the next unmastered+available scene", () => {
    // fourier mastered (0.9) so s1 (also fourier) is skipped; fft available (prereq fourier met) -> s2
    const r = graphAwareNextIndex(scenes, 0, LWG, { "concept:fourier": 0.9 }, 0.8, true);
    expect(r.index).toBe(2);
    expect(r.reason).toBe("skip_mastered");
  });

  it("does not skip when skipMastered=false (today's behavior)", () => {
    const r = graphAwareNextIndex(scenes, 0, LWG, { "concept:fourier": 0.9 }, 0.8, false);
    expect(r.index).toBe(1);          // advances to s1 (no skip)
    expect(r.reason).toBe("advance");
  });

  it("does not skip a concept-less scene", () => {
    const sc = [{ id: "x", type: "intro", concept_refs: [] }, { id: "y", type: "quiz", concept_refs: ["fourier"] }] as any[];
    const r = graphAwareNextIndex(sc, -1, LWG, {}, 0.8, true);
    expect(r.index).toBe(0);          // concept-less s0 is NOT mastered -> not skipped
    expect(r.reason).toBe("advance");
  });

  it("returns null when all remaining scenes are mastered", () => {
    const r = graphAwareNextIndex(scenes, 1, LWG, { "concept:fourier": 0.9, "concept:fft": 0.9 }, 0.8, true);
    expect(r.index).toBeNull();
  });

  it("remediation still fires under skipMastered when an unmastered prereq gate is hit", () => {
    // from s1, candidate s2 (fft) locked (fourier 0.3) -> remediate to the fourier QUIZ (s1)
    const r = graphAwareNextIndex(scenes, 1, LWG, { "concept:fourier": 0.3 }, 0.8, true);
    expect(r.index).toBe(1);
    expect(r.reason).toBe("remediate");
  });
});
