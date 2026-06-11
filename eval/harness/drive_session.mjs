// eval/harness/drive_session.mjs
// Stage 2 — DRIVE THE SESSION (in-process, per-scene present->decide->respond).
//
// Imports LessonSession directly from @studium/lesson-session and loops
// start()/respond(), consulting a pluggable student policy per turn (so the
// student SEES each scene before answering — unlike the static-script CLI).
// Uses DURABLE node adapters (FileStateStore + Jsonl logs) under a
// per-persona outDir so the two personas never collide in a shared store
// (design risk #6 — lessonId-only keying). Sets a non-default pseudonym secret.
//
// Run via:  pnpm --filter @studium/lesson-session exec tsx eval/harness/drive_session.mjs <argsJson>
// argsJson (absolute path) = { bundlePath, persona, outDir, live, maxTurns,
//                              pseudoSecret?, personaPrompt?, model? }
// Emits <outDir>/driver_result.json + events.jsonl + telemetry.jsonl + state.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { LessonSession } from "@studium/lesson-session";
import { loadBundleZip, loadBundleJson } from "@studium/lesson-session/node";
import {
  SystemClock,
  RandomIdGen,
  HmacPseudonymProvider,
  FileStateStore,
  JsonlEventLog,
  JsonlTelemetrySink,
  StubReasoningScorer,
  LiteLLMReasoningScorer,
  StubCritiqueEvaluator,
  HttpCritiqueEvaluator,
} from "@studium/lesson-session/node";
import { getPolicy } from "./personas.mjs";

function buildDeps(outDir, live, pseudoSecret) {
  return {
    stateStore: new FileStateStore(outDir),
    eventLog: new JsonlEventLog(`${outDir}/events.jsonl`),
    telemetry: new JsonlTelemetrySink(`${outDir}/telemetry.jsonl`),
    pseudonym: new HmacPseudonymProvider(pseudoSecret),
    clock: new SystemClock(),
    idGen: new RandomIdGen(),
    reasoningScorer: live
      ? new LiteLLMReasoningScorer({
          mode: "litellm",
          baseUrl: process.env["LITELLM_BASE_URL"] ?? "",
          ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}),
        })
      : new StubReasoningScorer(),
    critiqueEvaluator: live ? new HttpCritiqueEvaluator() : new StubCritiqueEvaluator(),
  };
}

async function loadBundle(path) {
  if (path.endsWith(".json")) return loadBundleJson(JSON.parse(await readFile(path, "utf8")));
  return loadBundleZip(path);
}

function sceneDigest(p) {
  const s = p.scene;
  return {
    index: p.index,
    total: p.total,
    scene_id: s.id,
    scene_type: s.type,
    concept_refs: s.concept_refs ?? [],
    explanation: p.explanation, // graph_prereq_gate / graph_universe_escalated etc.
    snapshot: p.learnerSnapshot,
  };
}

async function main() {
  const argsPath = process.argv[2];
  if (!argsPath) {
    console.error("usage: drive_session.mjs <argsJson path>");
    process.exit(2);
  }
  const args = JSON.parse(await readFile(argsPath, "utf8"));
  const { bundlePath, persona, outDir } = args;
  const live = Boolean(args.live);
  const maxTurns = args.maxTurns ?? 60;
  const pseudoSecret = args.pseudoSecret ?? process.env["STUDIUM_PSEUDO_SECRET"] ?? "eval-harness-secret";

  await mkdir(outDir, { recursive: true });
  const bundle = await loadBundle(bundlePath);
  const deps = buildDeps(outDir, live, pseudoSecret);
  const policy = getPolicy(persona, { personaPrompt: args.personaPrompt, model: args.model });
  // #4: thread a per-learner id (defaults to the persona name — a natural distinct learner id) so
  // the pseudonym is SALTED per learner. The 3rd ctor arg is `state` (undefined → default).
  const learnerId = args.learnerId ?? persona;
  const session = new LessonSession(bundle, deps, undefined, learnerId);

  const transcript = [];
  const transitions = [];
  let summary = null;
  let completed = false;
  let degraded = 0;

  let presentation = await session.start();
  for (let turn = 0; turn < maxTurns; turn++) {
    const turnRec = { turn, presented: sceneDigest(presentation) };
    let decision;
    try {
      decision = await policy.pick(presentation.scene, presentation.learnerSnapshot);
    } catch (e) {
      degraded += 1;
      turnRec.policy_error = String(e).slice(0, 300);
      decision = { input: { kind: "ack" } }; // safe fallback keeps the run going
    }
    if (decision.turns) {
      for (const t of decision.turns) await session.submitTurn(t);
      turnRec.discussion_turns = decision.turns.length;
    }
    turnRec.input = decision.input;
    const tr = await session.respond(decision.input);
    turnRec.transition_kind = tr.kind;
    if (tr.kind !== "complete") turnRec.next = sceneDigest(tr.presentation);
    transcript.push(turnRec);
    transitions.push(tr.kind === "complete" ? { kind: "complete" } : { kind: tr.kind, reason: tr.reason });
    if (tr.kind === "complete") {
      summary = tr.summary;
      completed = true;
      break;
    }
    presentation = tr.presentation;
  }

  await deps.telemetry.flush();

  const finalState = session.getState();
  const result = {
    persona,
    learner_id: learnerId,
    // #4: the salted pseudonym actually used for this run, so the audit can assert that distinct
    // learners on the same lesson got DISTINCT pseudonyms. (Telemetry only ever carries the
    // pseudonym, never the raw learner_id.)
    learner_pseudonym: session.getPseudonym(),
    live,
    completed,
    degraded_turns: degraded,
    n_turns: transcript.length,
    transition_kinds: transitions.map((t) => t.kind),
    transitions,
    summary: summary
      ? {
          totalDurationMs: summary.totalDurationMs,
          autonomyRatio: summary.autonomyRatio,
          scenesCompleted: summary.scenesCompleted,
        }
      : null,
    final_concept_mastery: Object.fromEntries(
      Object.entries(finalState.concept_states).map(([k, v]) => [k, v.alpha / (v.alpha + v.beta)]),
    ),
    final_state: finalState,
    transcript,
  };
  await writeFile(`${outDir}/driver_result.json`, JSON.stringify(result, null, 2), "utf8");
  // print a one-line summary for the Python orchestrator's log
  console.log(
    JSON.stringify({
      persona,
      completed,
      n_turns: transcript.length,
      transition_kinds: result.transition_kinds,
      autonomyRatio: result.summary?.autonomyRatio ?? null,
    }),
  );
  process.exit(completed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
