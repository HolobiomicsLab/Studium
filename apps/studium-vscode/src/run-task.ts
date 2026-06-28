// run-task.ts — surface the learner-time RUN manifest as a NATIVE VS Code task, client-side.
//
// The run protocol (get_run_manifest / submit_run_result over lesson-mcp) is pure delegation: Studium
// NEVER executes — the OPERATOR provisions the env, installs deps, and runs the capsule in their own
// workspace. In VS Code the operator's environment IS the user's workspace, so we turn the manifest
// into a shell command a vscode.Task runs in the integrated terminal (the user/agent triggers it), then
// assemble the run_result.json contract from what the run produced. The host still never runs anything.
//
// Framework-free + dependency-free (esbuild bundles only `vscode` + the MCP SDK + typed-graph-lens, so
// this can't import @studium/* — the RunManifest / RunResult shapes are mirrored here, kept in lockstep
// with packages/lesson-bundle-schema RunManifestSchema + packages/lesson-session-host run-result.ts).

/** Mirror of RunManifestSchema (packages/lesson-bundle-schema/src/scenes.ts). NON-answer-bearing. */
export interface RunManifest {
  capsule_ref: string;
  cmd: string[];
  working_dir?: string;
  timeout_s?: number;
  requirements?: string[];
  expected_outputs: string[];
  verify_checks: string[];
  research_question?: string;
}

/** Mirror of RunResultSchema (packages/lesson-session-host/src/run-result.ts) — what submit_run_result wants. */
export interface RunResult {
  ran: boolean;
  passed: boolean;
  landmark: string | null;
  artifacts: string[];
  checks: Array<{ check: string; passed: boolean }>;
  stdout_tail?: string;
  provenance: { cmd: string[]; env: string };
}

/** A framework-free task description the extension turns into a vscode.Task (ShellExecution). */
export interface RunTaskSpec {
  /** Human label shown in the task picker / terminal. */
  name: string;
  /** The shell command run IN THE WORKSPACE: provision (install requirements) then run `cmd`. */
  command: string;
  /** Working directory (relative to the workspace folder); "." when the manifest declares none. */
  cwd: string;
}

/** Quote a shell argument conservatively (single-quote, escaping embedded single quotes). */
function sh(arg: string): string {
  if (/^[A-Za-z0-9_./:=-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** posix-join a manifest-relative path onto the (optional) working_dir, normalizing "." */
function underWorkingDir(workingDir: string | undefined, p: string): string {
  const base = workingDir && workingDir.length ? workingDir.replace(/\/+$/, "") : "";
  const rel = p.replace(/^\/+/, "");
  return base ? `${base}/${rel}` : rel;
}

/** Build the shell command a native VS Code task runs to provision + run the capsule in the workspace.
 * Studium never executes — VS Code (the operator's env) does. `pip` is injectable (e.g. "uv pip install"). */
export function runManifestToTaskSpec(m: RunManifest, opts: { pip?: string } = {}): RunTaskSpec {
  const cwd = m.working_dir && m.working_dir.length ? m.working_dir : ".";
  const parts: string[] = [];
  if (m.requirements && m.requirements.length) {
    const pip = opts.pip ?? "pip install";
    parts.push(`${pip} ${m.requirements.map(sh).join(" ")}`);
  }
  parts.push(m.cmd.map(sh).join(" "));
  return { name: `Studium · run ${m.capsule_ref}`, command: parts.join(" && "), cwd };
}

/** Evaluate the manifest's verify_checks against the workspace. Only "file exists: <path>" is understood
 * today; an unrecognized check is reported NOT passed (conservative — never falsely "passed"). Paths are
 * resolved under working_dir. `fileExists` is injected (the extension passes fs.existsSync over an
 * absolute join; a test passes a stub) so this stays pure + headless-testable. */
export function evaluateChecks(
  m: RunManifest,
  fileExists: (path: string) => boolean,
): Array<{ check: string; passed: boolean }> {
  return m.verify_checks.map((check) => {
    const fe = /^file exists:\s*(.+)$/i.exec(check.trim());
    if (fe && fe[1]) return { check, passed: fileExists(underWorkingDir(m.working_dir, fe[1].trim())) };
    return { check, passed: false };
  });
}

/** Assemble the run_result.json contract after the task ran. `ran` = the task actually spawned
 * (exitCode != null); `passed` = exit 0 AND every expected_output is present AND every verify_check
 * passes. The AUTHOR landmark is withheld by the protocol; any landmark here is the learner's OWN (e.g.
 * parsed from stdout) and defaults to null. Mirrors what an agentic operator writes to run_result.json. */
export function buildRunResult(
  m: RunManifest,
  o: { exitCode: number | null; fileExists: (path: string) => boolean; landmark?: string | null; stdoutTail?: string },
): RunResult {
  const ran = o.exitCode !== null;
  const checks = evaluateChecks(m, o.fileExists);
  const outputs = m.expected_outputs.map((p) => underWorkingDir(m.working_dir, p));
  const present = outputs.filter((p) => o.fileExists(p));
  const passed = ran && o.exitCode === 0 && present.length === outputs.length && checks.every((c) => c.passed);
  return {
    ran,
    passed,
    landmark: o.landmark ?? null,
    artifacts: present,
    checks,
    stdout_tail: o.stdoutTail,
    provenance: { cmd: m.cmd, env: "vscode workspace" },
  };
}
