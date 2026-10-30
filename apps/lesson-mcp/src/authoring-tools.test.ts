// End to end over MCP (sprint 2026-10-30, W1; R1): a short French text goes through prepare_sources,
// a draft quoting its passages exactly goes through create_lesson, and the written lesson.json
// validates, lints with no ERROR and plays its first scene in a LessonSession.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LessonSession } from "@studium/lesson-session";
import { loadBundleJson } from "@studium/lesson-session/node";
import { buildTestDeps } from "@studium/lesson-session/testing";
import { publicPresentation } from "@studium/lesson-session-host";
import { lintBundleData } from "../../../packages/lesson-session-host/src/authoring-draft/index.js";
import { FRENCH_SOURCE } from "../../../packages/lesson-session-host/src/authoring-draft/test-fixtures.js";
import { AUTHORING_TOOL_NAMES, registerAuthoringTools, type AuthoringToolsContext } from "./authoring-tools.js";
import { TOOL_NAMES } from "./operations.js";
import { TEACHER_TOOL_NAMES } from "./teacher-tools.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface Passage { id: string; source_id: string; text: string }

async function connected(judge = false) {
  const library = mkdtempSync(join(tmpdir(), "mcp-authoring-"));
  roots.push(library);
  const written: string[] = [];
  const ctx: AuthoringToolsContext = { libraryRoot: () => library, onLessonWritten: (ref) => { written.push(ref); }, judge: () => judge };
  const server = new McpServer({ name: "authoring-test", version: "0" });
  const names = registerAuthoringTools(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "harness", version: "1" });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    const first = result.content[0];
    if (!first || first.type !== "text" || first.text === undefined) throw new Error("no text content");
    return { body: JSON.parse(first.text) as Record<string, unknown>, text: first.text, isError: result.isError === true };
  };
  return { library, written, names, client, call };
}

/** The exact words of `passage` from `start` to `end` (both included): what an agent copies. */
function quoteOf(passage: Passage, start: string, end: string): { passage_id: string; text: string } {
  const from = passage.text.indexOf(start);
  const to = passage.text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`"${start}…${end}" is not in ${passage.id}`);
  return { passage_id: passage.id, text: passage.text.slice(from, to + end.length) };
}

function draftOver(passages: Passage[]) {
  const [p1, p2, p3] = passages as [Passage, Passage, Passage];
  return {
    title: "Deux solidarités",
    language: "fr",
    goal: "Comprendre ce qui tient une société ensemble",
    concepts: [
      { id: "c-mecanique", label: "Solidarité mécanique", bloom: "understand" },
      { id: "c-organique", label: "Solidarité organique", bloom: "understand", prerequisites: ["c-mecanique"] },
    ],
    scenes: [
      { type: "intro", title: "Ce qui nous relie", concept_refs: ["c-mecanique"], markdown: "Deux façons de faire société, d'après votre source." },
      { type: "concept", title: "Se ressembler", concept_refs: ["c-mecanique"], markdown: "La cohésion par la ressemblance.",
        quotes: [quoteOf(p1, "la cohésion vient", "mêmes sentiments")] },
      { type: "explain_back", title: "Dépendre des autres", concept_refs: ["c-organique"],
        prompt: "Expliquez ce qui relie des individus qui ne font pas le même travail.",
        key_points: [
          { text: "Les fonctions se spécialisent", cues: ["spécialis", "fonction"] },
          { text: "Chacun dépend des autres", cues: ["dépend", "besoin des autres"] },
        ],
        model_explanation: "Le travail divisé spécialise les fonctions et rend chacun dépendant des autres.",
        quotes: [quoteOf(p2, "chacun dépend", "ce qu’ils font")] },
      { type: "quiz", title: "Le droit comme indice", concept_refs: ["c-organique"],
        question: "Quel droit domine là où règne la solidarité organique ?",
        choices: [{ text: "Le droit restitutif", correct: true }, { text: "Le droit répressif", correct: false }],
        feedback_correct: "Oui : il remet les choses en l'état.", feedback_incorrect: "Relisez le dernier passage.",
        quotes: [quoteOf(p3, "le droit devient", "restitutif")] },
    ],
  };
}

describe("registerAuthoringTools", () => {
  it("registers the three C1 authoring tools, none of which the server already has", async () => {
    const { names, client } = await connected();
    expect(names).toEqual(["create_lesson", "get_authoring_guide", "prepare_sources"]);
    expect(names).toEqual([...AUTHORING_TOOL_NAMES]);
    for (const name of names) {
      expect(TOOL_NAMES as readonly string[]).not.toContain(name);
      expect(TEACHER_TOOL_NAMES as readonly string[]).not.toContain(name);
    }
    const listed = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(listed).toEqual(names);
  });
});

describe("authoring over MCP, end to end", () => {
  it("goes from a short French text to a lesson a LessonSession plays", async () => {
    const { library, written, call } = await connected();

    const guide = await call("get_authoring_guide", { language: "fr" });
    expect(guide.isError).toBe(false);
    expect(guide.body["language"]).toBe("fr");
    expect(String(guide.body["guide"])).toContain("au caractère près");
    expect((guide.body["draft_schema"] as { properties: Record<string, unknown> }).properties).toHaveProperty("scenes");
    expect((guide.body["example"] as { draft: { language: string } }).draft.language).toBe("fr");

    const prepared = await call("prepare_sources", {
      sources: [{ title: FRENCH_SOURCE.title, text: FRENCH_SOURCE.text, url: FRENCH_SOURCE.url, license: FRENCH_SOURCE.license }],
      goal: "Comprendre ce qui tient une société ensemble", language: "fr",
    });
    expect(prepared.isError).toBe(false);
    expect(Object.keys(prepared.body).sort()).toEqual(["dropped_short", "guide_ref", "passages", "source_set_id"]);
    expect(prepared.body["guide_ref"]).toMatchObject({ tool: "get_authoring_guide", language: "fr" });
    const passages = prepared.body["passages"] as Passage[];
    expect(passages).toHaveLength(3);

    const created = await call("create_lesson", { source_set_id: prepared.body["source_set_id"], draft: draftOver(passages) });
    expect(created.isError).toBe(false);
    expect(Object.keys(created.body).sort()).toEqual(["course_ref", "findings", "key_classes", "notice", "ok", "outline"]);
    expect(created.body).toMatchObject({ ok: true, course_ref: "deux-solidarites/lesson.json" });
    expect(typeof created.body["notice"]).toBe("string");
    expect(String(created.body["notice"]).length).toBeGreaterThan(0);
    expect(written).toEqual(["deux-solidarites/lesson.json"]);
    // The tool result carries no key: no correct choice, cue or model answer.
    for (const key of ["Le droit restitutif", "spécialis", "besoin des autres", "Le travail divisé", "\"correct\"", "il remet les choses"]) {
      expect(created.text).not.toContain(key);
    }

    const raw = JSON.parse(readFileSync(join(library, "deux-solidarites", "lesson.json"), "utf8"));
    const bundle = loadBundleJson(raw);
    expect(lintBundleData(raw, { bundleDir: join(library, "deux-solidarites") }).findings.filter((item) => item.level === "ERROR")).toEqual([]);
    expect(bundle.metadata.authoring).toMatchObject({ mode: "self_study", drafted_by: "agent" });

    const session = new LessonSession(bundle, buildTestDeps());
    const first = await session.start();
    expect(first).toMatchObject({ index: 0, total: 4 });
    expect(first.scene).toMatchObject({ id: "s1-intro", type: "intro", title: "Ce qui nous relie" });
    const transition = await session.respond({ kind: "ack" });
    expect(transition.kind).toBe("next");
    if (transition.kind !== "next") return;
    expect(transition.presentation.scene.id).toBe("s2-concept");
  });

  // R3 (no key before the answer, on any host): a graded scene cites the passage that states its answer
  // ("le droit devient restitutif" for the quiz), so the projection a client receives before the learner
  // responds must not carry that quote. The reading scene keeps its citation: there it is the material.
  it("shows no cited quote on a graded scene before the answer, and keeps it on a reading", async () => {
    const { library, call } = await connected();
    const prepared = await call("prepare_sources", { sources: [{ title: FRENCH_SOURCE.title, text: FRENCH_SOURCE.text }] });
    const draft = draftOver(prepared.body["passages"] as Passage[]);
    expect((await call("create_lesson", { source_set_id: prepared.body["source_set_id"], draft })).isError).toBe(false);
    const bundle = loadBundleJson(JSON.parse(readFileSync(join(library, "deux-solidarites", "lesson.json"), "utf8")));
    const quoteOfScene = (index: number) => draft.scenes[index]!.quotes![0]!.text;

    // The written lesson does hold the quotes: the server keeps them to release after the verdict.
    expect(JSON.stringify(bundle.scenes[2])).toContain(quoteOfScene(2));
    expect(JSON.stringify(bundle.scenes[3])).toContain(quoteOfScene(3));

    // A real presentation from the engine, pointed at each scene in turn (reaching the quiz by play
    // would need a graded answer first, which is beside the point here).
    const first = await new LessonSession(bundle, buildTestDeps()).start();
    const presented = (index: number) =>
      JSON.stringify(publicPresentation({ ...first, index, scene: bundle.scenes[index]! }).scene);
    for (const index of [2, 3]) { // explain_back, quiz
      const shown = presented(index);
      expect(shown).not.toContain(quoteOfScene(index));
      expect(shown).not.toContain("bibliographic_refs");
    }
    expect(presented(1)).toContain(quoteOfScene(1)); // concept: ungraded, the citation is the reading
  });

  it("returns readable errors for a quote the passage does not hold, and writes nothing", async () => {
    const { written, call } = await connected();
    const prepared = await call("prepare_sources", { sources: [{ title: FRENCH_SOURCE.title, text: FRENCH_SOURCE.text }] });
    const draft = draftOver(prepared.body["passages"] as Passage[]);
    draft.scenes[1]!.quotes = [{ passage_id: "p:deux-formes-de-solidarite:1", text: "la cohésion naît du partage des croyances" }];
    const refused = await call("create_lesson", { source_set_id: prepared.body["source_set_id"], draft });
    expect(refused.isError).toBe(true);
    expect(refused.body).toEqual({
      ok: false,
      errors: [{
        path: "scenes.1.quotes.0.text", message: "the quote is not in passage p:deux-formes-de-solidarite:1",
        hint: expect.stringContaining("matches it up to “la cohésion "),
      }],
    });
    expect(written).toEqual([]);
  });

  it("refuses a malformed request in the same {path, message, hint} shape", async () => {
    const { call } = await connected();
    const empty = await call("prepare_sources", { sources: [{ title: "Note", text: "Trop court pour un passage." }] });
    expect(empty).toMatchObject({ isError: true, body: { ok: false, errors: [{ path: "sources.0.text", message: "no passage of at least 200 characters" }] } });
    const unknownSet = await call("create_lesson", { source_set_id: "../../etc", draft: {} });
    expect(unknownSet).toMatchObject({ isError: true, body: { ok: false, errors: [{ path: "source_set_id" }] } });
  });

  it("keeps a lesson unless overwrite is set, and uses the judge setting for the notice", async () => {
    const withoutJudge = await connected(false);
    const withJudge = await connected(true);
    const notices: string[] = [];
    for (const { call } of [withoutJudge, withJudge]) {
      const prepared = await call("prepare_sources", { sources: [{ title: FRENCH_SOURCE.title, text: FRENCH_SOURCE.text }] });
      const args = { source_set_id: prepared.body["source_set_id"], draft: draftOver(prepared.body["passages"] as Passage[]) };
      const first = await call("create_lesson", args);
      notices.push(String(first.body["notice"]));
      const again = await call("create_lesson", args);
      expect(again).toMatchObject({ isError: true, body: { ok: false, errors: [{ path: "course_id" }] } });
      expect(await call("create_lesson", { ...args, overwrite: true })).toMatchObject({ isError: false, body: { ok: true } });
    }
    expect(notices[0]).not.toBe(notices[1]);
  });
});
