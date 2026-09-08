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
  /** Optional regex that isolates the learner's OWN landmark line in captured stdout. When absent, the
   * last non-empty stdout line is used (deterministic capsules print their headline statistic last).
   * A FORM matcher, never a value — the graded number is withheld by the protocol. */
  landmark_pattern?: string;
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

/** Quote a shell argument conservatively (single-quote, escaping embedded single quotes). POSIX quoting —
 * correct for the default macOS/Linux shells the capsule runs under. NOTE: on Windows the run executes via
 * cmd.exe (spawn shell:true), which does not honour single quotes, so a token OUTSIDE the safe charset
 * below (e.g. an arg with a space, or a `python -c "..."` cmd) would mis-parse there; ordinary tokens
 * (`python run.py`, `numpy==1.26.4`) are emitted unquoted and run fine. Windows-correct quoting is a
 * follow-up — the current colleague-test round is macOS/Linux. */
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

/** Extract the learner's OWN landmark from captured stdout. With a `landmark_pattern` (regex) the first
 * capturing group — or the whole match — is the landmark; without one, the last non-empty line is used
 * (a deterministic capsule prints its headline statistic last, e.g. `MODIFIED_COSINE=0.6477 …`). Returns
 * null when nothing matches (a landmark-less run is then correctly QUARANTINED by attestation, not passed
 * with a null landmark). Pure + headless-testable — the FORM is checked, the value is never interpreted. */
export function extractLandmark(stdout: string | null | undefined, pattern?: string): string | null {
  const text = stdout ?? "";
  if (pattern) {
    let re: RegExp | null = null;
    try { re = new RegExp(pattern); } catch { re = null; }
    if (!re) return null;
    const mm = re.exec(text);
    return mm ? (mm[1] ?? mm[0]).trim() : null;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length ? lines[lines.length - 1]! : null;
}

/** Evaluate the manifest's verify_checks against the workspace + the captured run. Understood forms:
 *   - `file exists: <path>`        — an expected output was produced (resolved under working_dir)
 *   - `stdout contains: <substr>`  — the pipeline printed an expected marker (presence, not a value)
 *   - `landmark matches: <regex>`  — the learner's landmark has the expected FORM (e.g. MODIFIED_COSINE=[0-9.]+)
 * An unrecognized check is reported NOT passed (conservative — never falsely "passed"). Deliberately NO
 * exact-value / tolerance check: verify_checks are non-answer-bearing by design (scenes.ts:156), so the
 * graded number is never pinned in the public manifest — only its presence and form are gated here. The
 * `fileExists` fn + `ctx` (captured landmark/stdout) are injected so this stays pure + headless-testable. */
export function evaluateChecks(
  m: RunManifest,
  fileExists: (path: string) => boolean,
  ctx: { landmark?: string | null; stdout?: string | null } = {},
): Array<{ check: string; passed: boolean }> {
  const landmark = ctx.landmark ?? "";
  const stdout = ctx.stdout ?? "";
  return m.verify_checks.map((check) => {
    const t = check.trim();
    let mm: RegExpExecArray | null;
    if ((mm = /^file exists:\s*(.+)$/i.exec(t)) && mm[1]) {
      return { check, passed: fileExists(underWorkingDir(m.working_dir, mm[1].trim())) };
    }
    if ((mm = /^stdout contains:\s*(.+)$/i.exec(t)) && mm[1]) {
      return { check, passed: stdout.includes(mm[1].trim()) };
    }
    if ((mm = /^landmark matches:\s*(.+)$/i.exec(t)) && mm[1]) {
      let re: RegExp | null = null;
      try { re = new RegExp(mm[1].trim()); } catch { re = null; }
      return { check, passed: !!re && re.test(landmark) };
    }
    return { check, passed: false };
  });
}

/** Assemble the run_result.json contract after the task ran. `ran` = the task actually spawned
 * (exitCode != null); `passed` = exit 0 AND every expected_output is present AND every verify_check
 * passes. The AUTHOR landmark is withheld by the protocol; any landmark here is the learner's OWN (e.g.
 * parsed from stdout) and defaults to null. Mirrors what an agentic operator writes to run_result.json. */
export function buildRunResult(
  m: RunManifest,
  o: { exitCode: number | null; fileExists: (path: string) => boolean; landmark?: string | null; stdout?: string },
): RunResult {
  const ran = o.exitCode !== null;
  // Evaluate verify_checks against the FULL captured stdout (a `stdout contains:` marker printed early in
  // a verbose run must not be missed), but transmit only a bounded tail as stdout_tail on the wire.
  const checks = evaluateChecks(m, o.fileExists, { landmark: o.landmark, stdout: o.stdout });
  const outputs = m.expected_outputs.map((p) => underWorkingDir(m.working_dir, p));
  const present = outputs.filter((p) => o.fileExists(p));
  const passed = ran && o.exitCode === 0 && present.length === outputs.length && checks.every((c) => c.passed);
  const stdoutTail = o.stdout != null ? (o.stdout.length > 4000 ? o.stdout.slice(-4000) : o.stdout) : undefined;
  return {
    ran,
    passed,
    landmark: o.landmark ?? null,
    artifacts: present,
    checks,
    stdout_tail: stdoutTail,
    provenance: { cmd: m.cmd, env: "vscode workspace" },
  };
}
