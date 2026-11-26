// Revisit a step already done, over MCP (owner decision 2026-11-26): panel_action revisit shows a main-path
// step as it was, read only; nothing can be answered there, the session does not move, and resume returns
// to the exact current screen.
import { it, expect } from "vitest";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

type Reply = { isError?: boolean; structuredContent?: { panel: Record<string, any> }; content: Array<{ type: string; text?: string }> };

it("revisits a step already done, refuses an answer there, and resumes where the learner was", async () => {
  const host = new SessionHost({ bundlesRoot: resolve("../../fixtures"), live: false, dataDir: null });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "panel-revisit-test", version: "1" });
  await client.connect(clientT);
  try {
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as Reply;
    const opened = (await call("open_lesson_panel", { bundle_ref: "atomistique-l1/lesson.json", learner_id: "panel-revisit" })).structuredContent!.panel;
    expect(opened.progress).not.toHaveProperty("done");
    expect(opened.actions).not.toContain("revisit");
    const sid = opened.session_id;
    const act = (action: Record<string, unknown>) => call("panel_action", { session_id: sid, action });
    await act({ type: "respond", input: { kind: "ack" }, expected_scene_id: opened.scene.id });
    const second = (await call("get_panel_view", { session_id: sid })).structuredContent!.panel;
    const now = (await act({ type: "respond", input: { kind: "ack" }, expected_scene_id: second.scene.id })).structuredContent!.panel;
    expect(now.progress.done).toEqual([
      { index: 1, scene_id: opened.scene.id, title: opened.scene.title },
      { index: 2, scene_id: second.scene.id, title: second.scene.title },
    ]);
    expect(now.actions).toContain("revisit");
    const state = JSON.stringify((await call("get_session_state", { session_id: sid })).content[0]?.text);

    const back = await act({ type: "revisit", scene_id: opened.scene.id });
    expect(back.isError).not.toBe(true);
    const revisit = back.structuredContent!.panel;
    expect(revisit).toMatchObject({ scene: { id: opened.scene.id }, revisit: { scene_id: opened.scene.id, index: 1, answered: false }, actions: ["resume", "revisit"] });
    expect(revisit.progress.index).toBe(now.progress.index);
    expect(back.content[1]?.text).toContain("already done, read only");

    const answered = await act({ type: "respond", input: { kind: "ack" }, expected_scene_id: opened.scene.id });
    expect(answered.isError).toBe(true);
    expect(answered.content[0]?.text).toMatch(/review only/);
    expect((await act({ type: "revisit", scene_id: now.scene.id })).isError).toBe(true);
    expect(JSON.stringify((await call("get_session_state", { session_id: sid })).content[0]?.text)).toBe(state);

    const resumed = (await act({ type: "resume" })).structuredContent!.panel;
    expect(resumed).toEqual(now);
  } finally { await client.close(); await server.close(); }
});
