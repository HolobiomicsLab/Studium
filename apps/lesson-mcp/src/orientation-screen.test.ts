// Audit 2026-11-10 (passe Fable, interface-harnais), over a real MCP client that renders MCP Apps:
//   A3  the status line said « à toi de t'évaluer » over a quiz waiting for an answer, and the help
//       ladder opened Explanation and Reference before any answer: orientation read a self-rating request
//       the view did not carry. No screen now states a pending self-rating without `rateRecall`;
//   A4  during a detour the minutes left were counted from the detour scene's position near the end of
//       the lesson; they are counted from the scene the lesson returns to, and the view's progress names
//       that main-path step (`progress.detour`);
//   B5  the explanation rung says whether it explains the last answer or the screen (`help.explains`);
//   B12 reopening a lesson panel without session_id returns the session already open, not a new one.
// Synthetic learners only; nothing is written to disk (dataDir null).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
type Json = Record<string, any>;
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as { scenes: Array<{ id: string; estimated_seconds: number }> };
const WRITTEN: Record<string, string> = {
  summary_audit: "summary_audit", explain_back: "explanation", comparison: "comparison",
  prompt_practice: "prompt_submission", communication_sim: "communication", ai_critique: "critique",
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

async function connect() {
  const server = buildMcpServer(new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null }));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "orientation-screen-test", version: "1" }, {
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } as never,
  });
  await client.connect(clientT);
  closers.push(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> };
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  return { call };
}

/** The minutes a detour screen has left: itself, then the lesson from the scene it returns to. */
function minutesFrom(sceneId: string, returnsTo: string): number {
  const at = authored.scenes.findIndex((s) => s.id === returnsTo);
  const own = authored.scenes.find((s) => s.id === sceneId)!.estimated_seconds;
  return Math.ceil((own + authored.scenes.slice(at).reduce((sum, s) => sum + s.estimated_seconds, 0)) / 60);
}

describe("the orientation says what the screen asks (A3, A4, B5)", () => {
  it("over a whole atomistique-l1 walk on panel_action (the audit's explore.mjs)", async () => {
    const t = await connect();
    let view = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "synthetic-audit-orientation", locale: "fr" })).panel as Json;
    const sid = view.session_id as string;
    const act = async (action: Json) => { view = (await t.call("panel_action", { session_id: sid, action })).panel; return view; };
    const wrong: Record<string, string> = { "s1-quiz-fer": "a", "s2-quiz-4f": "a", "s3-quiz-noeuds": "b" };
    let detours = 0;
    const check = () => {
      const o = view.orientation as Json;
      // A3: a pending self-rating is said only on a screen that serves it.
      if (o.waiting === "self_rating") {
        expect(view.actions).toContain("rateRecall");
        expect(view.self_rating?.requested).toBe(true);
      }
      const rung = (kind: string) => (view.help.rungs as Json[]).find((r) => r.kind === kind)!;
      if (rung("reference").available) expect(o.waiting).toBe("self_rating");
      // B5: an open explanation says what it explains.
      if (rung("explain").available) expect(["last_answer", "screen"]).toContain(view.help.explains);
      else expect(view.help).not.toHaveProperty("explains");
      // A4: on a detour, the minutes from the scene the lesson returns to, and the main-path step.
      if (o.step.detour && view.kind === "scene") {
        detours += 1;
        expect(o.minutes_left).toBe(minutesFrom(view.scene.id, o.step.detour.returns_to));
        const back = authored.scenes.findIndex((s) => s.id === o.step.detour.returns_to);
        expect(view.progress.detour).toEqual({
          returns_to_scene_id: o.step.detour.returns_to, returns_to_index: back + 1,
          returns_to_title: (authored.scenes[back] as unknown as { title: string }).title,
        });
      } else {
        expect(view.progress).not.toHaveProperty("detour");
      }
    };
    check();
    for (let guard = 0; guard < 120 && view.kind === "scene"; guard++) {
      const sc = view.scene as Json;
      if (sc.type === "quiz") await act({ type: "respond", input: { kind: "quiz_choice", choiceId: wrong[sc.id] ?? sc.choices[0].id, confidence: 1 } });
      else if (sc.type === "meta_checkpoint") await act({ type: "respond", input: { kind: "confidence", value: 2 } });
      else if (WRITTEN[sc.type]) await act({ type: "respond", input: { kind: WRITTEN[sc.type], text: "Une réponse d'essai écrite par l'audit, assez longue pour être notée." } });
      else if (sc.type === "spot_the_flaw" && sc.deck) await act({ type: "respond", input: { kind: "flaw_verdicts", verdicts: sc.deck.map((d: Json, i: number) => ({ token: d.token, flagged: i === 0 })) } });
      else if (sc.type === "spot_the_flaw") await act({ type: "respond", input: { kind: "flaw_report", text: "La règle de Hund n'est pas respectée." } });
      else if (sc.type === "reproduction" && sc.run_manifest) break;
      else await act({ type: "respond", input: { kind: "ack" } });
      check();
      if (view.self_rating?.requested) { await act({ type: "rateRecall", sceneId: view.self_rating.scene_id, grade: "hard" }); check(); }
    }
    expect(detours).toBeGreaterThan(0);
  });
});

describe("B12: reopening a lesson panel", () => {
  it("without session_id returns the session already open, on the same scene", async () => {
    const t = await connect();
    const first = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "synthetic-audit-reopen" })).panel as Json;
    const moved = (await t.call("panel_action", { session_id: first.session_id, action: { type: "respond", input: { kind: "ack" } } })).panel as Json;
    const again = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "synthetic-audit-reopen" })).panel as Json;
    expect(again.session_id).toBe(first.session_id);
    expect(again.scene.id).toBe(moved.scene.id);
    expect(again.progress.index).toBe(moved.progress.index);
  });
});

describe("content_language (audit 2026-11-10 A11)", () => {
  it("names the lesson's own language, whatever the interface's", async () => {
    const t = await connect();
    const view = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "synthetic-audit-language", locale: "en" })).panel as Json;
    expect(view.locale).toBe("en");
    expect(view.content_language).toBe("fr");
  });
});
