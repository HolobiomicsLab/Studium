// Owner follow-up to decision 4 (2026-11-25, 20:45), B: Studium follows the learner's choice. It remembers, per
// learner, the surface where the learner last answered a step (the browser player, the VS Code pane, an MCP Apps panel,
// a pane the assistant's own app draws, the chat), in the study record: pseudonymised, erased by forget_session. The
// next offer puts that surface first when this host gives it, else the order of A (surface-offer.ts); the chat first
// when the learner last answered there. Nothing is asked of the learner: the choice is read from where answers arrive.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";
import type { AnswerSurface } from "./surface-offer.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "surface-choice-")); dirs.push(d); return d; }

const PREFIX = "vscode://holobiomicslab.studium-vscode/open?bundle=";
const REF = "photo/lesson.json";
const quiz = (id: string) => ({
  id, type: "quiz", title: id, objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "W", correct: false }, { id: "b", text: "R", correct: true }],
  feedback_correct: "yes", feedback_incorrect: "no", hints: [],
});
const lesson = (id: string) => ({
  schema_version: "1.4", bundle_id: id, source_plan_id: "p",
  metadata: { title: `Lesson ${id}`, target: "L1", duration_minutes: 6, language: "en", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [quiz("q1"), quiz("q2"), quiz("q3"), quiz("q4")],
  rules: [], validated_by: "teacher", validated_at: "2026-11-25T00:00:00Z",
});
const address = (learner: string, ref: string) => `http://127.0.0.1:5555/play#token=key-of-${learner}&from=assistant&lesson=${encodeURIComponent(ref)}`;
function host(opts: { openLink?: string; dataDir?: string | null } = {}) {
  const library = tmp();
  mkdirSync(dirname(join(library, REF)), { recursive: true });
  writeFileSync(join(library, REF), JSON.stringify(lesson("photo")));
  const asked: string[] = [];
  const h = new SessionHost({
    bundlesRoot: library, libraryRoot: library, live: false, dataDir: opts.dataDir ?? null,
    ...(opts.openLink ? { openLink: opts.openLink } : {}),
    browserLink: async (learnerId: string, bundleRef: string) => { asked.push(learnerId); return address(learnerId, bundleRef); },
  });
  return { library, h, asked };
}
/** One step of REF answered by `learner`, on `surface` (none: a caller that names none, as the HTTP API). */
async function answer(h: SessionHost, learner: string, surface?: AnswerSurface) {
  const { sessionId, presentation } = await h.create(REF, learner);
  const right = (presentation.scene as unknown as { choices: Array<{ id: string; correct: boolean }> }).choices.find((c) => c.correct)!.id;
  await h.respond(sessionId, { kind: "quiz_choice", choiceId: right }, surface === "chat" ? "companion" : "fast", surface ? { answeredOn: surface } : {});
}
const CODEX = { panel: true };

describe("the surface the learner last answered on comes first (B)", () => {
  it("puts the browser first after answers there, the chat first after answers in the chat, and A again after forget", async () => {
    const { h } = host();
    expect((await h.lessonOffer(REF, "ana", CODEX))?.order).toEqual(["panel", "browser", "chat"]);
    await answer(h, "ana", "browser");
    expect(await h.lessonOffer(REF, "ana", CODEX)).toMatchObject({
      first: "browser", order: ["browser", "panel", "chat"], open_link: address("ana", REF), open_panel: { bundle_ref: REF, learner_id: "ana" },
    });
    await answer(h, "ana", "chat");
    expect(await h.lessonOffer(REF, "ana", CODEX)).toMatchObject({ first: "chat", order: ["chat", "panel"] });
    const plan = await h.studyPlan("ana", { language: "en", client: CODEX });
    expect(plan.next_step).toMatchObject({ action: "continue", tool: "start_lesson_session", offer_first: "chat" });
    expect(plan.next_step.text).toMatch(/As last time, it goes on here, in this chat\. To answer each step at once, say “panel”/);
    await h.forgetLearner("ana");
    expect((await h.lessonOffer(REF, "ana", CODEX))?.order).toEqual(["panel", "browser", "chat"]);
  });

  it("leaves another learner on the order of A", async () => {
    const { h } = host();
    await answer(h, "ana", "chat");
    expect((await h.lessonOffer(REF, "bob", CODEX))?.order).toEqual(["panel", "browser", "chat"]);
    expect((await h.lessonOffer(REF, "bob"))?.order).toEqual(["browser", "chat"]);
  });

  it("changes nothing for an answer whose caller names no surface", async () => {
    const { h } = host();
    await answer(h, "ana");
    expect((await h.lessonOffer(REF, "ana"))?.first).toBe("browser");
  });

  it("falls back to A when the remembered surface is not one this host gives", async () => {
    const { h } = host();
    await answer(h, "ana", "panel");
    expect((await h.lessonOffer(REF, "ana"))?.order).toEqual(["browser", "chat"]);
  });

  it("keeps the remembered surface in the learner's pseudonymised study record, erased with it", async () => {
    const dataDir = tmp();
    const { h } = host({ dataDir });
    await answer(h, "ana-learner", "browser");
    const folders = readdirSync(dataDir).filter((name) => !name.startsWith("."));
    const study = folders.map((name) => join(dataDir, name, "study.json")).find((path) => { try { readFileSync(path); return true; } catch { return false; } })!;
    expect(JSON.parse(readFileSync(study, "utf8"))).toMatchObject({ answered_on: "browser" });
    expect(study).not.toContain("ana-learner");
    expect(readFileSync(study, "utf8")).not.toContain("ana-learner");
    const fresh = new SessionHost({ bundlesRoot: h.bundlesRoot, libraryRoot: h.libraryRoot!, live: false, dataDir,
      browserLink: async (learner: string, ref: string) => address(learner, ref) });
    expect((await fresh.lessonOffer(REF, "ana-learner", CODEX))?.first).toBe("browser");
    await fresh.forgetLearner("ana-learner");
    expect((await fresh.lessonOffer(REF, "ana-learner", CODEX))?.first).toBe("panel");
  });

  it("asks for the browser's address only when the offer names it", async () => {
    const { h, asked } = host();
    expect(await h.lessonOffer(REF, "ana", CODEX, "first")).toMatchObject({ first: "panel", order: ["panel"] });
    expect(asked).toEqual([]);
    expect(await h.lessonOffer(REF, "ana", {}, "first")).toMatchObject({ first: "browser", open_link: address("ana", REF) });
    expect(asked).toEqual(["ana"]);
  });
});

describe("the study plan offers the panel first where the client draws it (A)", () => {
  it("start: offer_first panel, open_panel with the call's learner, the browser's address second, the chat last", async () => {
    const { h } = host();
    const plan = await h.studyPlan("ana", { language: "en", client: CODEX });
    const link = address("ana", REF);
    expect(plan.next_step).toMatchObject({
      action: "start", tool: "start_lesson_session", offer_first: "panel", open_panel: { bundle_ref: REF, learner_id: "ana" }, open_link: link,
    });
    const text = plan.next_step.text;
    expect(text.indexOf("Studium panel")).toBeLessThan(text.indexOf(`<${link}>`));
    expect(text.indexOf(`<${link}>`)).toBeLessThan(text.indexOf("say “here”"));
  });

  it("a client that draws no panel: the browser first, as decision 4 has it", async () => {
    const { h } = host();
    const plan = await h.studyPlan("ana", { language: "en" });
    expect(plan.next_step).toMatchObject({ offer_first: "browser", open_link: address("ana", REF) });
    expect(plan.next_step).not.toHaveProperty("open_panel");
  });
});

describe("the VS Code extension's server (STUDIUM_OPEN_LINK)", () => {
  it("keeps the pane first, unless the learner's last answers came from the chat", async () => {
    const { h, library, asked } = host({ openLink: PREFIX });
    const pane = PREFIX + encodeURIComponent(join(library, REF));
    expect((await h.studyPlan("ana", { language: "en" })).next_step).toMatchObject({ offer_first: "vscode_pane", open_link: pane, lesson_path: join(library, REF) });
    await answer(h, "ana", "browser");
    expect((await h.studyPlan("ana", { language: "en" })).next_step).toMatchObject({ offer_first: "vscode_pane" });
    await answer(h, "ana", "chat");
    const step = (await h.studyPlan("ana", { language: "en" })).next_step;
    expect(step).toMatchObject({ offer_first: "chat", open_link: pane });
    expect(step.text).toMatch(/As last time, it goes on here, in this chat\. To answer each step at once, \[open it in the Studium pane\]/);
    expect(asked).toEqual([]);
  });
});
