import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  approvalCommand, countTodos, inspectLesson, listLessons, readLesson,
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
  it("counts prose and grading TODOs while allowing todo-* identifiers", () => {
    expect(countTodos({ id: "TODO-scene", concept_ids: ["todo-c"], title: "TODO title", answer: "Fill TODO: key", nested: ["TODO"] })).toBe(3);
  });
  it("projects titles, concepts and source references without any answer fields", async () => {
    const bundle = await fixture();
    const quiz = bundle.scenes.find((s: { type: string }) => s.type === "quiz");
    quiz.choices[0].text = "PRIVATE_ANSWER_CANARY";
    const result = inspectLesson(Buffer.from(JSON.stringify(bundle)), null);
    expect(result.outline[0].title).toBe(bundle.scenes[0].title);
    expect(result.keyClasses.author_keyed).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ANSWER_CANARY");
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
