// D2 (waiting review 2026-11-25): with STUDIUM_OPEN_LINK (the server the Studium VS Code extension offers), the
// study plan's start and continue steps carry the lesson's path and a link that opens it in the pane, in
// next_step.text — which display_markdown prints, and which a harness relays as it is. No link for the demo
// shipped with Studium (it says it is played through an assistant), for a .zip bundle, or for a review, an
// authoring step or a wait; and no change at all without the variable.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "plan-open-link-")); dirs.push(d); return d; }

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
function host(opts: { openLink?: string; shipped?: boolean } = {}) {
  const library = tmp();
  const shippedRoot = tmp();
  write(shippedRoot, "discover-studium-en/lesson.json", lesson("discover-studium-en"));
  return {
    library,
    h: new SessionHost({
      bundlesRoot: library, libraryRoot: library, live: false, dataDir: null, defaultLearnerId: "vscode-learner",
      ...(opts.shipped === false ? {} : { shippedRoot }), ...(opts.openLink !== undefined ? { openLink: opts.openLink } : {}),
    }),
  };
}
async function answerFirst(h: SessionHost, ref: string) {
  const { sessionId, presentation } = await h.create(ref);
  const right = (presentation.scene as unknown as { choices: Array<{ id: string; correct: boolean }> }).choices.find((c) => c.correct)!.id;
  await h.respond(sessionId, { kind: "quiz_choice", choiceId: right });
}

describe("study plan: the pane first when the VS Code extension serves Studium", () => {
  it("start: the next lesson's step carries lesson_path and open_link, and its text offers the pane", async () => {
    const { library, h } = host({ openLink: PREFIX });
    const path = write(library, "photo synthesis/lesson.json", lesson("photo"));
    const plan = await h.studyPlan(undefined, { language: "en" });
    expect(plan.next_step).toMatchObject({ action: "start", tool: "start_lesson_session", lesson_path: path, open_link: PREFIX + encodeURIComponent(path) });
    expect(plan.next_step.text).toContain(`](${PREFIX + encodeURIComponent(path)})`);
    expect(plan.next_step.text).toMatch(/say “here”/);
    expect(plan.display_markdown).toContain(PREFIX + encodeURIComponent(path));
    // The call to make in the chat is still there, for « here ».
    expect(plan.next_step.arguments).toMatchObject({ bundle_ref: "photo synthesis/lesson.json" });
  });

  it("continue: the lesson in progress carries them too, in French as well", async () => {
    const { library, h } = host({ openLink: PREFIX });
    const path = write(library, "photo/lesson.json", lesson("photo", "fr"));
    await answerFirst(h, "photo/lesson.json");
    const plan = await h.studyPlan(undefined, { language: "fr" });
    expect(plan.next_step).toMatchObject({ action: "continue", lesson_path: path, open_link: PREFIX + encodeURIComponent(path) });
    expect(plan.next_step.text).toMatch(/panneau Studium/);
    expect(plan.next_step.text).toContain(PREFIX + encodeURIComponent(path));
  });

  it("no link for the demo shipped with Studium, whose text says it is played through an assistant", async () => {
    const { h } = host({ openLink: PREFIX });
    const plan = await h.studyPlan(undefined, { language: "en" });
    expect(plan.next_step.action).toBe("start");
    expect(plan.next_step.arguments).toMatchObject({ bundle_ref: "discover-studium-en/lesson.json" });
    expect(plan.next_step).not.toHaveProperty("open_link");
    expect(plan.next_step).not.toHaveProperty("lesson_path");
    expect(plan.display_markdown).not.toContain("vscode://");
  });

  it("no link for an authoring step", async () => {
    const { h } = host({ openLink: PREFIX, shipped: false });
    const plan = await h.studyPlan(undefined, { language: "en" });
    expect(plan.next_step.action).toBe("author");
    expect(plan.next_step).not.toHaveProperty("open_link");
  });

  it("changes nothing without STUDIUM_OPEN_LINK", async () => {
    const { library, h } = host();
    write(library, "photo/lesson.json", lesson("photo"));
    const plan = await h.studyPlan(undefined, { language: "en" });
    expect(plan.next_step.action).toBe("start");
    expect(plan.next_step).not.toHaveProperty("open_link");
    expect(plan.next_step).not.toHaveProperty("lesson_path");
    expect(plan.next_step.text).toBe("start “Lesson photo”.");
  });
});
