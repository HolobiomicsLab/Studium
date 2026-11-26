// D4 (waiting review 2026-11-25, owner decision 4): when no VS Code extension serves Studium (no STUDIUM_OPEN_LINK), the
// server offers its own browser player instead of the pane: the study plan's start and continue steps carry the
// player's address for the learner of the call, which next_step.text (and so display_markdown) offers first, the chat
// one word away. The host only asks for the address (SessionHostOptions.browserLink), on first need: never for a
// review, an authoring step, a wait or the demo shipped with Studium, and never when the pane is offered.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "plan-browser-link-")); dirs.push(d); return d; }

const PREFIX = "vscode://holobiomicslab.studium-vscode/open?bundle=";
const quiz = (id: string) => ({
  id, type: "quiz", title: id, objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "W", correct: false }, { id: "b", text: "R", correct: true }],
  feedback_correct: "yes", feedback_incorrect: "no", hints: [],
});
const lesson = (id: string, language = "en") => ({
  schema_version: "1.4", bundle_id: id, source_plan_id: "p",
  metadata: { title: `Lesson ${id}`, target: "L1", duration_minutes: 6, language, discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [quiz("q1"), quiz("q2"), quiz("q3")],
  rules: [], validated_by: "teacher", validated_at: "2026-11-25T00:00:00Z",
});
function write(root: string, ref: string, data: object): string {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
  return join(root, ref);
}
/** The address a browser player would mint: a key per learner, the lesson in the fragment. */
const address = (learner: string, ref: string) => `http://127.0.0.1:5555/play#token=key-of-${learner}&from=assistant&lesson=${encodeURIComponent(ref)}`;
function host(opts: { openLink?: string; refuse?: boolean; defaultLearnerId?: string } = {}) {
  const library = tmp();
  const shippedRoot = tmp();
  write(shippedRoot, "discover-studium-en/lesson.json", lesson("discover-studium-en"));
  const asked: Array<[string, string]> = [];
  const languages: Array<string | undefined> = [];
  const h = new SessionHost({
    bundlesRoot: library, libraryRoot: library, live: false, dataDir: null, shippedRoot,
    ...(opts.defaultLearnerId ? { defaultLearnerId: opts.defaultLearnerId } : {}),
    ...(opts.openLink !== undefined ? { openLink: opts.openLink } : {}),
    browserLink: async (learnerId: string, bundleRef: string, language?: string) => {
      asked.push([learnerId, bundleRef]); languages.push(language);
      return opts.refuse ? null : address(learnerId, bundleRef);
    },
  });
  return { library, h, asked, languages };
}
async function answerFirst(h: SessionHost, ref: string, learnerId?: string) {
  const { sessionId, presentation } = await h.create(ref, learnerId);
  const right = (presentation.scene as unknown as { choices: Array<{ id: string; correct: boolean }> }).choices.find((c) => c.correct)!.id;
  await h.respond(sessionId, { kind: "quiz_choice", choiceId: right });
}

describe("study plan: the browser player first when no VS Code pane serves Studium", () => {
  it("start: the step carries the player's address for the learner of the call, and its text offers it first", async () => {
    const { library, h, asked } = host();
    write(library, "photo synthesis/lesson.json", lesson("photo"));
    const plan = await h.studyPlan("ana", { language: "en" });
    const link = address("ana", "photo synthesis/lesson.json");
    expect(plan.next_step).toMatchObject({ action: "start", tool: "start_lesson_session", open_link: link });
    expect(plan.next_step).not.toHaveProperty("lesson_path");
    expect(asked).toEqual([["ana", "photo synthesis/lesson.json"]]);
    // The address itself is shown (a terminal shows a link's text only): an autolink, the browser first, then the chat.
    expect(plan.next_step.text).toContain(`<${link}>`);
    expect(plan.next_step.text).toMatch(/web browser[\s\S]*say “here”/);
    expect(plan.next_step.text).toMatch(/as long as this assistant session/);
    expect(plan.display_markdown).toContain(`<${link}>`);
  });

  // Trial of 2026-11-26: the player spoke the browser's language, not the French lesson's. The host asks for the address
  // in the lesson's language (metadata.language), which the address carries to the page (served-player.ts).
  it("asks for the address in the language of the lesson, start and continue alike", async () => {
    const { library, h, languages } = host();
    write(library, "photo/lesson.json", lesson("photo", "fr"));
    await h.studyPlan("ana", { language: "fr" });
    await answerFirst(h, "photo/lesson.json", "ana");
    expect((await h.studyPlan("ana", { language: "fr" })).next_step).toMatchObject({ action: "continue" });
    expect(languages).toEqual(["fr", "fr"]);
  });

  it("continue: the lesson in progress, for that same learner", async () => {
    const { library, h } = host();
    write(library, "photo/lesson.json", lesson("photo"));
    await answerFirst(h, "photo/lesson.json", "ana");
    const plan = await h.studyPlan("ana", { language: "en" });
    expect(plan.next_step).toMatchObject({ action: "continue", open_link: address("ana", "photo/lesson.json") });
    expect(plan.next_step.text).toContain(address("ana", "photo/lesson.json"));
  });

  it("asks for the default learner's address when the call names none", async () => {
    const { library, h, asked } = host({ defaultLearnerId: "from-env" });
    write(library, "photo/lesson.json", lesson("photo"));
    await h.studyPlan(undefined, { language: "en" });
    expect(asked).toEqual([["from-env", "photo/lesson.json"]]);
  });

  it("keeps the French typography off the address", async () => {
    const { library, h } = host();
    write(library, "photo/lesson.json", lesson("photo", "fr"));
    const plan = await h.studyPlan("ana", { language: "fr" });
    const link = address("ana", "photo/lesson.json");
    expect(plan.next_step.text).toContain(`<${link}>`);
    expect(plan.display_markdown).toContain(`<${link}>`);
    expect(plan.next_step.text).toMatch(/navigateur[\s\S]*dis «.ici.»/);
  });

  it("asks nothing for a review, an authoring step or the demo shipped with Studium", async () => {
    const demo = host();
    const plan = await demo.h.studyPlan("ana", { language: "en" });
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: "discover-studium-en/lesson.json" } });
    expect(plan.next_step).not.toHaveProperty("open_link");
    expect(demo.asked).toEqual([]);
    const empty = new SessionHost({
      bundlesRoot: tmp(), libraryRoot: tmp(), live: false, dataDir: null,
      browserLink: async () => { throw new Error("not asked"); },
    });
    const author = await empty.studyPlan("ana", { language: "en" });
    expect(author.next_step.action).toBe("author");
    expect(author.next_step).not.toHaveProperty("open_link");
  });

  it("is the plan of old when the player cannot start: no address, the chat path as before", async () => {
    const refused = host({ refuse: true });
    write(refused.library, "photo/lesson.json", lesson("photo"));
    const without = new SessionHost({ bundlesRoot: refused.library, libraryRoot: refused.library, live: false, dataDir: null });
    const plan = await refused.h.studyPlan("ana", { language: "en", nowMs: 1_800_000_000_000 });
    expect(plan.next_step).not.toHaveProperty("open_link");
    expect(plan).toEqual(await without.studyPlan("ana", { language: "en", nowMs: 1_800_000_000_000 }));
  });

  it("offers the VS Code pane, never the browser, when the extension serves Studium", async () => {
    const { library, h, asked } = host({ openLink: PREFIX });
    const path = write(library, "photo/lesson.json", lesson("photo"));
    const plan = await h.studyPlan(undefined, { language: "en" });
    expect(plan.next_step).toMatchObject({ lesson_path: path, open_link: PREFIX + encodeURIComponent(path) });
    expect(asked).toEqual([]);
    expect(await h.browserLinkFor("photo/lesson.json", "ana")).toBeNull();
  });

  it("browserLinkFor: the address for the learner of the call, else the default one", async () => {
    const { h, asked } = host({ defaultLearnerId: "from-env" });
    expect(await h.browserLinkFor("x/lesson.json", "ana")).toBe(address("ana", "x/lesson.json"));
    expect(await h.browserLinkFor("x/lesson.json")).toBe(address("from-env", "x/lesson.json"));
    expect(asked).toEqual([["ana", "x/lesson.json"], ["from-env", "x/lesson.json"]]);
  });
});

describe("sessionPlays: the learner a session plays (the browser player checks it before it acts)", () => {
  it("says whose a session is, and null for a session this server does not hold", async () => {
    const { library, h } = host();
    write(library, "photo/lesson.json", lesson("photo"));
    const ana = await h.create("photo/lesson.json", "ana");
    expect(await h.sessionPlays(ana.sessionId, "ana")).toBe(true);
    expect(await h.sessionPlays(ana.sessionId, "bob")).toBe(false);
    expect(await h.sessionPlays("no-such-session", "ana")).toBeNull();
  });
});
