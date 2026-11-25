// apps/lesson-mcp/src/surface-choice.test.ts
//
// Owner follow-up to decision 4 (2026-11-25, 20:45): « laisser les panneaux natifs de Claude Code, Codex et OpenCode GUI
// quand c'est utilisé, ou modifier le comportement selon décisions de l'utilisateur ».
//   A  A client that draws Studium's lesson panel (it announced io.modelcontextprotocol/ui at initialize, as Codex
//      Desktop does) is offered the panel first (the assistant calls open_lesson_panel), the browser second, the chat on
//      « here ». A VS Code client keeps the browser first (decision 1: the MCP Apps panel inside Copilot waits for a real
//      trial), and so does a client that announces only {roots} (OpenCode 1.19.6, measured). The Claude Code mod is
//      known once it has opened its pane on this connection, for the learner it plays.
//   B  The surface where the learner last answered comes first when this client gives it; after answers in the chat, the
//      offer says the lesson plays here and gives one link. forget_session erases the choice; another learner keeps A.
//      An answer in the chat counts only in a session that showed the learner the other surface (review G, finding 3).
//   C  (lead, after OpenCode 1.19.6 with Mistral Large 4: the model started the lesson in the chat at once and relayed
//      the first step only) A lesson started or resumed in the chat ends its first step with one line naming the better
//      surface; never a later step, never when the learner's choice is the chat.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost, authoringGuide } from "@studium/lesson-session-host";
import { buildMcpServer, SERVER_INSTRUCTIONS } from "./server.js";
import { servedPlayer, type ServedPlayer } from "./served-player.js";
import { answerSurfaceOf, CLAUDE_CODE_CLIENT } from "./panel-tools.js";

const dirs: string[] = [];
const players: ServedPlayer[] = [];
afterEach(async () => {
  await Promise.all(players.splice(0).map((player) => player.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "mcp-surface-choice-")); dirs.push(d); return d; }

const REF = "photo/lesson.json";
const PREFIX = "vscode://holobiomicslab.studium-vscode/open?bundle=";
const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } };
const quiz = (id: string) => ({
  id, type: "quiz", title: id, objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60, adaptation_hooks: [],
  question: `Question ${id}?`, choices: [{ id: "a", text: "Wrong", correct: false }, { id: "b", text: "Right", correct: true }],
  feedback_correct: "yes", feedback_incorrect: "no", hints: [],
});
const LESSON = {
  schema_version: "1.4", bundle_id: "photo", source_plan_id: "p",
  metadata: { title: "Photosynthesis", target: "L1", duration_minutes: 6, language: "en", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [quiz("q1"), quiz("q2"), quiz("q3"), quiz("q4")],
  rules: [], validated_by: "teacher", validated_at: "2026-11-25T00:00:00Z",
};

type Json = Record<string, any>;
/** A host as the stdio server makes it, with its own browser player (served-player.ts); `openLink`: the VS Code
 * extension's server instead. */
function serve(opts: { openLink?: string } = {}) {
  const library = tmp();
  mkdirSync(dirname(join(library, REF)), { recursive: true });
  writeFileSync(join(library, REF), JSON.stringify(LESSON));
  let player: ServedPlayer | null = null;
  const host: SessionHost = new SessionHost({
    bundlesRoot: library, libraryRoot: library, live: false, dataDir: null,
    ...(opts.openLink ? { openLink: opts.openLink } : { browserLink: (learner: string, ref: string) => player!.linkFor(learner, ref) }),
  });
  player = servedPlayer({ host: () => host, log: () => {} });
  players.push(player);
  return { host, library };
}
/** A client of `host`'s MCP server, named and declaring as a harness does at initialize. */
async function connect(host: SessionHost, name: string, capabilities: Record<string, unknown> = {}) {
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name, version: "1.0.0" }, { capabilities });
  await client.connect(clientT);
  return async (tool: string, args: Record<string, unknown> = {}): Promise<Json> => {
    const result = await client.callTool({ name: tool, arguments: args }) as { content: Array<{ text?: string }>; isError?: boolean; structuredContent?: Json };
    if (result.isError) throw new Error(`${tool}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]?.text ?? "null") as Json;
  };
}
const CODEX = ["codex-mcp-client", UI] as const;
const VSCODE = ["Visual Studio Code", UI] as const;
const OPENCODE = ["opencode", { roots: { listChanged: true } }] as const;

/** The right answer of the scene on screen, in the learner's words, as a chat relays it. */
const rightReply = (scene: Json) => scene.choices.find((c: Json) => c.text === "Right").id as string;
async function answerInChat(call: Awaited<ReturnType<typeof connect>>, learner: string) {
  const started = await call("start_lesson_session", { bundle_ref: REF, learner_id: learner });
  return call("submit_response", { session_id: started.session_id, input: { kind: "reply", text: rightReply(started.presentation.scene) } });
}
/** One step answered in the browser player, with the address the plan gave `learner`. */
async function answerInBrowser(link: string) {
  const { origin } = new URL(link);
  // Changed: the served player names its key k (review G, item 5).
  const key = link.match(/#k=([0-9a-f]{64})/)![1]!;
  const page = async (tool: string, args: Json) => {
    const reply = await fetch(`${origin}/play/api/tools/${tool}`, {
      method: "POST", body: JSON.stringify({ arguments: args }), headers: { "content-type": "application/json", origin, authorization: `Bearer ${key}` },
    });
    expect(reply.status).toBe(200);
    return (await reply.json() as Json)["structuredContent"]["panel"];
  };
  const panel = await page("open_lesson_panel", { bundle_ref: REF });
  const right = panel.scene.choices.find((c: Json) => c.text === "Right").id;
  await page("panel_action", { session_id: panel.session_id, action: { type: "respond", input: { kind: "quiz_choice", choiceId: right }, expected_scene_id: panel.scene.id } });
}

describe("A: the panel the client draws first, the browser second, the chat on “here”", () => {
  it("create_lesson, for a client that announced io.modelcontextprotocol/ui", async () => {
    const { host } = serve();
    const call = await connect(host, ...CODEX);
    const { source, draft } = authoringGuide({ language: "en" }).example;
    const prepared = await call("prepare_sources", { sources: [source], goal: draft.goal, language: "en" });
    const created = await call("create_lesson", { source_set_id: prepared.source_set_id, draft, learner_id: "ana" });
    expect(created).toMatchObject({ ok: true, offer_first: "panel", open_panel: { bundle_ref: created.course_ref, learner_id: "ana" } });
    const link = String(created.open_link);
    // Changed: the served player names its key k (review G, item 5).
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/play#k=/);
    const shown = String(created.display_markdown);
    expect(shown).toMatch(/is ready/);
    expect(shown.indexOf("Studium panel")).toBeLessThan(shown.indexOf(`<${link}>`));
    expect(shown.indexOf(`<${link}>`)).toBeLessThan(shown.indexOf("say “here”"));
  });

  it("get_study_plan's start step, for that client; the browser first for a VS Code client and for a {roots}-only one", async () => {
    const { host } = serve();
    const codex = await call0(host, CODEX);
    expect(codex.next_step).toMatchObject({ action: "start", offer_first: "panel", open_panel: { bundle_ref: REF, learner_id: "ana" } });
    expect(String(codex.next_step.text).indexOf("Studium panel")).toBeLessThan(String(codex.next_step.text).indexOf(String(codex.next_step.open_link)));
    for (const client of [VSCODE, OPENCODE]) {
      const plan = await call0(host, client);
      expect(plan.next_step, client[0]).toMatchObject({ action: "start", offer_first: "browser" });
      expect(plan.next_step, client[0]).not.toHaveProperty("open_panel");
      expect(String(plan.next_step.text)).toMatch(/^start “Photosynthesis”\. Open it in your web browser/);
    }
  });
});
async function call0(host: SessionHost, client: readonly [string, Record<string, unknown>]) {
  const call = await connect(host, client[0], client[1]);
  return call("get_study_plan", { learner_id: "ana", language: "en" });
}

describe("B: the learner's last surface first", () => {
  it("after an answer in the chat the offer says the lesson plays here; after one in the browser, the browser first again", async () => {
    const { host } = serve();
    const call = await connect(host, ...OPENCODE);
    await answerInChat(call, "ana");
    const afterChat = await call("get_study_plan", { learner_id: "ana", language: "en" });
    expect(afterChat.next_step).toMatchObject({ action: "continue", offer_first: "chat" });
    const link = String(afterChat.next_step.open_link);
    // Changed: "To answer each step at once" promised a speed a judge model does not keep (review G, finding 2), and "As
    // last time, it goes on here" read as going on with a lesson on the start step of a new one (finding 3).
    expect(afterChat.next_step.text).toMatch(/It plays here, in this chat, as you chose last time\. To answer each step without going through this chat, open it in your web browser/);
    expect(String(afterChat.display_markdown).split(link)).toHaveLength(2);

    await answerInBrowser(link);
    const afterBrowser = await call("get_study_plan", { learner_id: "ana", language: "en" });
    expect(afterBrowser.next_step).toMatchObject({ action: "continue", offer_first: "browser", open_link: link });

    // Another learner keeps the order of A; forget_session erases the choice.
    expect((await call("get_study_plan", { learner_id: "bob", language: "en" })).next_step).toMatchObject({ offer_first: "browser" });
    await answerInChat(call, "ana");
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ offer_first: "chat" });
    await call("forget_session", { learner_id: "ana" });
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ action: "start", offer_first: "browser" });
  });

  it("in a client that draws the panel, an answer there brings the panel back first after the chat", async () => {
    const { host } = serve();
    const call = await connect(host, ...CODEX);
    await answerInChat(call, "ana");
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ offer_first: "chat", open_panel: { bundle_ref: REF } });
    const opened = await call("open_lesson_panel", { bundle_ref: REF, learner_id: "ana" });
    expect(opened.panel.surface).toMatchObject({ kind: "panel" });
    const right = opened.panel.scene.choices.find((c: Json) => c.text === "Right").id;
    await call("panel_action", { session_id: opened.panel.session_id, action: { type: "respond", input: { kind: "quiz_choice", choiceId: right } } });
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ offer_first: "panel" });
  });
});

describe("the Claude Code mod: known once its pane has played the learner on this connection", () => {
  it("offers its command first to the learner it played, and the browser first to another", async () => {
    const { host } = serve();
    const call = await connect(host, "claude-code");
    expect((await call("get_study_plan", { language: "en" })).next_step).toMatchObject({ offer_first: "browser" });
    // What the mod sends on /studium <bundle_ref>: no learner_id, surface "pane".
    const opened = await call("open_lesson_panel", { bundle_ref: REF, surface: "pane" });
    const right = opened.panel.scene.choices.find((c: Json) => c.text === "Right").id;
    await call("panel_action", { session_id: opened.panel.session_id, action: { type: "respond", input: { kind: "quiz_choice", choiceId: right } } });
    const step = (await call("get_study_plan", { language: "en" })).next_step;
    expect(step).toMatchObject({ action: "continue", offer_first: "assistant_pane" });
    expect(step.text).toMatch(/Open it in the Studium pane: type `\/studium photo\/lesson\.json`/);
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ offer_first: "browser" });
  });

  // Review G, finding 1: a model in a client with no pane asks for one too (CONTINUE_ON_PANE then sends it back to the
  // chat), so a pane asked once is the mod's only from Claude Code's own client (clientInfo.name "claude-code", read in
  // Claude Code 2.1.332; the mod's $.mcp.call goes through that client's connection).
  it("counts only Claude Code's client: a model elsewhere that asks for a pane is no pane", async () => {
    expect(CLAUDE_CODE_CLIENT).toBe("claude-code");
    for (const [client, first] of [[OPENCODE, "browser"], [CODEX, "panel"]] as const) {
      const { host } = serve();
      const call = await connect(host, client[0], client[1]);
      await call("open_lesson_panel", { bundle_ref: REF, surface: "pane" });
      await call("open_lesson_panel", { bundle_ref: REF, learner_id: "ana", surface: "pane" });
      for (const learner of [{}, { learner_id: "ana" }]) {
        const step = (await call("get_study_plan", { ...learner, language: "en" })).next_step;
        expect(step, client[0]).toMatchObject({ offer_first: first });
        expect(String(step.text), client[0]).not.toMatch(/\/studium /);
      }
    }
    // Answers given on a "pane" such a model asked for are relayed in its chat.
    expect(answerSurfaceOf({ rank: 3, kind: "pane", available: ["text", "pane"] }, "opencode")).toBe("chat");
    expect(answerSurfaceOf({ rank: 3, kind: "pane", available: ["text", "pane"] }, CLAUDE_CODE_CLIENT)).toBe("assistant_pane");
  });

  it("forgets the pane once its session is taken up off it", async () => {
    const { host } = serve();
    const call = await connect(host, CLAUDE_CODE_CLIENT);
    const opened = await call("open_lesson_panel", { bundle_ref: REF, surface: "pane" });
    expect((await call("get_study_plan", { language: "en" })).next_step).toMatchObject({ offer_first: "assistant_pane" });
    // What CONTINUE_ON_PANE tells a model to do when no pane is shown.
    await call("get_panel_view", { session_id: opened.panel.session_id, surface: "text" });
    expect((await call("get_study_plan", { language: "en" })).next_step).toMatchObject({ offer_first: "browser" });
  });

  it("is offered to the default learner only: /studium <bundle_ref> opens for that learner", async () => {
    const { host } = serve();
    const call = await connect(host, CLAUDE_CODE_CLIENT);
    await call("open_lesson_panel", { bundle_ref: REF, learner_id: "ana", surface: "pane" });
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ offer_first: "browser" });
    expect((await call("get_study_plan", { language: "en" })).next_step).toMatchObject({ offer_first: "browser" });
  });
});

describe("C: one line at the end of the first step of a lesson started in the chat", () => {
  it("names the browser on the first step and on resume, never on a later step, never after the chat was the choice", async () => {
    const { host } = serve();
    const call = await connect(host, ...OPENCODE);
    const started = await call("start_lesson_session", { bundle_ref: REF, learner_id: "ana" });
    const shown = String(started.presentation.display_markdown);
    // Changed: the browser's line said "For immediate answers"; it promises no speed now (review G, finding 2).
    // Changed: the served player names its key k (review G, item 5).
    expect(shown).toMatch(/\n\n_To answer each step without going through this chat, follow it in your web browser: <http:\/\/127\.0\.0\.1:\d+\/play#k=[0-9a-f]{64}&from=assistant&lesson=photo%2Flesson\.json>_$/);
    const answered = await call("submit_response", { session_id: started.session_id, input: { kind: "reply", text: rightReply(started.presentation.scene) } });
    expect(JSON.stringify(answered)).not.toMatch(/follow it in your web browser/);
    // The learner answered in the chat: their choice. The lesson resumed in the chat carries no line.
    const resumed = await call("start_lesson_session", { bundle_ref: REF, learner_id: "ana" });
    expect(String(resumed.presentation.display_markdown)).not.toMatch(/follow it in your web browser/);
    // Another learner, who never answered: the line.
    const bob = await call("start_lesson_session", { bundle_ref: REF, learner_id: "bob" });
    expect(String(bob.presentation.display_markdown)).toMatch(/without going through this chat, follow it in your web browser/);
  });

  // Review G, finding 3: a chat answer is the learner's choice only when that session showed the other surface. A
  // session the model opened in the chat by itself (open_lesson_panel, which draws no line) records nothing, so the
  // next start still names the browser.
  it("keeps the line after answers in a session that showed the learner no other surface", async () => {
    const { host } = serve();
    const call = await connect(host, ...OPENCODE);
    const opened = await call("open_lesson_panel", { bundle_ref: REF, learner_id: "ana" });
    expect(opened.panel.surface).toMatchObject({ kind: "text" });
    await call("panel_action", { session_id: opened.panel.session_id, action: { type: "respond", input: { kind: "quiz_choice", choiceId: rightReply(opened.panel.scene) } } });
    expect((await call("get_study_plan", { learner_id: "ana", language: "en" })).next_step).toMatchObject({ action: "continue", offer_first: "browser" });
    const started = await call("start_lesson_session", { bundle_ref: REF, learner_id: "ana" });
    expect(String(started.presentation.display_markdown)).toMatch(/without going through this chat, follow it in your web browser/);
  });

  it("names the panel to a client that draws it, with open_panel for the session", async () => {
    const { host } = serve();
    const call = await connect(host, ...CODEX);
    const started = await call("start_lesson_session", { bundle_ref: REF, learner_id: "ana" });
    // Changed: the panel's line said "For immediate answers"; no surface promises speed now (lead, after review G).
    expect(String(started.presentation.display_markdown)).toMatch(/_For your answers to go straight to Studium, say “panel”: it opens in the Studium panel, where you are\._$/);
    expect(started).toMatchObject({ open_panel: { session_id: started.session_id } });
  });

  it("names the VS Code pane on the extension's server", async () => {
    const { host, library } = serve({ openLink: PREFIX });
    const call = await connect(host, "Visual Studio Code", UI);
    const started = await call("start_lesson_session", { bundle_ref: REF, learner_id: "ana" });
    expect(String(started.presentation.display_markdown))
      // Changed: the pane's line said "For immediate answers"; no surface promises speed now (lead, after review G).
      .toContain(`_To answer each step without going through this chat, follow it in the [Studium pane](${PREFIX}${encodeURIComponent(join(library, REF))})._`);
  });

  it("adds nothing where the chat is all this client has", async () => {
    const library = tmp();
    mkdirSync(dirname(join(library, REF)), { recursive: true });
    writeFileSync(join(library, REF), JSON.stringify(LESSON));
    const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir: null });
    const call = await connect(host, ...OPENCODE);
    const started = await call("start_lesson_session", { bundle_ref: REF, learner_id: "ana" });
    // Changed: matched "For immediate answers" only, which the browser's line no longer says (review G, finding 2).
    // Changed: also matches the panes' and the panel's new words, so the absence of every line is still checked.
    expect(String(started.presentation.display_markdown)).not.toMatch(/For immediate answers|without going through this chat|straight to Studium/);
    expect(started).not.toHaveProperty("open_panel");
  });
});

describe("the server's instructions", () => {
  it("say what to do with offer_first, within 13 lines", () => {
    const lines = SERVER_INSTRUCTIONS.split("\n");
    expect(lines.length).toBeLessThanOrEqual(13);
    const authoring = lines.find((line) => line.includes("prepare_sources, create_lesson"))!;
    expect(authoring).toMatch(/offer_first/);
    expect(authoring).toMatch(/open_lesson_panel with open_panel/);
    expect(authoring).toMatch(/“chat”|"chat"/);
  });
});
