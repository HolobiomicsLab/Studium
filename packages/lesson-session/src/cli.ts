// packages/lesson-session/src/cli.ts
import { readFile } from "node:fs/promises";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import type { SessionDeps, ResponseInput, Transition, CompletionSummary } from "./types.js";
import { loadBundleZip, loadBundleJson } from "./adapters/bundle-loader.js";
import { SystemClock, RandomIdGen } from "./adapters/clock.js";
import { HmacPseudonymProvider } from "./adapters/pseudonym.js";
import { FileStateStore } from "./adapters/state-store.js";
import { JsonlEventLog } from "./adapters/event-log.js";
import { JsonlTelemetrySink } from "./adapters/telemetry-sink.js";
import { StubReasoningScorer, LiteLLMReasoningScorer } from "./adapters/reasoning-scorer.js";
import { LiteLLMSocraticTutor, StubSocraticTutor } from "./adapters/socratic-tutor.js";
import { StubCritiqueEvaluator, HttpCritiqueEvaluator } from "./adapters/critique-evaluator.js";

export interface ScriptStep { respond?: ResponseInput; turns?: string[]; }
export interface PlaythroughOptions { bundlePath: string; script: ScriptStep[]; outDir: string; live?: boolean; liveTutor?: boolean; stubTutor?: boolean; logTutorText?: boolean; }
export interface PlaythroughResult { completed: boolean; summary: CompletionSummary | null; transitions: Transition[]; }

export function buildNodeDeps(outDir: string, live: boolean, liveTutor = false, stubTutor = false): SessionDeps {
  const deps: SessionDeps = {
    stateStore: new FileStateStore(outDir),
    eventLog: new JsonlEventLog(`${outDir}/events.jsonl`),
    telemetry: new JsonlTelemetrySink(`${outDir}/telemetry.jsonl`),
    pseudonym: new HmacPseudonymProvider(process.env["STUDIUM_PSEUDO_SECRET"] ?? "dev-secret"),
    clock: new SystemClock(),
    idGen: new RandomIdGen(),
    reasoningScorer: live
      ? new LiteLLMReasoningScorer({ mode: "litellm", baseUrl: process.env["LITELLM_BASE_URL"] ?? "", ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}) })
      : new StubReasoningScorer(),
    critiqueEvaluator: live ? new HttpCritiqueEvaluator() : new StubCritiqueEvaluator(),
  };
  if (live && liveTutor) {
    deps.socraticTutor = new LiteLLMSocraticTutor({ mode: "litellm", baseUrl: process.env["LITELLM_BASE_URL"] ?? "", ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}) });
  } else if (stubTutor) {
    // deterministic Socratic tutor (no LLM/LiteLLM) — for CI + generating tutor_move telemetry
    // and a --log-tutor-text sidecar that the EV-3b BEA scorer can grade end-to-end.
    deps.socraticTutor = new StubSocraticTutor();
  }
  return deps;
}

async function loadBundleAuto(path: string): Promise<LessonBundle> {
  if (path.endsWith(".json")) return loadBundleJson(JSON.parse(await readFile(path, "utf8")));
  return loadBundleZip(path);
}

export async function runPlaythrough(opts: PlaythroughOptions): Promise<PlaythroughResult> {
  const bundle = await loadBundleAuto(opts.bundlePath);
  const deps = buildNodeDeps(opts.outDir, opts.live ?? false, opts.liveTutor ?? false, opts.stubTutor ?? false);
  const session = new LessonSession(bundle, deps);
  await session.start();
  const transitions: Transition[] = [];
  let summary: CompletionSummary | null = null;
  let completed = false;
  const tutorTexts: { scene_id: string; move_kind: string; text: string }[] = [];
  for (const step of opts.script) {
    if (step.turns) for (const t of step.turns) {
      await session.submitTurn(t);
      if (opts.logTutorText) {
        const m = session.getLastTutorMove();
        if (m) tutorTexts.push({ scene_id: "", move_kind: m.move_kind, text: m.text });
      }
    }
    if (step.respond) {
      const tr = await session.respond(step.respond);
      transitions.push(tr);
      if (tr.kind === "complete") { summary = tr.summary; completed = true; break; }
    }
  }
  await deps.telemetry.flush();
  if (opts.logTutorText) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${opts.outDir}/tutor-texts.jsonl`, tutorTexts.map((t) => JSON.stringify(t)).join("\n"));
  }
  return { completed, summary, transitions };
}

function argFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const bundlePath = argv[0];
  const scriptPath = argv[1];
  if (!bundlePath || !scriptPath) {
    console.error("usage: studium-lesson-play <bundle.zip|.json> <script.json> [--out dir] [--live-llm] [--live-tutor] [--stub-tutor] [--log-tutor-text]");
    return 2;
  }
  const outDir = argFlag(argv, "--out") ?? "./.playthrough";
  const live = argv.includes("--live-llm");
  const liveTutor = argv.includes("--live-tutor");
  const stubTutor = argv.includes("--stub-tutor");
  const logTutorText = argv.includes("--log-tutor-text");
  const script = JSON.parse(await readFile(scriptPath, "utf8")) as ScriptStep[];
  const res = await runPlaythrough({ bundlePath, script, outDir, live, liveTutor, stubTutor, logTutorText });
  console.log(JSON.stringify({ completed: res.completed, summary: res.summary }, null, 2));
  return res.completed ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
