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

export interface OperatorCtx {
  dir: string;
  sessionId: string;
  sceneType: string;
  step: number;
}

/** An operator's job: ensure a valid `response.json` exists in ctx.dir for the current task. */
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
    const pres = host.currentPresentation(sessionId) as { scene: { type: string } };
    const task = await readFile(join(dir, TASK), "utf8");
    await operator(task, { dir, sessionId, sceneType: pres.scene.type, step });
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
export function watchOperator(opts: { pollMs?: number; timeoutMs?: number } = {}): Operator {
  const pollMs = opts.pollMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 0; // 0 = wait forever
  return async (_task, ctx) => {
    const path = join(ctx.dir, RESPONSE);
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
