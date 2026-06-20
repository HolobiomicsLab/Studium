// notebook.ts — Studium as a VS Code NotebookController.
//
// The "kernel" is not Python — it is the Studium lesson runtime (lesson-mcp). Each run of the
// driver cell advances the lesson one turn and renders the now-current scene as rich cell output:
// prose (markdown), equations (markdown math), and spectra/plots (Vega-Lite, rendered natively by
// VS Code's built-in notebook renderer). Interactive 3D (orbital/molecule) is surfaced as a note +
// served by the companion artifact pane; a dedicated NotebookRenderer is the documented next step.
import * as vscode from "vscode";
import { resolve, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Json = Record<string, any>;
const NB_TYPE = "studium-lesson";

function cfg<T>(key: string, fallback: T): T {
  const v = vscode.workspace.getConfiguration("studium").get<T>(key);
  return v === undefined || v === "" ? fallback : v;
}

interface Sess { client: Client; sid: string; bundleRef: string; learnerId: string; call: (n: string, a: Json) => Promise<Json>; }

function driverCells(): vscode.NotebookCellData[] {
  const intro = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Markup,
    "# Studium lesson\nRun the cell below to **start**. To advance, re-run it:\n" +
    "- empty or `next` → continue\n- a quiz choice id (`a`, `b`, …) → answer\n- `0`–`4` → a confidence checkpoint\n\n" +
    "Spectra and plots render inline (with a Vega-capable notebook renderer). The companion " +
    "**Studium — Lesson** pane is the full-fidelity surface: rotatable 3D orbitals/molecules and KaTeX equations.",
    "markdown",
  );
  const driver = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "start", "studium");
  return [intro, driver];
}

export function registerStudiumNotebook(context: vscode.ExtensionContext) {
  const sessions = new Map<string, Sess>();
  let order = 0;

  const serializer: vscode.NotebookSerializer = {
    deserializeNotebook(content) {
      let meta: Json = {};
      try { meta = JSON.parse(new TextDecoder().decode(content) || "{}"); } catch { /* new/empty file */ }
      const data = new vscode.NotebookData(driverCells());
      data.metadata = { bundle_ref: meta.bundle_ref, learner_id: meta.learner_id };
      return data;
    },
    serializeNotebook(data) {
      const m = data.metadata || {};
      return new TextEncoder().encode(JSON.stringify({ bundle_ref: m.bundle_ref, learner_id: m.learner_id }, null, 2));
    },
  };

  const controller = vscode.notebooks.createNotebookController("studium", NB_TYPE, "Studium");
  controller.supportedLanguages = ["studium"];
  controller.supportsExecutionOrder = true;
  controller.description = "Studium lesson runtime";

  async function startSession(notebook: vscode.NotebookDocument): Promise<Sess> {
    const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
    const tsx = resolve(repoRoot, "node_modules/.pnpm/node_modules/.bin/tsx");
    const mcpDir = resolve(repoRoot, "apps/lesson-mcp");
    const bundlesRoot = cfg<string>("bundlesRoot", join(repoRoot, "fixtures"));
    const bundleRef = (notebook.metadata?.bundle_ref as string) || cfg<string>("bundleRef", "atomistique-l1/lesson.json");
    const learnerId = (notebook.metadata?.learner_id as string) || cfg<string>("learnerId", "vscode-learner");
    const env: Record<string, string> = { ...process.env as any, BUNDLES_ROOT: bundlesRoot };
    const transport = new StdioClientTransport({ command: tsx, args: ["src/index.ts"], cwd: mcpDir, env, stderr: "ignore" });
    const client = new Client({ name: "studium-notebook", version: "0.1.0" });
    await client.connect(transport);
    const call = async (n: string, a: Json): Promise<Json> => {
      const r: any = await client.callTool({ name: n, arguments: a });
      const data = JSON.parse(r.content?.[0]?.text ?? "{}");
      if (r.isError) throw new Error(`${n}: ${data.error}`);
      return data;
    };
    return { client, sid: "", bundleRef, learnerId, call };
  }

  function directiveToInput(d: string, scene: Json): Json {
    if (scene.type === "quiz") return { kind: "quiz_choice", choiceId: /^[a-f]$/.test(d) ? d : (scene.choices?.[0]?.id ?? "a") };
    if (scene.type === "meta_checkpoint") { const v = parseInt(d, 10); return { kind: "confidence", value: Number.isNaN(v) ? 2 : Math.max(0, Math.min(4, v)) }; }
    if (scene.type === "ai_critique") return { kind: "critique", text: d || "(no critique)" };
    return { kind: "ack" };
  }

  const md = (s: string) => vscode.NotebookCellOutputItem.text(s, "text/markdown");

  // Each content piece is its OWN NotebookCellOutput (stacked vertically). Items WITHIN one output
  // are ALTERNATIVE representations of the same thing — used here so a plot prefers the Vega-Lite
  // renderer and falls back to a markdown note when no Vega renderer is installed.
  async function buildSceneOutputs(sess: Sess, presentation: Json, transition: Json | null): Promise<vscode.NotebookCellOutput[]> {
    const arts = (await sess.call("get_scene_artifacts", { session_id: sess.sid })).scene_assets || [];
    const sc = presentation.scene || {};
    const outs: vscode.NotebookCellOutput[] = [];
    let head = `### ${sc.title || sc.type}\n`;
    if (presentation.total) head += `*scene ${(presentation.index ?? 0) + 1} / ${presentation.total}*\n\n`;
    if (transition && (transition.kind === "replay" || transition.kind === "remediate_alt")) head += `> ⟳ ${transition.reason}\n\n`;
    if (sc.markdown) head += sc.markdown + "\n";
    outs.push(new vscode.NotebookCellOutput([md(head)]));

    for (const a of arts as Json[]) {
      if (a.kind === "equation_latex" && a.payload) {
        outs.push(new vscode.NotebookCellOutput([md(`$$\n${a.payload}\n$$`)]));
      } else if ((a.kind === "plot_spec" || a.kind === "spectrum") && a.payload) {
        const items: vscode.NotebookCellOutputItem[] = [];
        let spec: unknown = null;
        try { spec = JSON.parse(a.payload); } catch { /* fall back to the note */ }
        if (spec) items.push(vscode.NotebookCellOutputItem.json(spec, "application/vnd.vegalite.v5+json"));
        items.push(md(`📈 *${a.title || a.kind}* — interactive plot (renders with a Vega-capable notebook renderer; always in the *Studium — Lesson* pane).`));
        outs.push(new vscode.NotebookCellOutput(items));
      } else if (a.kind === "orbital" || a.kind === "mol_3d") {
        outs.push(new vscode.NotebookCellOutput([md(`🧬 **${a.title || a.kind}** — rotate it in the *Studium — Lesson* pane (${a.format || a.kind}).`)]));
      } else if (a.title) {
        outs.push(new vscode.NotebookCellOutput([md(`📎 *${a.kind}* — ${a.title}`)]));
      }
    }

    if (sc.type === "quiz") {
      outs.push(new vscode.NotebookCellOutput([md(`**${sc.question}**\n\n` + (sc.choices || []).map((c: Json) => `- \`${c.id}\`  ${c.text}`).join("\n") +
        `\n\n*Type a choice id in the cell above and re-run.*`)]));
    } else if (sc.type === "meta_checkpoint") {
      outs.push(new vscode.NotebookCellOutput([md(`*${sc.pre_question}* — type \`0\`–\`4\` and re-run.`)]));
    } else if (sc.type === "ai_critique") {
      outs.push(new vscode.NotebookCellOutput([md(`*Write your critique in the cell above and re-run.*`)]));
    }

    const mastery = presentation.learnerSnapshot?.conceptMastery || {};
    const mk = Object.entries(mastery);
    if (mk.length) outs.push(new vscode.NotebookCellOutput([md("**Mastery** · " + mk.map(([k, v]) => `${k.replace(/^concept:/, "")} ${(v as number).toFixed(2)}`).join("  ·  "))]));

    return outs;
  }

  // VS Code does NOT serialize executeHandler calls, so two quick runs of the driver cell could
  // race the session init (spawning two MCP clients) or read a stale scene between get/submit. We
  // chain every run of a given notebook through a per-uri promise queue so they execute in order.
  const cellQueues = new Map<string, Promise<void>>();
  function runCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
    const key = notebook.uri.toString();
    const next = (cellQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => runCellInner(cell, notebook));
    cellQueues.set(key, next.catch(() => {}));
    return next;
  }

  async function runCellInner(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument) {
    const exec = controller.createNotebookCellExecution(cell);
    exec.executionOrder = ++order;
    exec.start(Date.now());
    const key = notebook.uri.toString();
    try {
      let sess = sessions.get(key);
      if (!sess) {
        sess = await startSession(notebook);
        sessions.set(key, sess);
        const started = await sess.call("start_lesson_session", { bundle_ref: sess.bundleRef, learner_id: sess.learnerId });
        sess.sid = started.session_id;
        exec.replaceOutput(await buildSceneOutputs(sess, started.presentation, null));
        exec.end(true, Date.now());
        return;
      }
      const cur = await sess.call("get_current_scene", { session_id: sess.sid });
      const input = directiveToInput(cell.document.getText().trim().toLowerCase(), cur.presentation.scene);
      const t = (await sess.call("submit_response", { session_id: sess.sid, input })).transition;
      if (t.kind === "complete") {
        exec.replaceOutput([new vscode.NotebookCellOutput([md(`✔ **Lesson complete** — ${t.summary.scenesCompleted} scenes, autonomy ${(t.summary.autonomyRatio ?? 0).toFixed(2)}`)])]);
        exec.end(true, Date.now());
        return;
      }
      exec.replaceOutput(await buildSceneOutputs(sess, t.presentation, t));
      exec.end(true, Date.now());
    } catch (e) {
      // any failure (MCP transport crash, RPC error) → drop the dead session so the next run
      // reconnects instead of retrying on a broken transport forever.
      const dead = sessions.get(key);
      if (dead) { dead.client.close().catch(() => {}); sessions.delete(key); }
      exec.replaceOutput([new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.error(e as Error),
        md("_session reset — run the cell again to reconnect._"),
      ])]);
      exec.end(false, Date.now());
    }
  }

  controller.executeHandler = async (cells, notebook) => { for (const c of cells) await runCell(c, notebook); };

  const closeSub = vscode.workspace.onDidCloseNotebookDocument((nb) => {
    const key = nb.uri.toString();
    const s = sessions.get(key);
    if (s) { s.client.close().catch(() => {}); sessions.delete(key); }
    cellQueues.delete(key);
  });

  const openCmd = vscode.commands.registerCommand("studium.openLessonNotebook", async () => {
    const data = new vscode.NotebookData(driverCells());
    data.metadata = { bundle_ref: cfg<string>("bundleRef", "atomistique-l1/lesson.json"), learner_id: cfg<string>("learnerId", "vscode-learner") };
    const nb = await vscode.workspace.openNotebookDocument(NB_TYPE, data);
    await vscode.window.showNotebookDocument(nb);
  });

  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(NB_TYPE, serializer),
    controller, closeSub, openCmd,
  );
}
