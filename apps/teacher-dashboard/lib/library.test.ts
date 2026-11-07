import { afterEach, describe, expect, it, vi } from "vitest";
import { cp, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { sceneFingerprint } from "../../../packages/lesson-session-host/src/review-inbox";
import {
  approvalCommand, returnCommand, inspectLesson, listLessons, readLesson,
  encodeLessonRef, decodeLessonRef, bundlesRoot, LibraryReadError,
} from "./library";

const opening = vi.hoisted(() => ({ before: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const before = opening.before;
    opening.before = undefined;
    if (before) await before();
    return actual.open(...args);
  } };
});

const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), "studium-library-test-"));
  roots.push(path);
  return path;
}
async function fixture() {
  return JSON.parse(await readFile(resolve(__dirname, "../../../fixtures/atomistique-l1/lesson.json"), "utf8"));
}
async function put(base: string, ref: string, bundle: unknown) {
  await mkdir(join(base, ref), { recursive: true });
  await writeFile(join(base, ref, "lesson.json"), JSON.stringify(bundle));
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  opening.before = undefined;
  vi.unstubAllEnvs();
});

function approvalFor(raw: Buffer) {
  return { schema: "studium-approval/1", bundle_sha256: createHash("sha256").update(raw).digest("hex"), reviewer: "Reviewer", reviewed_at: "2026-10-30T10:00:00Z", checklist: {}, lint: { errors: 0, warnings: 0 }, tool: "experience_packet.py approve 1" };
}

describe("C5 approval is bound to the exact lesson bytes", () => {
  it("requires the schema and matching SHA-256, never a free-form validated_by", async () => {
    const raw = Buffer.from(JSON.stringify(await fixture()));
    const receipt = approvalFor(raw);
    expect(inspectLesson(raw, null).status).toBe("checked");
    expect(inspectLesson(raw, receipt).status).toBe("approved");
    expect(inspectLesson(Buffer.concat([raw, Buffer.from("\n")]), receipt).status).toBe("checked");
    expect(inspectLesson(raw, { ...receipt, schema: "studium-approval/2" }).status).toBe("checked");
    expect(inspectLesson(raw, { ...receipt, bundle_sha256: "0".repeat(64) }).approval.matches).toBe(false);
  });
  it("does not present an incomplete or failed C5 receipt as human approval", async () => {
    const raw = Buffer.from(JSON.stringify(await fixture()));
    const receipt = approvalFor(raw);
    expect(inspectLesson(raw, { schema: receipt.schema, bundle_sha256: receipt.bundle_sha256 }).status).toBe("checked");
    expect(inspectLesson(raw, { ...receipt, reviewer: "" }).status).toBe("checked");
    expect(inspectLesson(raw, { ...receipt, reviewed_at: "yesterday" }).status).toBe("checked");
    expect(inspectLesson(raw, { ...receipt, lint: { errors: 2, warnings: 0 } }).status).toBe("checked");
  });
  it("keeps invalid bundles and unfinished content in draft", async () => {
    expect(inspectLesson(Buffer.from("{}"), null).status).toBe("draft");
    const bundle = await fixture();
    bundle.scenes[0].markdown = "TODO: write the introduction";
    expect(inspectLesson(Buffer.from(JSON.stringify(bundle)), null)).toMatchObject({ status: "draft", todoCount: 1 });
  });
  it("counts TODOs with the linter's own rule: todo-* identifiers allowed, quoted evidence never scanned (CQ-5)", async () => {
    // The library page, review_lesson and `experience_packet.py approve` must agree on whether a lesson is finished.
    const bundle = await fixture();
    bundle.scenes[0].title = "TODO title";
    bundle.scenes[0].markdown = "Fill TODO: the introduction";
    bundle.concepts[0].description = "TODOéléments: a word that only starts with TODO"; // Unicode letter after TODO: prose
    expect(inspectLesson(Buffer.from(JSON.stringify(bundle)), null)).toMatchObject({ status: "draft", todoCount: 2 });

    const quoted = await fixture();
    quoted.scenes[0].evidence = { bibliographic_refs: [{ perspicacite_doc_id: "p:src:1", title: "A programming text",
      authors: [], excerpt: "TODO: refactor this function before release", relevance_score: 1, prov_derived_from: "source:src" }],
    enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-30T00:00:00Z", degraded: false } };
    expect(inspectLesson(Buffer.from(JSON.stringify(quoted)), null)).toMatchObject({ status: "checked", todoCount: 0 });
  });
  it("projects titles, concepts and source references without any answer fields", async () => {
    const bundle = await fixture();
    const quiz = bundle.scenes.find((s: { type: string }) => s.type === "quiz");
    // Test decision (walkthrough fix 1): a choice's text now reaches the review page, in the inbox
    // preview, because the teacher is asked to judge the scene; what stays on the server is the key —
    // which choice is correct, the feedback that restates it, the hints.
    quiz.choices[0].text = "PRIVATE_ANSWER_CANARY";
    quiz.feedback_correct = "FEEDBACK_CANARY";
    quiz.hints = ["HINT_CANARY"];
    const result = inspectLesson(Buffer.from(JSON.stringify(bundle)), null);
    expect(result.outline[0].title).toBe(bundle.scenes[0].title);
    expect(result.keyClasses.author_keyed).toBeGreaterThan(0);
    expect(JSON.stringify(result.outline)).not.toContain("PRIVATE_ANSWER_CANARY");
    expect(result.inbox.items.find((item) => item.id === quiz.id)?.preview.choices).toContain("PRIVATE_ANSWER_CANARY");
    expect(JSON.stringify(result)).not.toContain("FEEDBACK_CANARY");
    expect(JSON.stringify(result)).not.toContain("HINT_CANARY");
    expect(JSON.stringify(result)).not.toContain('"correct"');
  });
});

describe("the library is confined to BUNDLES_ROOT", () => {
  it("prefers an explicit root and otherwise uses the C6 personal library", () => {
    vi.stubEnv("STUDIUM_HOME", "/tmp/studium-home");
    vi.stubEnv("BUNDLES_ROOT", "");
    expect(bundlesRoot()).toBe("/tmp/studium-home/library");
    vi.stubEnv("BUNDLES_ROOT", "/tmp/explicit-library");
    expect(bundlesRoot()).toBe("/tmp/explicit-library");
  });
  it("lists nested lessons and reads a canonical opaque route reference", async () => {
    const base = await root();
    await put(base, "unit/lesson one", await fixture());
    const result = await listLessons(base);
    expect(result.lessons).toHaveLength(1);
    const ref = result.lessons[0].ref;
    expect(decodeLessonRef(encodeLessonRef(ref))).toBe("unit/lesson one");
    expect((await readLesson(base, ref)).title).toContain("Atomistique");
  });
  it.each(["../outside", "/tmp", "unit/../../outside", "unit/../outside", "unit\\outside", "unit\u0000bad"])("rejects unsafe reference %s", async (ref) => {
    const base = await root();
    await expect(readLesson(base, ref)).rejects.toThrow();
  });
  it("does not follow linked directories or linked lesson files outside the root", async () => {
    const base = await root();
    const outside = await root();
    await put(outside, "private", await fixture());
    await symlink(join(outside, "private"), join(base, "linked"));
    await mkdir(join(base, "file-link"));
    await symlink(join(outside, "private/lesson.json"), join(base, "file-link/lesson.json"));
    expect((await listLessons(base)).lessons).toHaveLength(0);
    await expect(readLesson(base, "linked")).rejects.toThrow();
    await expect(readLesson(base, "file-link")).rejects.toThrow();
  });
  it("does not trust an approval symlink", async () => {
    const base = await root();
    const outside = await root();
    await put(base, "course", await fixture());
    const raw = await readFile(join(base, "course/lesson.json"));
    await writeFile(join(outside, "approval.json"), JSON.stringify(approvalFor(raw)));
    await symlink(join(outside, "approval.json"), join(base, "course/approval.json"));
    expect((await readLesson(base, "course")).status).toBe("checked");
  });
  it("rejects an ancestor replaced by a symlink between validation and open", async () => {
    const base = await root();
    const outside = await root();
    await put(base, "course", await fixture());
    await put(outside, "private", await fixture());
    opening.before = async () => {
      await rename(join(base, "course"), join(base, "original"));
      await symlink(join(outside, "private"), join(base, "course"));
    };
    await expect(readLesson(base, "course")).rejects.toMatchObject({ kind: "unreadable" });
  });
  it("reports malformed lessons without hiding healthy siblings", async () => {
    const base = await root();
    await put(base, "healthy", await fixture());
    await mkdir(join(base, "broken"));
    await writeFile(join(base, "broken/lesson.json"), "{broken");
    const result = await listLessons(base);
    expect(result.lessons).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
    await expect(readLesson(base, "broken")).rejects.toMatchObject({ kind: "unreadable" });
    await expect(readLesson(base, "missing")).rejects.toMatchObject({ kind: "not-found" });
    await expect(readLesson(join(base, "absent-root"), "course")).rejects.toMatchObject({ kind: "root-unavailable" });
    expect(LibraryReadError).toBeDefined();
  });
  it("quotes the actual bundle path in an approval command without executing it", () => {
    expect(approvalCommand("/tmp/teacher's course/lesson.json", "en")).toBe(".venv/bin/python tools/experience_packet.py approve --bundle '/tmp/teacher'\"'\"'s course/lesson.json' --validated-by 'YOUR NAME'");
  });
});

describe("review inbox (INT-STUDIUM-058 task 6.3)", () => {
  it("projects the inbox sorted by consequence, without any fingerprint", async () => {
    const bundle = await fixture();
    bundle.scenes[2].title = "TODO title"; // a quiz with a TODO blocks
    const result = inspectLesson(Buffer.from(JSON.stringify(bundle)), null);
    const order = ["blocks", "grading", "wording", "media"];
    const ranks = result.inbox.items.map((item) => order.indexOf(item.consequence));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(result.inbox.items).toHaveLength(bundle.scenes.length);
    expect(result.inbox.items[0]).toMatchObject({ id: bundle.scenes[2].id, consequence: "blocks" });
    expect(result.inbox.items.some((item) => item.consequence === "grading" && item.holdsKey)).toBe(true);
    expect(result.inbox.items.every((item) => item.whatChanged === "new")).toBe(true);
    expect(result.inbox.lastReceipt).toBeNull();
    // No sha256 of any kind reaches a page: a key-holding scene's hash would be an answer oracle.
    expect(JSON.stringify(result.inbox)).not.toMatch(/sha256|[0-9a-f]{64}/);
    // inspectLesson alone runs no linter (readLesson does): the lint check is absent, not passed.
    expect(result.inbox.items[0].checks.map((c) => c.check)).toEqual(["schema", "todo"]);
  });
  it("gives each item the scene's public face: title, kind, learner text, a quiz's choice texts without the key", async () => {
    const bundle = await fixture();
    const quiz = bundle.scenes[2];
    const result = inspectLesson(Buffer.from(JSON.stringify(bundle)), null);
    const item = result.inbox.items.find((i) => i.id === quiz.id)!;
    expect(item.preview).toEqual({
      title: quiz.title, kind: "quiz", text: quiz.question.replace(/\s+/g, " ").trim().slice(0, 280),
      choices: quiz.choices.map((c: { text: string }) => c.text),
    });
    const audit = result.inbox.items.find((i) => i.id === bundle.scenes[3].id)!;
    expect(audit.preview.kind).toBe("summary_audit");
    expect(JSON.stringify(result.inbox)).not.toContain(bundle.scenes[3].model_correction.slice(0, 40));
    expect(JSON.stringify(result.inbox)).not.toContain(quiz.feedback_correct.slice(0, 40));
  });
  it("runs the bundle linter in readLesson: a lint ERROR naming a scene puts it first, as blocks (walkthrough fix 2)", async () => {
    const base = await root();
    const bundle = await fixture();
    // A quiz with two correct choices: bundle_lint's quiz_answer_key ERROR, "<scene id>: 2 correct choices".
    const quiz = bundle.scenes[5];
    for (const choice of quiz.choices.slice(0, 2)) choice.correct = true;
    await put(base, "course", bundle);
    await cp(resolve(__dirname, "../../../fixtures/atomistique-l1/assets"), join(base, "course/assets"), { recursive: true });
    const lesson = await readLesson(base, "course");
    expect(lesson.inbox.items[0]).toMatchObject({ id: quiz.id, consequence: "blocks" });
    expect(lesson.inbox.items[0].checks).toContainEqual({ check: "lint", passed: false });
    expect(lesson.inbox.items.filter((i) => i.consequence === "blocks").map((i) => i.id)).toEqual([quiz.id]);
    expect(lesson.lintUnavailable).toBe(false);
    // The linter's message is never copied to the page.
    expect(JSON.stringify(lesson)).not.toContain("correct choices");
  });
  it("marks what changed against the last receipt in the course's reviews/ folder", async () => {
    const base = await root();
    const bundle = await fixture();
    await put(base, "course", bundle);
    await mkdir(join(base, "course/reviews"));
    const receipt = {
      schema: "studium/review-receipt/v1", reviewer: "A. Teacher", decided_at: "2026-11-01T09:00:00Z",
      bundle_ref: "course/lesson.json", bundle_sha256: "a".repeat(64), decision: "approved",
      items: [
        { id: bundle.scenes[0].id, sha256: sceneFingerprint(bundle.scenes[0]), consequence: "wording", opened: true },
        { id: bundle.scenes[1].id, sha256: "0".repeat(64), consequence: "wording", opened: false },
      ],
      opened: 1, not_opened: 1,
    };
    await writeFile(join(base, "course/reviews/2026-11-01-abcd1234.json"), JSON.stringify(receipt));
    await writeFile(join(base, "course/reviews/2026-11-02-ffff.json"), "{broken");
    const lesson = await readLesson(base, "course");
    const byId = new Map(lesson.inbox.items.map((item) => [item.id, item]));
    expect(byId.get(bundle.scenes[0].id)?.whatChanged).toBe("unchanged");
    expect(byId.get(bundle.scenes[1].id)?.whatChanged).toBe("changed");
    expect(byId.get(bundle.scenes[2].id)?.whatChanged).toBe("new");
    expect(lesson.inbox.lastReceipt).toEqual({ reviewer: "A. Teacher", decidedAt: "2026-11-01T09:00:00Z", decision: "approved", opened: 1, notOpened: 1 });
    expect(lesson.inbox.unreadableReceipts).toBe(1);
    expect(JSON.stringify(lesson.inbox)).not.toMatch(/[0-9a-f]{64}/);
  });
  it("adds --opened to the approval command only when items were opened", () => {
    expect(approvalCommand("/c/lesson.json", "en", [])).toBe(".venv/bin/python tools/experience_packet.py approve --bundle '/c/lesson.json' --validated-by 'YOUR NAME'");
    expect(approvalCommand("/c/lesson.json", "fr", ["s1", "#3"])).toBe(".venv/bin/python tools/experience_packet.py approve --bundle '/c/lesson.json' --validated-by 'VOTRE NOM' --opened 's1,#3'");
  });
  it("composes the send-back command, which writes a receipt only", () => {
    expect(returnCommand("/c/teacher's/lesson.json", "en")).toBe(".venv/bin/python tools/experience_packet.py receipt --bundle '/c/teacher'\"'\"'s/lesson.json' --reviewer 'YOUR NAME' --decision returned");
    expect(returnCommand("/c/lesson.json", "fr", ["s1"])).toBe(".venv/bin/python tools/experience_packet.py receipt --bundle '/c/lesson.json' --reviewer 'VOTRE NOM' --decision returned --opened 's1'");
  });
});
