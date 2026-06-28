#!/usr/bin/env -S npx tsx
// llm-operator-demo.ts — a REAL LLM-backed operator drives a full Studium lesson end to end:
//
//   tsx apps/lesson-mcp/src/llm-operator-demo.ts [bundleRef] [--dir=DIR] [--bundles-root=DIR] [--live]
//
// The operator OWNS execution (Studium still NEVER executes): on a reproduction(run_manifest) scene it
// ACTUALLY runs the capsule (python3 tools/capsule_runner.py — isolated uv venv) and reports run_result;
// on a spot_the_flaw it calls an LLM to JUDGE the flawed AI reading of the learner's OWN run. The judgment
// is graded by the real lesson brain and feeds trust_calibration. Default LLM is a deterministic
// placeholder (key-free, so the REAL capsule loop runs without a key); --live uses a LiteLLM /
// OpenAI-compatible endpoint (LITELLM_BASE_URL [+ LITELLM_API_KEY]).
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { SessionHost, runStudiumSession, makeLlmOperator, type OperatorLlm } from "@studium/lesson-session-host";

const execFileP = promisify(execFile);

/** The operator's LLM: a deterministic placeholder by default (key-free), or a live LiteLLM endpoint. */
function makeLlm(live: boolean): OperatorLlm {
  if (!live) {
    return { async complete() { return "k a des unites (1/temps), ce n'est pas sans dimension ; la demi-vie vaut ln2/k, pas une heure."; } };
  }
  const base = process.env["LITELLM_BASE_URL"];
  if (!base) throw new Error("--live needs LITELLM_BASE_URL (a LiteLLM / OpenAI-compatible endpoint).");
  const key = process.env["LITELLM_API_KEY"] ?? "";
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: process.env["LITELLM_MODEL"] ?? "studium/runtime-tutor", messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`LiteLLM ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return j.choices?.[0]?.message?.content ?? "";
    },
  };
}

/** The operator's executor: actually run the capsule via tools/capsule_runner.py (isolated uv venv) and
 * project its reproduction_result.json into a run_result. This is the OPERATOR running it — not Studium. */
function makeRealCapsuleRunner(repoRoot: string) {
  return async (manifest: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const capsuleDir = resolve(repoRoot, String(manifest["capsule_ref"] ?? ""));
    const out = mkdtempSync(join(tmpdir(), "capsule-run-"));
    // capsule_runner.py ALWAYS prints the result JSON to stdout (ran/deferred/no-executable exit 0;
    // env-error/timeout exit 1 but still print). Parse STDOUT — not reproduction_result.json, which is
    // only written on the "ran" path — so a safety-deferred / type-checked-only capsule degrades to an
    // honest {ran:false} run_result (the session self-heals) instead of an opaque ENOENT crash.
    let stdout = "";
    try {
      stdout = (await execFileP("python3", [join(repoRoot, "tools", "capsule_runner.py"), capsuleDir, "--out", out],
        { cwd: repoRoot, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
    } catch (e) { stdout = (e as { stdout?: string }).stdout ?? ""; } // env-error/timeout exit !=0 but still printed it
    let res: Record<string, unknown> = {};
    try { res = JSON.parse(stdout) as Record<string, unknown>; } catch { /* no parseable result -> ran:false below */ }
    const sa = (res["scene_assets"] ?? {}) as Record<string, unknown>;
    const artifacts: string[] = [];
    if (sa["image_path"]) artifacts.push(String(sa["image_path"]));
    const abs = sa["abs_asset"] as Record<string, unknown> | undefined;
    if (abs?.["payload_path"]) artifacts.push(String(abs["payload_path"]));
    return {
      ran: res["status"] === "ran", passed: !!res["passed"], landmark: res["landmark"] ?? null,
      artifacts, checks: res["checks"] ?? [], status: res["status"] ?? "no-output", reason: res["reason"] ?? null,
    };
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith("--"));
  const positionals = argv.filter((a) => !a.startsWith("--"));
  const eq = (name: string, fb: string): string => {
    const f = flags.find((x) => x.startsWith(`--${name}=`));
    return f ? f.split("=").slice(1).join("=") : fb;
  };
  const repoRoot = process.cwd();
  const bundleRef = positionals[0] ?? "capsule-loop-demo/lesson.json";
  const bundlesRoot = eq("bundles-root", process.env["BUNDLES_ROOT"] ?? resolve(repoRoot, "fixtures"));
  const dir = eq("dir", join(repoRoot, ".studium-session"));
  const live = flags.includes("--live");

  const host = new SessionHost({ bundlesRoot, live: false });
  const operator = makeLlmOperator({ llm: makeLlm(live), runCapsule: makeRealCapsuleRunner(repoRoot) });
  console.error(`[studium] LLM-operator demo  bundle=${bundleRef}  llm=${live ? "live (LiteLLM)" : "placeholder"}  dir=${dir}`);
  console.error("[studium] the operator RUNS the capsule on reproduction scenes (python3 tools/capsule_runner.py) and LLM-judges the grounded spot_the_flaw.");
  const res = await runStudiumSession(host, bundleRef, dir, operator, { maxSteps: 40 });
  const cs = (host.getState(res.sessionId) as { concept_states: Record<string, { trust_calibration?: number; trust_calibration_samples?: number }> }).concept_states;
  console.error(`[studium] ${res.completed ? "complete ✔" : "stopped"} after ${res.steps} steps: ${res.transitions.join(" → ")}`);
  for (const [cid, st] of Object.entries(cs)) {
    if (st.trust_calibration_samples) console.error(`[studium] trust_calibration(${cid})=${st.trust_calibration} over ${st.trust_calibration_samples} judged-run sample(s)`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
