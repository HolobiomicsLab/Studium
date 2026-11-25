// apps/lesson-mcp/src/served-player.e2e.test.ts
//
// D4 (waiting review 2026-11-25, owner decision 4) through the stdio server as OpenCode or Vibe start it: its own
// process, no STUDIUM_OPEN_LINK. Nothing listens until a lesson is offered; create_lesson then returns the address of
// the server's browser player, on 127.0.0.1, for the learner id the assistant passed. A step answered in the browser
// is that learner's progress (get_study_plan continues at the next step, the chat resumes there), and no other
// learner's. The VS Code extension's server (STUDIUM_OPEN_LINK) keeps its pane link and starts no player;
// STUDIUM_BROWSER_PLAYER=off gives no address and opens no port. Closing stdin ends the process, player included.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const APP = resolve(import.meta.dirname, "..");
const FIXTURE = fileURLToPath(new URL("../../../packages/lesson-session-host/src/authoring-draft/fixtures/photosynthese/", import.meta.url));
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURE, name), "utf8"));
const PREPARE = fixture("prepare.json") as { goal: string; language: string; sources: Array<{ title: string }> };
const ACCEPTED = fixture("create-2-accepted.json") as { course_id: string; draft: Record<string, unknown> };
const LESSON = "photosynthese/lesson.json";
// What OpenCode's model passed in the runs of 2026-11-25: an id it made up from the topic.
const LEARNER = "apprenant-photosynthese";
const OPEN_LINK = "vscode://holobiomicslab.studium-vscode/open?bundle=";
const TIMEOUT = 90_000;

const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function tmp(prefix: string): string { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(dir); return dir; }
const notes = join(tmp("studium-served-notes-"), "photosynthese.md");
writeFileSync(notes, readFileSync(join(FIXTURE, "notes.txt"), "utf8"), "utf8");

/** MCP over the child's stdin and stdout, as a harness speaks it; close() ends stdin, as a harness that quits does. */
class ChildStdio implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();
  constructor(private readonly child: ChildProcessWithoutNullStreams) {}
  async start(): Promise<void> {
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message);
    });
    this.child.on("exit", () => this.onclose?.());
    this.child.on("error", (error) => this.onerror?.(error));
  }
  async send(message: JSONRPCMessage): Promise<void> { this.child.stdin.write(serializeMessage(message)); }
  async close(): Promise<void> { this.child.stdin.end(); }
}

/** The TCP ports `pid` listens on, or null when lsof is not there to say. */
function listening(pid: number): number[] | null {
  try {
    const out = execFileSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf8" });
    return [...out.matchAll(/^n.*:(\d+)$/gm)].map((match) => Number(match[1]));
  } catch (error) {
    return (error as { status?: number }).status === 1 ? [] : null;
  }
}

type Json = Record<string, any>;
async function startServer(env: Record<string, string> = {}) {
  const home = tmp("studium-served-home-");
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: APP, stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env["PATH"] ?? "", HOME: home, STUDIUM_HOME: home, LITELLM_BASE_URL: "", ...env },
  });
  children.push(child);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  const client = new Client({ name: "opencode", version: "1.0.0" });
  await client.connect(new ChildStdio(child));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text?: string }>; isError?: boolean };
    return { isError: result.isError === true, body: JSON.parse(result.content[0]?.text ?? "null") as Json };
  };
  const createLesson = async (learnerId?: string) => {
    const prepared = await call("prepare_sources", { sources: [{ path: notes, title: PREPARE.sources[0]!.title }], goal: PREPARE.goal, language: PREPARE.language });
    expect(prepared.isError).toBe(false);
    return call("create_lesson", {
      source_set_id: prepared.body["source_set_id"], draft: ACCEPTED.draft, course_id: ACCEPTED.course_id, ...(learnerId ? { learner_id: learnerId } : {}),
    });
  };
  return { pid: child.pid!, call, createLesson, stderr: () => stderr, close: async () => { await client.close(); return exited; } };
}

/** The player's tool routes, as the page calls them. */
function player(origin: string, key?: string) {
  return async (name: string, args: Record<string, unknown>) => {
    const reply = await fetch(`${origin}/play/api/tools/${name}`, {
      method: "POST", body: JSON.stringify({ arguments: args }),
      headers: { "content-type": "application/json", origin, ...(key ? { authorization: `Bearer ${key}` } : {}) },
    });
    return { status: reply.status, json: await reply.json() as Json };
  };
}

describe("the stdio server without the VS Code extension offers its browser player (D4)", () => {
  it("starts it on create_lesson, for the learner of the call, and the progress made there is that learner's", async () => {
    const server = await startServer();
    const before = listening(server.pid);
    if (before !== null) expect(before).toEqual([]);
    expect(server.stderr()).not.toMatch(/browser player/);

    const created = await server.createLesson(LEARNER);
    expect(created).toMatchObject({ isError: false, body: { ok: true, course_ref: LESSON } });
    const link = String(created.body["open_link"]);
    const [, port, key] = link.match(/^http:\/\/127\.0\.0\.1:(\d+)\/play#token=([0-9a-f]{64})&from=assistant&lesson=photosynthese%2Flesson\.json$/) ?? [];
    expect(port, link).toBeDefined();
    expect(created.body).not.toHaveProperty("lesson_path");
    const shown = String(created.body["display_markdown"]);
    expect(shown).toMatch(/est prête/);
    expect(shown).toContain(`<${link}>`);
    expect(shown).toMatch(/navigateur[\s\S]*dis «.ici.»/);
    const after = listening(server.pid);
    if (after !== null) expect(after).toEqual([Number(port)]);
    expect(server.stderr()).toContain(`browser player on http://127.0.0.1:${port}/play`);
    expect(server.stderr()).not.toContain(key);

    // The page loads; its routes answer with the key and refuse without it.
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(`${origin}/play`);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain(key);
    expect((await player(origin)("list_lessons", {})).status).toBe(401);
    const asLearner = player(origin, key);
    expect((await asLearner("list_lessons", { language: "fr" })).status).toBe(200);

    // One step answered in the browser, as the learner the link was minted for.
    const opened = await asLearner("open_lesson_panel", { bundle_ref: LESSON, learner_id: "someone-else", locale: "fr" });
    expect(opened.status).toBe(200);
    const panel = opened.json["structuredContent"]["panel"];
    expect(panel).toMatchObject({ learner_id: LEARNER, scene: { type: "intro" } });
    const answered = await asLearner("panel_action", { session_id: panel.session_id, action: { type: "respond", input: { kind: "ack" }, expected_scene_id: panel.scene.id } });
    expect(answered.status).toBe(200);
    const reached = answered.json["structuredContent"]["panel"]["scene"]["id"];
    expect(reached).not.toBe(panel.scene.id);

    // The chat sees it: the study plan continues at the next step, with the same address, and the chat resumes there.
    const plan = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr" })).body;
    expect(plan["in_progress"]).toEqual([expect.objectContaining({ bundle_ref: LESSON, scenes_completed: 1 })]);
    expect(plan["next_step"]).toMatchObject({ action: "continue", arguments: { bundle_ref: LESSON, learner_id: LEARNER }, open_link: link });
    expect(String(plan["display_markdown"])).toContain(`<${link}>`);
    const resumed = (await server.call("start_lesson_session", { bundle_ref: LESSON, learner_id: LEARNER })).body;
    expect(resumed["session_id"]).toBe(panel.session_id);
    expect(resumed["presentation"]["scene"]["id"]).toBe(reached);

    // Another learner: nothing moved, another key, and that key cannot touch the first learner's session.
    const other = (await server.call("get_study_plan", { learner_id: "bob", language: "fr" })).body;
    expect(other["in_progress"]).toEqual([]);
    expect(other["next_step"]).toMatchObject({ action: "start", arguments: { bundle_ref: LESSON } });
    const otherKey = String(other["next_step"]["open_link"]).match(/token=([0-9a-f]{64})/)![1]!;
    expect(otherKey).not.toBe(key);
    expect(new URL(String(other["next_step"]["open_link"])).port).toBe(port);
    const refused = await player(origin, otherKey)("get_panel_view", { session_id: panel.session_id });
    expect(refused).toMatchObject({ status: 403, json: { code: "not_your_session" } });

    // The assistant quits: stdin closes, the process ends, and the address with it.
    expect(await server.close()).toBe(0);
    await expect(fetch(`${origin}/play`)).rejects.toThrow();
  }, TIMEOUT);

  // D4 review, finding 1 (probe p4): no learner named, the default "anonymous" of this server is one person, the user of
  // this assistant session. The chat's « here » takes up the session the browser plays, where it is, and the two never
  // hold two sessions of one lesson that save over each other.
  it("plays one session in the browser and in the chat when no learner is named", async () => {
    const server = await startServer();
    const created = await server.createLesson();
    const link = String(created.body["open_link"]);
    const [, port, key] = link.match(/^http:\/\/127\.0\.0\.1:(\d+)\/play#token=([0-9a-f]{64})&from=assistant&lesson=/) ?? [];
    expect(port, link).toBeDefined();
    const asLearner = player(`http://127.0.0.1:${port}`, key);
    const opened = await asLearner("open_lesson_panel", { bundle_ref: LESSON, locale: "fr" });
    let panel = opened.json["structuredContent"]["panel"];
    expect(panel.learner_id).toBe("anonymous");
    const session = panel.session_id;
    panel = (await asLearner("panel_action", { session_id: session, action: { type: "respond", input: { kind: "ack" }, expected_scene_id: panel.scene.id } }))
      .json["structuredContent"]["panel"];

    // The learner says « here »: the chat takes up the browser's session, at the browser's step.
    const here = (await server.call("start_lesson_session", { bundle_ref: LESSON })).body;
    expect(here["session_id"]).toBe(session);
    expect(here["resume"]).toMatchObject({ kind: "already_open", scene_id: panel.scene.id });

    // The browser goes on past that step; the chat, back, finds the step the browser reached, and the plan counts it.
    const asked = panel.scene.id;
    for (const choice of panel.scene.choices.map((c: { id: string }) => c.id)) {
      panel = (await asLearner("panel_action", { session_id: session, action: { type: "respond", input: { kind: "quiz_choice", choiceId: choice }, expected_scene_id: panel.scene.id } }))
        .json["structuredContent"]["panel"];
      if (panel.scene.id !== asked) break;
    }
    expect(panel.scene.id).not.toBe(asked);
    const again = (await server.call("start_lesson_session", { bundle_ref: LESSON })).body;
    expect(again["session_id"]).toBe(session);
    expect(again["presentation"]["scene"]["id"]).toBe(panel.scene.id);
    const plan = (await server.call("get_study_plan", { language: "fr" })).body;
    expect(plan["in_progress"]).toEqual([expect.objectContaining({ bundle_ref: LESSON, scenes_completed: 2 })]);
    expect(await server.close()).toBe(0);
  }, TIMEOUT);

  it("keeps the VS Code pane link, and starts no player, when the extension serves Studium", async () => {
    const server = await startServer({ STUDIUM_OPEN_LINK: OPEN_LINK, STUDIUM_LEARNER_ID: "vscode-learner" });
    const created = await server.createLesson(LEARNER);
    expect(created.body["open_link"]).toMatch(/^vscode:\/\/holobiomicslab\.studium-vscode\/open\?bundle=/);
    expect(created.body["lesson_path"]).toMatch(/photosynthese\/lesson\.json$/);
    const plan = (await server.call("get_study_plan", { language: "fr" })).body;
    expect(String(plan["next_step"]["open_link"])).toMatch(/^vscode:/);
    const ports = listening(server.pid);
    if (ports !== null) expect(ports).toEqual([]);
    expect(server.stderr()).not.toMatch(/browser player on/);
    expect(await server.close()).toBe(0);
  }, TIMEOUT);

  it("gives no address and opens no port with STUDIUM_BROWSER_PLAYER=off", async () => {
    const server = await startServer({ STUDIUM_BROWSER_PLAYER: "off" });
    const created = await server.createLesson(LEARNER);
    expect(created).toMatchObject({ isError: false, body: { ok: true, course_ref: LESSON } });
    expect(created.body).not.toHaveProperty("open_link");
    expect(created.body).not.toHaveProperty("display_markdown");
    const plan = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr" })).body;
    expect(plan["next_step"]).toMatchObject({ action: "start" });
    expect(plan["next_step"]).not.toHaveProperty("open_link");
    const ports = listening(server.pid);
    if (ports !== null) expect(ports).toEqual([]);
    expect(server.stderr()).not.toMatch(/browser player on/);
    expect(await server.close()).toBe(0);
  }, TIMEOUT);
});
