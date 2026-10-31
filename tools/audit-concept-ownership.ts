/** Diagnostic on unchanged fixture lessons. Reports ownership/routing differences; does not choose an assessment authority. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LessonBundleSchema, type LessonBundle, type Scene } from "../packages/lesson-bundle-schema/src/index.ts";
import { LessonSession } from "../packages/lesson-session/src/session.ts";
import {
  graphAwareNextIndex,
  sceneConceptId,
} from "../packages/lesson-session/src/graph-nav.ts";
import {
  buildTestDeps,
  InMemoryEventLog,
} from "../packages/lesson-session/src/testing.ts";
import type { ResponseInput, Transition } from "../packages/lesson-session/src/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRIMARY = `${ROOT}/fixtures/atomistique-l1/lesson.json`;
const SECONDARY = `${ROOT}/fixtures/m6/demo-atomistique/lesson.json`;

function load(path: string): LessonBundle {
  return LessonBundleSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function assessesAudit(bundle: LessonBundle) {
  const edges = bundle.learning_workflow_graph?.edges.filter((edge) => edge.relation === "assesses") ?? [];
  const rows = edges.map((edge) => {
    const sceneId = edge.source.startsWith("task:") ? edge.source.slice("task:".length) : edge.source;
    const scene = bundle.scenes.find((candidate) => candidate.id === sceneId);
    const runtimeConcept = scene ? sceneConceptId(scene) : null;
    return {
      sceneId,
      runtimeConcept,
      assessesTarget: edge.target,
      aligned: runtimeConcept === edge.target,
    };
  });
  return {
    bundleId: bundle.bundle_id,
    validatedByPresent: bundle.validated_by.length > 0,
    scenes: bundle.scenes.length,
    hasLwg: bundle.learning_workflow_graph != null,
    assessesEdges: edges.length,
    alignedEdges: rows.filter((row) => row.aligned).length,
    divergentEdges: rows.filter((row) => !row.aligned),
  };
}

function learnerInput(scene: Scene): ResponseInput {
  // Learner-path rule: inspect only fields a learner needs to act. Never read
  // `correct`, claims, key_points, model_correction, or any expected answer.
  switch (scene.type) {
    case "intro":
    case "concept":
    case "reproduction":
    case "discussion":
      return { kind: "ack" };
    case "quiz": {
      const firstVisibleChoice = scene.choices[0]?.id;
      if (!firstVisibleChoice) throw new Error(`quiz ${scene.id} has no visible choice`);
      return { kind: "quiz_choice", choiceId: firstVisibleChoice };
    }
    case "meta_checkpoint":
      return { kind: "confidence", value: 2 };
    case "ai_critique":
      return { kind: "critique", text: "Réponse simulée sans consultation de clé." };
    case "spot_the_flaw":
      return { kind: "flaw_report", text: "Réponse simulée sans consultation de clé." };
    case "explain_back":
      return { kind: "explanation", text: "Réponse simulée sans consultation de clé." };
    case "comparison":
      return { kind: "comparison", text: "Réponse simulée sans consultation de clé." };
    case "summary_audit":
      return { kind: "summary_audit", text: "Réponse simulée sans consultation de clé." };
    case "prompt_practice":
      return { kind: "prompt_submission", text: "Réponse simulée sans consultation de clé." };
    case "communication_sim":
      return { kind: "communication", text: "Réponse simulée sans consultation de clé." };
  }
}

function nextPresentation(transition: Transition) {
  if (transition.kind === "complete") throw new Error("lesson completed before target scene");
  return transition.presentation;
}

async function sessionOwnershipCase(bundle: LessonBundle) {
  const targetId = "s5-quiz-carbone";
  const deps = buildTestDeps();
  const session = new LessonSession(bundle, deps);
  let presentation = await session.start();
  const visited: string[] = [presentation.scene.id];
  let steps = 0;
  while (presentation.scene.id !== targetId) {
    if (steps++ >= 120) throw new Error(`target ${targetId} not reached in 120 steps`);
    presentation = nextPresentation(await session.respond(learnerInput(presentation.scene)));
    visited.push(presentation.scene.id);
  }

  const scene = presentation.scene;
  if (scene.type !== "quiz") throw new Error(`${targetId} is not a quiz`);
  const runtimeConcept = sceneConceptId(scene);
  const assessesTarget = bundle.learning_workflow_graph?.edges.find(
    (edge) => edge.relation === "assesses" && edge.source === `task:${targetId}`,
  )?.target ?? null;
  const runtimeStateKey = runtimeConcept?.slice("concept:".length) ?? "";
  const graphStateKey = assessesTarget?.slice("concept:".length) ?? "";
  const before = session.getState();
  const beforeRuntimeAttempts = before.concept_states[runtimeStateKey]?.total_attempts ?? 0;
  const beforeGraphAttempts = before.concept_states[graphStateKey]?.total_attempts ?? 0;

  // Select the first visible choice by id; do not inspect its answer-key flag.
  await session.respond(learnerInput(scene));
  const after = session.getState();
  const answerRecord = (deps.eventLog as InMemoryEventLog).records.findLast(
    (record) => record.event_type === "answer_submitted" && record.payload["scene_id"] === targetId,
  );

  return {
    targetScene: targetId,
    stepsToFirstEncounter: steps,
    visits: visited.length,
    runtimeConcept,
    assessesTarget,
    emittedSignalConcept: answerRecord?.payload["concept_id"] ?? null,
    runtimeConceptAttemptDelta:
      (after.concept_states[runtimeStateKey]?.total_attempts ?? 0) - beforeRuntimeAttempts,
    assessesConceptAttemptDelta:
      (after.concept_states[graphStateKey]?.total_attempts ?? 0) - beforeGraphAttempts,
    correctionKeyReadByDriver: false,
  };
}

function graphRoutingCase(bundle: LessonBundle) {
  const targetId = "s8-reproduction-periodique";
  const targetIndex = bundle.scenes.findIndex((scene) => scene.id === targetId);
  if (targetIndex < 1 || !bundle.learning_workflow_graph) throw new Error("routing case unavailable");
  const edge = bundle.learning_workflow_graph.edges.find(
    (candidate) => candidate.relation === "assesses" && candidate.source === `task:${targetId}`,
  );
  if (!edge) throw new Error(`missing assesses edge for ${targetId}`);

  // Same real graph and mastery state in both calls. The second call changes
  // only the candidate's primary concept to the graph's assesses target.
  const mastery = {
    "concept:c-remplissage": 0.9,
    "concept:c-configuration": 0.9,
    "concept:c-spectres": 0.2,
  };
  const actual = graphAwareNextIndex(
    bundle.scenes,
    targetIndex - 1,
    bundle.learning_workflow_graph,
    mastery,
  );
  const graphTargetRef = edge.target.slice("concept:".length);
  const alignedScenes = bundle.scenes.map((scene) =>
    scene.id === targetId
      ? { ...scene, concept_refs: [graphTargetRef, ...scene.concept_refs.filter((ref) => ref !== graphTargetRef)] }
      : scene,
  );
  const graphAligned = graphAwareNextIndex(
    alignedScenes,
    targetIndex - 1,
    bundle.learning_workflow_graph,
    mastery,
  );

  return {
    targetScene: targetId,
    currentIndex: targetIndex - 1,
    targetIndex,
    runtimeConcept: sceneConceptId(bundle.scenes[targetIndex]!),
    assessesTarget: edge.target,
    mastery,
    actual,
    graphAligned,
    actualDestinationScene: actual.index == null ? null : bundle.scenes[actual.index]?.id ?? null,
    graphAlignedDestinationScene:
      graphAligned.index == null ? null : alignedScenes[graphAligned.index]?.id ?? null,
  };
}

async function main() {
  const primary = load(PRIMARY);
  const secondary = load(SECONDARY);
  const result = {
    measuredAtCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    bundles: [assessesAudit(primary), assessesAudit(secondary)],
    sessionOwnershipCase: await sessionOwnershipCase(primary),
    graphRoutingCase: graphRoutingCase(primary),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
