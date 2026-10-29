// session-workspace.ts — the file-based agentic-session channel (`.studium-session/`).
//
// The capsule-backed lesson outsources EXECUTION + RENDERING to the VS Code host and a pluggable
// agentic operator (Copilot / Claude Code / Codex / opencode). Studium stays the lesson BRAIN and
// talks to the operator over two channels: MCP (typed/live — see apps/lesson-mcp) and THIS file
// protocol (universal — any assistant can read/write plain files). Studium and the workspace go
// back and forth through one small folder:
//
//   .studium-session/
//     task.md       Studium -> operator : the current step, REDACTED (no answer key). What to do.
//     response.json operator -> Studium : the learner's submission  ({kind,...} or {text}).
//     feedback.md   Studium -> operator : the graded outcome + whether it advanced.
//     index.json    the shared memory/log : one entry per step (scene id/type + status).
//
// The answer key (claims / flaws_expected / model_*) is stripped by publicScene BEFORE it is ever
// written to task.md, so the operator (and the model behind it) audits the AI reading WITHOUT being
// handed the solution — the redaction boundary holds at the FILE edge, exactly as it does over MCP.
// Execution + rendering of the real artifact (the capsule run's figure) is the HOST's job; Studium
// only references it here and grades the JUDGMENT the operator writes back.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionHost } from "./host.js";
import { publicScene, publicTransition } from "./public-scene.js";
import { parseRunResult, type RunResult } from "./run-result.js";
import { expectedKind, operatorContext, operatorContextMarkdown, responseFor } from "./operator-context.js";

const FILES = {
  task: "task.md", response: "response.json", feedback: "feedback.md", index: "index.json",
  // LEARNER-TIME RUN channel: Studium emits the manifest, the operator runs + writes the result back.
  run: "run.json", runResult: "run_result.json",
} as const;

// scene type -> the free-text ResponseInput kind its grader requires (mirror of studium-vscode
// scene-io.ts + lesson-session graders.ts). Operators may instead write an explicit {kind,...};
// control scenes (intro/concept/reproduction/discussion) and anything unmapped fall back to ack.
export interface WorkspaceStepEntry {
  step: number;
  scene_id: string;
  scene_type: string;
  status: "awaiting_response" | "graded" | "complete" | "awaiting_run" | "ran";
  // recorded for a learner-time run step (status "ran"): the learner's OWN executed result summary.
  landmark?: string | null;
  passed?: boolean;
  artifacts?: string[];
}
export interface WorkspaceIndex {
  session_id: string;
  entries: WorkspaceStepEntry[];
}

/**
 * Bridges a SessionHost session to the `.studium-session/` file protocol, so an external agentic
 * operator drives the lesson by reading/writing plain files. Stateless except for a step counter;
 * the durable state lives in the host (mastery/history) and the folder (the index/log).
 */
export class SessionWorkspace {
  private step = 0;
  constructor(private readonly host: SessionHost, private readonly dir: string) {}

  /** Studium -> operator: write the REDACTED current task + real-artifact reference; log "awaiting".
   * A scene carrying a `run_manifest` is a LEARNER-TIME RUN: Studium emits a non-answer-bearing
   * `run.json` + a provision-&-run task and WITHHOLDS the author landmark (the learner produces a
   * fresh result by running it). Execution is the host/operator's job — Studium never runs it. */
  async writeStep(sessionId: string): Promise<void> {
    const pres = this.host.currentPresentation(sessionId) as { scene: Record<string, unknown> };
    const scene = publicScene(pres.scene as never) as Record<string, unknown>; // answer key stripped HERE
    const context = operatorContextMarkdown(operatorContext(this.host, sessionId));
    await mkdir(this.dir, { recursive: true });
    const manifest = scene.run_manifest as Record<string, unknown> | undefined;
    // A run scene revisited after a detour, with the learner's run already recorded: a response task
    // (ack) — the operator may still re-run and write run_result.json, which ingest() picks up first.
    if (manifest && !scene.learner_run_recorded) {
      await rm(join(this.dir, FILES.runResult), { force: true }); // fresh run scene: no stale result
      await writeFile(join(this.dir, FILES.run), JSON.stringify(manifest, null, 2), "utf8");
      await writeFile(join(this.dir, FILES.task), renderRunTask(scene, manifest, this.step) + context, "utf8");
      await this.append(sessionId, {
        step: this.step, scene_id: String(scene.id ?? ""), scene_type: String(scene.type ?? ""),
        status: "awaiting_run",
      });
      return;
    }
    await rm(join(this.dir, FILES.run), { force: true }); // leaving a run scene: clear the stale manifest
    const assets = this.host.sceneArtifacts(sessionId) as Array<Record<string, unknown>>;
    await writeFile(join(this.dir, FILES.task), renderTask(scene, assets, this.step) + context, "utf8");
    await this.append(sessionId, {
      step: this.step,
      scene_id: String(scene.id ?? ""),
      scene_type: String(scene.type ?? ""),
      status: "awaiting_response",
    });
  }

  /** operator -> Studium: read response.json into a ResponseInput for the current scene type.
   * Returns null when there is no readable response yet (absent OR a partial/invalid write — both
   * "not ready, retry"). A present `text` is mapped to the scene's required kind; a mismatched explicit
   * `kind` WITH text is coerced to the right kind; a structural mismatch is passed through for ingest's
   * guard to handle gracefully (so a bad response never wedges the channel). */
  async readResponse(sceneType: string): Promise<Record<string, unknown> | null> {
    let raw: string;
    try { raw = await readFile(join(this.dir, FILES.response), "utf8"); } catch { return null; } // absent = not ready
    let r: Record<string, unknown>;
    try { r = JSON.parse(raw); } catch { return null; }                  // partial/invalid write = not ready (retry)
    const expected = expectedKind(sceneType);
    if (r && typeof r.kind === "string") {
      if (r.kind === expected) return r;                                 // explicit + correct
      if (typeof r.text === "string") return { kind: expected, text: r.text }; // mismatched-with-text: coerce
      return r;                                                          // structural mismatch: ingest's catch handles it
    }
    if (r && typeof r.text === "string") return expected === "ack" ? { kind: "ack" } : { kind: expected, text: r.text };
    return { kind: "ack" };                                              // empty / control scene
  }

  /** Grade the operator's response, write feedback, advance, write the next task (or mark complete).
   * Never throws on operator error: a missing/partial response writes a "not ready" note; a bad/mismatched
   * input is CONSUMED + a corrective feedback.md is written so the operator can retry — the channel
   * self-heals instead of deadlocking on an un-consumed bad response.json. */
  async ingest(sessionId: string): Promise<{ done: boolean; transition: string }> {
    const pres = this.host.currentPresentation(sessionId) as { scene: { type: string; run_manifest?: unknown; learner_run_recorded?: boolean } };
    if (pres.scene.run_manifest) {
      // learner-time run scene: a run already recorded makes the run optional — a fresh run_result.json
      // still counts (re-run), otherwise the operator's response.json (ack) advances.
      const hasResult = await readFile(join(this.dir, FILES.runResult), "utf8").then(() => true, () => false);
      if (!pres.scene.learner_run_recorded || hasResult) return this.ingestRun(sessionId);
    }
    const sceneType = pres.scene.type;
    const input = await this.readResponse(sceneType);
    if (!input) {                                                        // no valid response yet — don't wedge
      await writeFile(join(this.dir, FILES.feedback),
        "# Feedback\n\n⚠️ Pas de `response.json` valide trouve. Ecris ta reponse puis relance.\n", "utf8");
      return { done: false, transition: "awaiting" };
    }
    let t: Record<string, unknown>;
    try {
      t = publicTransition(await this.host.respond(sessionId, input as never)) as unknown as Record<string, unknown>;
    } catch (e) {                                                        // bad/mismatched input — self-heal
      await rm(join(this.dir, FILES.response), { force: true });         // consume the bad file (no re-wedge)
      await writeFile(join(this.dir, FILES.feedback),
        `# Feedback\n\n⚠️ Reponse invalide pour cette scene (${(e as Error).message}). ` +
        `Attendu : \`{ "kind": "${expectedKind(sceneType)}", "text": "…" }\` (ou simplement \`{ "text": "…" }\`). ` +
        "Reecris `response.json` et relance.\n", "utf8");
      return { done: false, transition: "invalid_response" };
    }
    await rm(join(this.dir, FILES.response), { force: true });          // consume on success: no stale re-ingest
    await this.markGraded(sessionId);
    await writeFile(join(this.dir, FILES.feedback), renderFeedback(t), "utf8");
    if (t.kind === "complete") {
      this.step += 1;
      await this.append(sessionId, { step: this.step, scene_id: "", scene_type: "", status: "complete" });
      return { done: true, transition: "complete" };
    }
    this.step += 1;
    await this.writeStep(sessionId);
    return { done: false, transition: String(t.kind) };
  }

  /** operator -> Studium for a LEARNER-TIME RUN scene: read run_result.json (the operator's run output),
   * record the learner's OWN executed result, and gate "you actually ran it" on `ran && passed`. Studium
   * never executes — it only validates + records + advances. Self-heals like the response channel:
   * missing/partial waits; a non-completed/failed run is consumed with a corrective note, no wedge. */
  private async ingestRun(sessionId: string): Promise<{ done: boolean; transition: string }> {
    let raw: string;
    try { raw = await readFile(join(this.dir, FILES.runResult), "utf8"); }
    catch {
      await this.writeRunFeedback(
        "⚠️ Pas de `run_result.json`. Provisionne l'environnement, lance la commande de `run.json` " +
        "dans CET espace de travail, puis ecris `run_result.json`.");
      return { done: false, transition: "awaiting_run" };
    }
    const result = parseRunResult(raw);
    if (!result) { // partial / invalid write — keep the file, the atomic writer will complete it
      await this.writeRunFeedback("⚠️ `run_result.json` invalide ou partiel. Reecris-le (ecriture atomique).");
      return { done: false, transition: "awaiting_run" };
    }
    // SHARED run-ingest core (host.ingestRunResult) — gates on ran && passed, records the learner's run
    // (so a later reference_from_run judgment grounds on it) and advances. The file channel adds only its
    // own I/O (consume run_result.json, write feedback.md + the next task) around it, so the MCP and file
    // channels can't drift on the gating logic.
    let r: { status: string; transition: unknown; learnerRunRecorded: boolean };
    try { r = await this.host.ingestRunResult(sessionId, result); }
    catch (e) {
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(`⚠️ Run ingere mais l'avancement a echoue (${(e as Error).message}).`);
      return { done: false, transition: "invalid_run" };
    }
    if (r.status === "run_incomplete") {
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(
        "⚠️ Le run n'a pas abouti (`ran:false`). Provisionne l'env (installe les dependances de " +
        "`run.json`), relance la commande, puis reecris `run_result.json`.");
      return { done: false, transition: "run_incomplete" };
    }
    if (r.status === "run_failed_checks") {
      const failing = result.checks.filter((c) => !c.passed).map((c) => c.check);
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(
        `⚠️ Run produit mais verifications echouees : ${failing.join(" ; ") || "voir expected_outputs"}. ` +
        "Corrige et relance.");
      return { done: false, transition: "run_failed_checks" };
    }
    if (r.status !== "ran" || !r.transition) { // not_a_run_scene — should not happen (ingest routes run scenes)
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback("⚠️ `run_result.json` ignore : la scene courante n'est pas une scene a executer.");
      return { done: false, transition: "invalid_run" };
    }
    // ran && passed: the host recorded the learner's run + advanced. Mark the step + write the next task.
    await this.markRan(sessionId, result);
    const t = publicTransition(r.transition as Parameters<typeof publicTransition>[0]) as unknown as Record<string, unknown>;
    await rm(join(this.dir, FILES.runResult), { force: true }); // consume: next scene starts fresh
    await writeFile(join(this.dir, FILES.feedback), renderRunFeedback(result, t), "utf8");
    if (t.kind === "complete") {
      await rm(join(this.dir, FILES.run), { force: true }); // session over: clear the stale manifest too
      this.step += 1;
      await this.append(sessionId, { step: this.step, scene_id: "", scene_type: "", status: "complete" });
      return { done: true, transition: "complete" };
    }
    this.step += 1;
    await this.writeStep(sessionId);
    return { done: false, transition: String(t.kind) };
  }

  private async writeRunFeedback(body: string): Promise<void> {
    await writeFile(join(this.dir, FILES.feedback), `# Feedback\n\n${body}\n`, "utf8");
  }

  /** Mark the latest awaiting_run step "ran" and record the learner's executed-result summary (auditable). */
  private async markRan(sessionId: string, result: RunResult): Promise<void> {
    const idx = await this.readIndex(sessionId);
    for (let i = idx.entries.length - 1; i >= 0; i--) {
      if (idx.entries[i]!.status === "awaiting_run") {
        idx.entries[i]!.status = "ran";
        idx.entries[i]!.landmark = result.landmark ?? null;
        idx.entries[i]!.passed = result.passed;
        idx.entries[i]!.artifacts = result.artifacts;
        break;
      }
    }
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }

  private async readIndex(sessionId: string): Promise<WorkspaceIndex> {
    try { return JSON.parse(await readFile(join(this.dir, FILES.index), "utf8")); }
    catch { return { session_id: sessionId, entries: [] }; }
  }
  private async append(sessionId: string, entry: WorkspaceStepEntry): Promise<void> {
    const idx = await this.readIndex(sessionId);
    idx.entries.push(entry);
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }
  private async markGraded(sessionId: string): Promise<void> {
    const idx = await this.readIndex(sessionId);
    for (let i = idx.entries.length - 1; i >= 0; i--) {
      if (idx.entries[i]!.status === "awaiting_response") { idx.entries[i]!.status = "graded"; break; }
    }
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }
}

function instructionFor(type: string): string {
  switch (type) {
    case "spot_the_flaw": return "Audite la lecture IA ci-dessous d'un resultat REELLEMENT execute. Repere ce qui est faux (avec justification).";
    case "ai_critique": return "Critique les affirmations ci-dessous : repere les biais / defauts.";
    case "explain_back": return "Explique le concept avec tes propres mots.";
    case "comparison": return "Compare A et B et nomme les differences / la valeur ajoutee.";
    case "summary_audit": return "Audite le resume IA : quelles omissions ou distorsions ?";
    case "prompt_practice": return "Ecris (ou affine) un prompt pour la tache ci-dessous.";
    case "communication_sim": return "Redige la communication demandee pour la situation ci-dessous.";
    case "quiz": return 'Reponds : { "kind": "quiz_choice", "choiceId": "<id>" }.';
    case "meta_checkpoint": return 'Auto-evalue ta confiance : { "kind": "confidence", "value": 0-4 }.';
    default: return "Lis, puis reponds pour avancer.";
  }
}

function renderTask(scene: Record<string, unknown>, assets: Array<Record<string, unknown>>, step: number): string {
  const s = scene as Record<string, string | undefined>;
  const L: string[] = [];
  L.push(`# Studium — etape ${step} : ${s.title || s.type}`, "");
  if (scene.learner_run_recorded) {
    L.push("", `**Run deja enregistre** (mesure : \`${String(scene.learner_run_landmark ?? "")}\`). Pas besoin de re-provisionner :`,
      "reponds `{ \"kind\": \"ack\" }` pour continuer, ou relance et ecris `run_result.json` pour un resultat frais.", "");
  }
  L.push(`**Type de scene :** \`${s.type}\``, "");
  L.push(instructionFor(String(s.type)), "");
  if (s.markdown) L.push(s.markdown, "");
  if (s.flawed_content) L.push("## Lecture IA a auditer", "", s.flawed_content, "");
  if (s.prompt) L.push(s.prompt, "");
  if (s.artifact_a) L.push("**A.**", "", s.artifact_a, "");
  if (s.artifact_b) L.push("**B.**", "", s.artifact_b, "");
  if (s.source_content) L.push("**Source :**", "", s.source_content, "");
  if (s.ai_summary) L.push("**Resume IA :**", "", s.ai_summary, "");
  if (s.scenario) L.push(`**Situation :** ${s.scenario}`, "");
  if (s.task) L.push(`**Tache :** ${s.task}`, "");

  // SECURITY: host.sceneArtifacts() is NOT publicScene-redacted (known asymmetry). So we surface ONLY
  // the executed_result asset and ONLY an explicit allowlist of its meta keys (landmark/path/cmd/passed)
  // — never arbitrary asset kinds or whole meta. A future asset kind that copied an answer-bearing field
  // into meta would otherwise leak into task.md; keep this allowlist tight.
  const exec = assets.find((a) => a.kind === "executed_result");
  if (exec) {
    const m = (exec.meta as Record<string, unknown>) || {};
    L.push("## Resultat reellement execute (verite terrain — audite la lecture IA CONTRE ce resultat)", "");
    if (m.landmark) L.push(`- **Mesure (landmark) :** \`${String(m.landmark)}\``);
    if (exec.path) L.push(`- **Figure :** \`${String(exec.path)}\` (rendue nativement par l'hote / le notebook)`);
    if (m.cmd) L.push(`- **Commande :** \`${Array.isArray(m.cmd) ? (m.cmd as string[]).join(" ") : String(m.cmd)}\``);
    if (m.passed != null) L.push(`- **Verifications passees :** ${String(m.passed)}`);
    L.push("");
  }

  L.push("## Repondre", "Ecris ta reponse dans `response.json` (ce dossier) :", "```json");
  L.push(JSON.stringify(responseFor(scene, false).example, null, 2));
  L.push("```", '_(ou simplement `{ "text": "..." }` — Studium deduit le bon type d\'entree.)_');
  return L.join("\n") + "\n";
}

function renderFeedback(t: Record<string, unknown>): string {
  const reason = typeof t.reason === "string" ? t.reason : "";
  // The verdict is the ONLY place the quiz feedback reaches the learner now (the public scene no
  // longer carries feedback_correct / feedback_incorrect): say it first, then where the lesson goes.
  const v = t.verdict as { graded?: boolean; correct?: boolean; feedback?: string } | undefined;
  const verdictLine = v?.feedback ? `${v.correct === false ? "✗ Faux" : "✓ Juste"} — ${v.feedback}\n\n` : "";
  const nav = t.navigation as { returns_to?: string } | undefined;
  switch (t.kind) {
    case "next": return `# Feedback\n\n${verdictLine}✓ Reponse enregistree — passage a l'etape suivante (\`task.md\` mis a jour).\n`;
    case "replay": return `# Feedback\n\n${verdictLine}↻ A revoir : ${reason || "maitrise insuffisante"}. La prochaine tache revient dessus.\n`;
    case "remediate_alt": return `# Feedback\n\n${verdictLine}↻ Remediation : ${reason}. Une variante est proposee.\n`;
    case "remediate": return `# Feedback\n\n${verdictLine}↻ Prerequis non maitrise : ${reason}. Detour par une scene du prerequis${nav?.returns_to ? ` ; retour ensuite a \`${nav.returns_to}\`` : ""}.\n`;
    case "calibration": return "# Feedback\n\n⚖️ Point de calibration : compare ta confiance a ta maitrise reelle.\n";
    case "complete": {
      const n = (t.summary as Record<string, unknown> | undefined)?.scenesCompleted;
      return `# Feedback\n\n✔ Lecon terminee — ${n ?? "?"} scenes.\n`;
    }
    default: return `# Feedback\n\n(${String(t.kind)})\n`;
  }
}

/** Render the provision-&-run task for a learner-time reproduction scene. Surfaces ONLY how to run
 * (capsule ref / install / cmd / produced file names / file-existence checks) — NEVER the expected
 * values or the author's landmark. The host/operator owns env + install + execution; Studium never runs. */
function renderRunTask(scene: Record<string, unknown>, manifest: Record<string, unknown>, step: number): string {
  const s = scene as Record<string, string | undefined>;
  const m = manifest;
  const L: string[] = [];
  L.push(`# Studium — etape ${step} : ${s.title || s.type} (reproduction)`, "");
  L.push("**Type de scene :** `reproduction` — execution PAR L'APPRENANT (l'hote provisionne, tu lances).", "");
  if (s.markdown) L.push(s.markdown, "");
  L.push("## Provisionne et lance (dans CET espace de travail)", "");
  if (m.research_question) L.push(`**Question :** ${String(m.research_question)}`, "");
  L.push(`- **Capsule :** \`${String(m.capsule_ref ?? "")}\``);
  const reqs = Array.isArray(m.requirements) ? (m.requirements as string[]) : [];
  if (reqs.length) L.push(`- **Installe :** ${reqs.join(", ")}`);
  const cmd = Array.isArray(m.cmd) ? (m.cmd as string[]).join(" ") : String(m.cmd ?? "");
  L.push(`- **Lance :** \`${cmd}\`${m.working_dir ? ` (dans \`${String(m.working_dir)}\`)` : ""}`);
  const outs = Array.isArray(m.expected_outputs) ? (m.expected_outputs as string[]) : [];
  if (outs.length) L.push(`- **Sorties attendues :** ${outs.map((o) => `\`${o}\``).join(", ")}`);
  const checks = Array.isArray(m.verify_checks) ? (m.verify_checks as string[]) : [];
  if (checks.length) { L.push("- **Verifie :**"); for (const c of checks) L.push(`  - ${c}`); }
  L.push("");
  L.push("## Rends compte du run", "Quand le run a produit les sorties, ecris `run_result.json` (ce dossier) :", "```json");
  L.push(JSON.stringify({
    ran: true, passed: true,
    landmark: "<la mesure que TON run a produite, depuis stdout>",
    artifacts: outs,
    checks: checks.map((c) => ({ check: c, passed: true })),
  }, null, 2));
  L.push("```", "_(Studium ne lance rien : c'est TON run reel dans l'espace de travail qui fait foi.)_");
  return L.join("\n") + "\n";
}

function renderRunFeedback(result: RunResult, t: Record<string, unknown>): string {
  const lm = result.landmark ? ` (mesure : \`${result.landmark}\`)` : "";
  if (t.kind === "complete") {
    const n = (t.summary as Record<string, unknown> | undefined)?.scenesCompleted;
    return `# Feedback\n\n✔ Run ingere${lm} — lecon terminee (${n ?? "?"} scenes).\n`;
  }
  return `# Feedback\n\n✓ Run ingere${lm} — tu as reproduit le resultat toi-meme. Etape suivante (\`task.md\` mis a jour).\n`;
}
