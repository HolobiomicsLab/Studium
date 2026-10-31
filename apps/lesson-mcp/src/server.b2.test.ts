import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SelfRatingExpiredError } from "@studium/lesson-session";
import { authoringGuide, SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const dirs: string[] = [];
const clients: Client[] = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "mcp-b2-")); dirs.push(dir); return dir; };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) await client.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connected(bundlesRoot: string, libraryRoot: string) {
  const host = new SessionHost({ bundlesRoot, libraryRoot, live: false, dataDir: tmp() });
  const server = buildMcpServer(host);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "b2-test", version: "1" });
  await client.connect(clientTransport);
  clients.push(client);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as {
      content: Array<{ type: string; text?: string }>; isError?: boolean;
    };
    const text = result.content[0]?.text;
    if (!text) throw new Error("no text response");
    return { body: JSON.parse(text) as Record<string, unknown>, isError: result.isError === true };
  };
  return { host, client, call };
}

describe("B2 MCP wiring", () => {
  it("the registered teacher tools can read a lesson in the separate learner library", async () => {
    const bundlesRoot = tmp();
    const libraryRoot = tmp();
    const { call } = await connected(bundlesRoot, libraryRoot);
    const example = authoringGuide({ language: "en" }).example;
    const prepared = await call("prepare_sources", { sources: [example.source] });
    const created = await call("create_lesson", { source_set_id: prepared.body.source_set_id, draft: example.draft, course_id: "mine" });
    expect(created.isError).toBe(false);
    const reviewed = await call("review_lesson", { course_ref: "mine/lesson.json" });
    expect(reviewed.isError).toBe(false);
    const report = await call("class_report", { course_id: "mine" });
    expect(report.isError).toBe(false);
  });

  it("create_lesson refuses a name already served from the bundles root", async () => {
    const bundlesRoot = tmp();
    const libraryRoot = tmp();
    mkdirSync(join(bundlesRoot, "occupied"));
    writeFileSync(join(bundlesRoot, "occupied", "lesson.json"), "{}");
    const { call } = await connected(bundlesRoot, libraryRoot);
    const example = authoringGuide({ language: "en" }).example;
    const prepared = await call("prepare_sources", { sources: [example.source] });
    const created = await call("create_lesson", {
      source_set_id: prepared.body.source_set_id, draft: example.draft, course_id: "occupied", overwrite: true,
    });
    expect(created.isError).toBe(true);
    // C's existing conflict wording names lookup precedence, not the environment variable.
    expect(created.body).toMatchObject({ ok: false, errors: [{ path: "course_id",
      message: '"occupied" is already a lesson in the lessons folder this server reads before the library',
      hint: "choose another course_id",
    }] });
    expect(existsSync(join(libraryRoot, "occupied"))).toBe(false);
  });

  it("rate_recall distinguishes an expired request with a stable tool error code", async () => {
    const { host, call } = await connected(tmp(), tmp());
    vi.spyOn(host, "rateRecall").mockRejectedValueOnce(new SelfRatingExpiredError("explain"));
    const rated = await call("rate_recall", { session_id: "s", scene_id: "explain", grade: "good" });
    expect(rated.isError).toBe(true);
    expect(rated.body).toMatchObject({ code: "self_rating_expired", error: expect.stringMatching(/expired.*answer the scene again/) });
  });

  it("describes the actual lesson and review shuffle scopes", async () => {
    const { client } = await connected(tmp(), tmp());
    const description = (await client.listTools()).tools.find((tool) => tool.name === "submit_response")!.description!;
    expect(description).toContain("review day");
    expect(description).toContain("time zone");
    expect(description).toMatch(/lesson.*deterministic/i);
    expect(description).not.toContain("per session:");
  });
});
