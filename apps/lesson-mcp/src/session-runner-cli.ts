#!/usr/bin/env -S npx tsx
// session-runner-cli.ts — the runnable OPERATOR HARNESS for the `.studium-session/` file channel.
//
//   tsx apps/lesson-mcp/src/session-runner-cli.ts <bundleRef> [--dir=DIR] [--bundles-root=DIR] [--language=BCP47] [--stub]
//
// Default (--watch): Studium writes `<dir>/task.md` and WAITS. You — or an agentic assistant in this
//   same workspace (Claude Code / Copilot / Codex / opencode) — read task.md, do the real work, and
//   write `<dir>/response.json` (atomically: response.json.tmp then rename). Studium ingests it, grades
//   via the real lesson brain, writes `feedback.md`, and emits the next task.md. Repeat to the end.
//   Studium never executes the science and never sees the answer key reach you (publicScene redaction).
// --stub: a key-free placeholder operator self-drives the loop to completion (a quick smoke demo).
import { resolve, join } from "node:path";
import { SessionHost, runStudiumSession, stubOperator, watchOperator } from "@studium/lesson-session-host";

function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith("--"));
  const positionals = argv.filter((a) => !a.startsWith("--"));
  const eq = (name: string, fb: string): string => {
    const f = flags.find((x) => x.startsWith(`--${name}=`));
    return f ? f.split("=").slice(1).join("=") : fb;
  };

  const bundleRef = positionals[0] ?? "capsule-judgment-demo/lesson.json";
  const bundlesRoot = eq("bundles-root", process.env.BUNDLES_ROOT ?? resolve(process.cwd(), "fixtures"));
  const dir = eq("dir", join(process.cwd(), ".studium-session"));
  const presentationLanguage = eq("language", "") || undefined;
  const mode = flags.includes("--stub") ? "stub" : "watch";

  const host = new SessionHost({ bundlesRoot, live: false });
  const operator = mode === "stub" ? stubOperator : watchOperator({ pollMs: 800 });

  console.error(`[studium] bundle=${bundleRef}  mode=${mode}  dir=${dir}`);
  if (mode === "watch") {
    console.error(`[studium] read ${dir}/task.md → write your judgment to ${dir}/response.json (atomic) → repeat.`);
  }
  const options = presentationLanguage ? { presentationLanguage } : {};
  return runStudiumSession(host, bundleRef, dir, operator, options).then((res) => {
    console.error(`[studium] ${res.completed ? "complete ✔" : "stopped"} after ${res.steps} steps: ${res.transitions.join(" → ")}`);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
