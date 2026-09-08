// session-runner.ts — the operator HARNESS: drive a full Studium session over the `.studium-session/`
// file channel with a PLUGGABLE operator.
//
// runStudiumSession() runs the loop: writeStep (Studium) -> operator (produce response.json) -> ingest
// (Studium grades + advances) until the lesson completes. The operator is the seam:
//   - stubOperator   : deterministic, key-free placeholder that self-drives the loop (for demos/tests).
//   - watchOperator  : waits for an EXTERNAL agent (Claude Code / Copilot / Codex / a human) to write
//                      response.json in the workspace — this is the real "any assistant drives it" mode;
//                      Studium never calls a model, the IDE's operator does.
//   - (your own)     : an LLM-backed operator reads task.md, calls a model, writes response.json.
//
// Studium stays the brain: it never executes the science and never produces the judgment — it writes the
// redacted task, ingests the operator's answer, and grades. The answer-key redaction lives in
// SessionWorkspace (publicScene), so the harness inherits it for free.

import { writeFile, readFile, access, rename } from "node:fs/promises";
import { join } from "node:path";
import type { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";

const TASK = "task.md";
const RESPONSE = "response.json";
const RUN_RESULT = "run_result.json";

export interface OperatorCtx {
  dir: string;
  sessionId: string;
  sceneType: string;
  step: number;
  // "run" => this is a LEARNER-TIME RUN scene: the operator PROVISIONS + RUNS the capsule in the
  // workspace and writes `run_result.json` (not `response.json`). Studium never executes — see run.json.
  // Optional + back-compatible: absent ⇒ treated as "response" (the default channel).
  expects?: "response" | "run";
}

/** An operator's job: ensure a valid `response.json` (or `run_result.json` when ctx.expects==="run")
 * exists in ctx.dir for the current task. */
export type Operator = (taskMarkdown: string, ctx: OperatorCtx) => Promise<void>;

export interface SessionRunResult {
  sessionId: string;
  steps: number;
  transitions: string[];
  completed: boolean;
}

/** Atomically write response.json (tmp + rename) — the protocol's convention, so a reader never sees
 * a half-written file. Exposed so operators (and tests) write responses the safe way. */
export async function writeResponse(dir: string, response: Record<string, unknown>): Promise<void> {
  const tmp = join(dir, RESPONSE + ".tmp");
  await writeFile(tmp, JSON.stringify(response), "utf8");
  await rename(tmp, join(dir, RESPONSE));
}

/** Atomically write run_result.json — what a learner-time-run operator writes after provisioning + running
 * the capsule in the workspace (Studium never executes). Atomic (tmp + rename) so a reader never sees a
 * half-written file. */
export async function writeRunResult(dir: string, result: Record<string, unknown>): Promise<void> {
  const tmp = join(dir, RUN_RESULT + ".tmp");
  await writeFile(tmp, JSON.stringify(result), "utf8");
  await rename(tmp, join(dir, RUN_RESULT));
}

/** Drive a session from `bundleRef` to completion, one operator turn per scene. */
export async function runStudiumSession(
  host: SessionHost,
  bundleRef: string,
  dir: string,
  operator: Operator,
  opts: { maxSteps?: number; learnerId?: string } = {},
): Promise<SessionRunResult> {
  const maxSteps = opts.maxSteps ?? 100;
  const { sessionId } = await host.create(bundleRef, opts.learnerId ?? "agent-operator");
  const ws = new SessionWorkspace(host, dir);
  const transitions: string[] = [];

  await ws.writeStep(sessionId);
  let step = 0;
  for (; step < maxSteps; step++) {
    const pres = host.currentPresentation(sessionId) as { scene: { type: string; run_manifest?: unknown } };
    const task = await readFile(join(dir, TASK), "utf8");
    const expects = pres.scene.run_manifest ? ("run" as const) : ("response" as const);
    await operator(task, { dir, sessionId, sceneType: pres.scene.type, step, expects });
    const r = await ws.ingest(sessionId);
    transitions.push(r.transition);
    if (r.done) return { sessionId, steps: step + 1, transitions, completed: true };
    // "awaiting"/"invalid_response" did NOT advance — task.md is unchanged; the operator gets another
    // turn next iteration (self-heal). maxSteps backstops a misbehaving operator.
  }
  return { sessionId, steps: step, transitions, completed: false };
}

/**
 * A deterministic, key-free PLACEHOLDER operator that drives the loop to completion. It does NOT
 * produce real judgments — a real operator (an LLM or an agentic assistant) reads task.md and writes a
 * genuine answer. The stub exists so the harness/round-trip runs reproducibly without a model.
 */
export const stubOperator: Operator = async (_task, ctx) => {
  if (ctx.expects === "run") {
    // PLACEHOLDER: the REAL agentic operator provisions + runs the capsule in the workspace and reports the
    // genuine result. The stub fakes a passing run (no real execution) so the key-free harness completes.
    await writeRunResult(ctx.dir, {
      ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
      artifacts: ["outputs/stats.csv", "figures/decay.png"],
      checks: [
        { check: "file exists: outputs/stats.csv", passed: true },
        { check: "file exists: figures/decay.png", passed: true },
      ],
      provenance: { cmd: ["python", "scripts/run.py"], env: "operator workspace (stub)" },
    });
    return;
  }
  const t = ctx.sceneType;
  let resp: Record<string, unknown>;
  if (t === "spot_the_flaw" || t === "summary_audit" || t === "ai_critique") {
    resp = { text: "Je releve des incoherences : unites de la constante et demi-vie mal deduite — a verifier." };
  } else if (t === "explain_back" || t === "comparison" || t === "communication_sim" || t === "prompt_practice") {
    resp = { text: "Reponse operateur (placeholder) couvrant les points cles attendus." };
  } else if (t === "quiz") {
    resp = { kind: "quiz_choice", choiceId: "a" };
  } else if (t === "meta_checkpoint") {
    resp = { kind: "confidence", value: 3 };
  } else {
    resp = { kind: "ack" };
  }
  await writeResponse(ctx.dir, resp);
};

/**
 * The real "any assistant drives it" operator: it produces NOTHING and instead WAITS for an external
 * agent (Claude Code / Copilot / Codex / a human in the same workspace) to write a complete, parseable
 * response.json. Studium never calls a model — the operator is whoever is editing the workspace.
 */
/** Minimal LLM surface the operator needs: prompt in, completion out. Decoupled from any provider so a
 * test injects a deterministic stub and the demo binds @studium/llm-client (mock or litellm). */
export interface OperatorLlm { complete(prompt: string): Promise<string>; }

const _LLM_FREE_TEXT_SCENES = new Set([
  "spot_the_flaw", "ai_critique", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim",
]);

/** A REAL LLM-backed operator: it reads the (redacted) task and produces a genuine answer.
 *  - RUN scene  → the operator OWNS execution: it reads run.json and ACTUALLY runs the capsule via the
 *    injected `runCapsule` (Studium still never executes), then writes run_result.json.
 *  - judgment / free-text scene → calls the LLM with the task and writes its critique as {text} (Studium
 *    maps {text} to the scene's required kind).
 *  - quiz/meta/control → a deterministic answer (the LLM drives the JUDGMENT, which is the point).
 * Both deps are injected, so the loop is exercised key-free with a stub LLM + a fake runner; the demo
 * binds a real model + a real capsule_runner spawn. */
export function makeLlmOperator(deps: {
  llm: OperatorLlm;
  runCapsule: (manifest: Record<string, unknown>, ctx: OperatorCtx) => Promise<Record<string, unknown>>;
}): Operator {
  return async (task, ctx) => {
    if (ctx.expects === "run") {
      let manifest: Record<string, unknown> = {};
      try { manifest = JSON.parse(await readFile(join(ctx.dir, "run.json"), "utf8")); } catch { /* also described in task.md */ }
      await writeRunResult(ctx.dir, await deps.runCapsule(manifest, ctx));
      return;
    }
    if (ctx.sceneType === "quiz") { await writeResponse(ctx.dir, { kind: "quiz_choice", choiceId: _firstChoiceId(task) }); return; }
    if (ctx.sceneType === "meta_checkpoint") { await writeResponse(ctx.dir, { kind: "confidence", value: 3 }); return; }
    if (_LLM_FREE_TEXT_SCENES.has(ctx.sceneType)) {
      const answer = await deps.llm.complete(_operatorPrompt(task));
      await writeResponse(ctx.dir, { text: answer }); // Studium maps {text} -> the scene's required kind
      return;
    }
    await writeResponse(ctx.dir, { kind: "ack" }); // intro / concept / reproduction(non-run) / discussion
  };
}

function _operatorPrompt(task: string): string {
  return [
    "Tu es l'apprenant-operateur dans une lecon Studium. Voici la tache courante (redigee, SANS cle de reponse) :",
    "", task, "",
    "Reponds par TON jugement/critique en texte clair, avec justification, en t'appuyant sur le resultat reel " +
      "affiche. N'invente pas de valeurs ; ne demande jamais la cle de reponse.",
  ].join("\n");
}

function _firstChoiceId(task: string): string {
  // best-effort: pick a choice id rendered in the task (the demo bundle has no quiz). Falls back to "a".
  const m = task.match(/\bid[)\s:]*`?([a-zA-Z0-9_-]+)`?\s*[—:-]/) ?? task.match(/"choiceId":\s*"([^"]+)"/);
  return m?.[1] && m[1] !== "<id>" ? m[1] : "a";
}

export function watchOperator(opts: { pollMs?: number; timeoutMs?: number } = {}): Operator {
  const pollMs = opts.pollMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 0; // 0 = wait forever
  return async (_task, ctx) => {
    // a learner-time RUN scene waits for run_result.json (the operator ran it in the workspace);
    // any other scene waits for response.json. Studium never produces either — the operator does.
    const path = join(ctx.dir, ctx.expects === "run" ? RUN_RESULT : RESPONSE);
    const start = Date.now();
    for (;;) {
      try {
        await access(path);
        JSON.parse(await readFile(path, "utf8")); // require a COMPLETE write (atomic rename guarantees this)
        return;
      } catch {
        /* absent or partial — keep waiting */
      }
      if (timeoutMs && Date.now() - start > timeoutMs) {
        throw new Error("watchOperator: timed out waiting for response.json");
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };
}
