// W7 — teacher tools in the harness: review_lesson (a draft's plan, never its answer keys) and
// class_report (aggregate over consented telemetry, k = 5 floor, never a learner id).
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  registerTeacherTools, reviewLesson, classReport, TEACHER_TOOL_NAMES, TeacherToolError,
  type LintFinding, type TeacherToolsContext,
} from "./teacher-tools.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PYTHON = join(REPO_ROOT, ".venv", "bin", "python");

// Distinctive strings planted in every answer-key field, so a leak is a plain substring match.
const KEYS = {
  correctChoice: "KEYCHOICE-zebra-77",
  feedbackCorrect: "KEYFEEDBACK-yes-91",
  feedbackIncorrect: "KEYFEEDBACK-no-92",
  hint: "KEYHINT-peek-93",
  flaw: "KEYFLAW-umlaut-94",
  claimText: "KEYCLAIM-assertion-95",
  soundClaim: "KEYSOUND-claim-96",
  keyPointText: "KEYPOINT-idea-97",
  keyPointCue: "KEYCUE-phrase-98",
  modelCorrection: "KEYMODEL-correction-99",
  modelExplanation: "KEYMODEL-explanation-100",
};

const base = (id: string, type: string, concept: string) => ({
  id, type, title: `Title ${id}`, objective_refs: [], concept_refs: [concept],
  estimated_seconds: 30, adaptation_hooks: [],
});
const RUBRIC = { completeness: 0.4, evidence_quality: 0.3, tone: 0.3 };

function bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "1.4", bundle_id: "teach-001", source_plan_id: "p",
    metadata: { title: "Teach", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
    concepts: [
      { id: "c1", title: "Concept one", description: "d", bloom_level_target: "understand" },
      { id: "c2", title: "Concept two", description: "d", bloom_level_target: "apply" },
    ],
    scenes: [
      { ...base("s0", "intro", "c1"), markdown: "Welcome to the lesson." },
      { ...base("s1", "quiz", "c1"), question: "Which one?",
        choices: [{ id: "a", text: "Plain wrong", correct: false }, { id: "b", text: KEYS.correctChoice, correct: true }],
        feedback_correct: KEYS.feedbackCorrect, feedback_incorrect: KEYS.feedbackIncorrect, hints: [KEYS.hint] },
      { ...base("s2", "spot_the_flaw", "c2"), flawed_content: "A flawed paragraph.",
        claims: [{ id: "k1", text: KEYS.claimText, flaws_expected: [KEYS.flaw] }],
        sound_claims: [{ id: "k2", text: KEYS.soundClaim }],
        model_correction: `${KEYS.modelCorrection} ${KEYS.flaw}`, rubric: RUBRIC },
      { ...base("s3", "explain_back", "c2"), prompt: "Explain it back.",
        key_points: [{ id: "p1", text: KEYS.keyPointText, cues: [KEYS.keyPointCue] }],
        model_explanation: KEYS.modelExplanation, rubric: RUBRIC },
    ],
    rules: [], validated_by: "DRAFT — not reviewed", validated_at: "2026-10-30T08:00:00Z",
    ...overrides,
  };
}

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A bundles root holding one course directory `<course>/lesson.json`. */
function library(course = "teach", b: Record<string, unknown> = bundle()): { root: string; lessonJson: string } {
  const root = tmp("lib");
  mkdirSync(join(root, course));
  const lessonJson = join(root, course, "lesson.json");
  writeFileSync(lessonJson, JSON.stringify(b));
  return { root, lessonJson };
}

const CLEAN_LINT = async (): Promise<LintFinding[]> => [];
function ctxFor(root: string, extra: Partial<TeacherToolsContext> = {}): TeacherToolsContext {
  return { bundlesRoot: root, dataDir: null, lint: CLEAN_LINT, ...extra };
}

function assertNoKeys(value: unknown): void {
  const json = JSON.stringify(value);
  for (const [name, key] of Object.entries(KEYS)) expect(json, `leaked ${name}`).not.toContain(key);
  expect(json).not.toContain('"correct"');
  expect(json).not.toContain("flaws_expected");
}

describe("registerTeacherTools", () => {
  it("registers exactly the two contract tools and returns their names", async () => {
    const { root } = library();
    const server = new McpServer({ name: "t", version: "0" });
    const names = registerTeacherTools(server, ctxFor(root));
    expect([...names].sort()).toEqual(["class_report", "review_lesson"]);
    expect([...TEACHER_TOOL_NAMES].sort()).toEqual(["class_report", "review_lesson"]);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(clientT);
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(listed).toEqual(["class_report", "review_lesson"]);

    const res = await client.callTool({ name: "review_lesson", arguments: { course_ref: "teach" } });
    const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(body.ok).toBe(true);
    assertNoKeys(body);

    const bad = await client.callTool({ name: "review_lesson", arguments: { course_ref: "../etc" } });
    expect(bad.isError).toBe(true);
  });
});

describe("review_lesson", () => {
  it("returns the plan, key classes and authoring without any answer key", async () => {
    const { root, lessonJson } = library();
    const out = await reviewLesson(ctxFor(root), "teach");
    assertNoKeys(out);
    expect(out.ok).toBe(true);
    expect(out.bundle_id).toBe("teach-001");
    expect(out.bundle_sha256).toBe(createHash("sha256").update(readFileSync(lessonJson)).digest("hex"));
    expect(out.plan?.scenes.map((s) => [s.id, s.type, s.key_class])).toEqual([
      ["s0", "intro", "ungraded"],
      ["s1", "quiz", "author_keyed"],
      ["s2", "spot_the_flaw", "author_keyed"],
      ["s3", "explain_back", "production"],
    ]);
    expect(out.key_classes).toEqual({
      ungraded: ["s0"], author_keyed: ["s1", "s2"], production: ["s3"], externally_grounded: [],
    });
    // Counts of keyed items are fine; their content is not.
    const quiz = out.plan?.scenes.find((s) => s.id === "s1");
    expect(quiz?.choice_count).toBe(2);
    expect(quiz?.prompt).toBe("Which one?");
    expect(out.plan?.scenes.find((s) => s.id === "s3")?.keyed_item_count).toBe(1);
    expect(out.authoring).toMatchObject({ mode: "teacher", author_is_learner: false, validated: false, drafted_by: null });
    expect(out.schema_valid).toBe(true);
  });

  it("reads authoring.drafted_by and flags a self-study draft", async () => {
    const b = bundle({ metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x",
      authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent" } },
      validated_by: "SELF-STUDY — not teacher-validated" });
    const { root } = library("teach", b);
    const out = await reviewLesson(ctxFor(root), "teach");
    expect(out.authoring).toMatchObject({ mode: "self_study", drafted_by: "agent", validated: false });
  });

  it("lists remaining TODO placeholders by path and blocks readiness", async () => {
    const b = bundle();
    (b["scenes"] as Array<Record<string, unknown>>)[1]!["question"] = "TODO: rédiger la question";
    ((b["scenes"] as Array<Record<string, unknown>>)[2]!["claims"] as Array<Record<string, unknown>>)[0]!["flaws_expected"] = ["TODO: défaut attendu"];
    const { root } = library("teach", b);
    const out = await reviewLesson(ctxFor(root), "teach");
    expect(out.todo.count).toBe(2);
    expect(out.todo.paths).toEqual(["scene s1: question", "scene s2: claims[0].flaws_expected[0]"]);
    expect(out.plan?.scenes.find((s) => s.id === "s1")?.todo_count).toBe(1);
    expect(out.ready_for_approval).toBe(false);
    expect(JSON.stringify(out)).not.toContain("défaut attendu");
  });

  it("flags a TODO the way experience_packet.py approve does: a field that starts with TODO or holds TODO:", async () => {
    // tools/experience_packet.py PLACEHOLDER_PATTERN `^TODO\b|TODO:` on the left-trimmed value, todo-* allowed in
    // id / *_id / *_ids fields, `evidence` (quoted source text) never scanned; tools/bundle_lint.mjs mirrors it.
    const b = bundle();
    const scenes = b["scenes"] as Array<Record<string, unknown>>;
    scenes[0]!["markdown"] = "Make a TODO list before you start, then read the passage."; // prose: not a placeholder
    (scenes[3]!["key_points"] as Array<Record<string, unknown>>)[0]!["id"] = "TODO-1";       // an identifier: allowed
    scenes[0]!["evidence"] = { bibliographic_refs: [{ perspicacite_doc_id: "p:src:1", title: "A programming text",
      authors: [], excerpt: "TODO: refactor this function before release", relevance_score: 1, prov_derived_from: "source:src" }],
    enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-30T00:00:00Z", degraded: false } };
    scenes[1]!["question"] = "  TODO write the question";                                    // starts with TODO
    scenes[3]!["prompt"] = "Explain it back. TODO: name the second idea";                      // holds TODO:
    const { root } = library("teach", b);
    const out = await reviewLesson(ctxFor(root), "teach");
    expect(out.todo.paths).toEqual(["scene s1: question", "scene s3: prompt"]);
    expect(out.todo.count).toBe(2);
    expect(out.ready_for_approval).toBe(false);

    const clean = bundle();
    (clean["scenes"] as Array<Record<string, unknown>>)[0]!["markdown"] = "Make a TODO list before you start.";
    ((clean["scenes"] as Array<Record<string, unknown>>)[3]!["key_points"] as Array<Record<string, unknown>>)[0]!["id"] = "todo-1";
    const { root: cleanRoot } = library("teach", clean);
    const ready = await reviewLesson(ctxFor(cleanRoot), "teach");
    expect(ready.todo).toEqual({ count: 0, paths: [] });
    expect(ready.ready_for_approval).toBe(true);
  });

  it("is ready for approval only with no TODO, a valid schema and a lint without ERROR", async () => {
    const { root } = library();
    expect((await reviewLesson(ctxFor(root), "teach")).ready_for_approval).toBe(true);
    const warn = async (): Promise<LintFinding[]> => [{ level: "WARN", code: "self_study_open_book", message: "s1: open book" }];
    const withWarn = await reviewLesson(ctxFor(root, { lint: warn }), "teach");
    expect(withWarn.ready_for_approval).toBe(true);
    expect(withWarn.lint).toMatchObject({ status: "ok", errors: 0, warnings: 1 });
    const err = async (): Promise<LintFinding[]> => [{ level: "ERROR", code: "duplicate_scene_id", message: "duplicate scene id: s1" }];
    const withErr = await reviewLesson(ctxFor(root, { lint: err }), "teach");
    expect(withErr.ready_for_approval).toBe(false);
    expect(withErr.lint).toMatchObject({ status: "ok", errors: 1 });
  });

  it("does not claim readiness when the linter cannot run", async () => {
    const { root } = library();
    const crash = async (): Promise<LintFinding[]> => { throw new Error("spawn failed"); };
    const out = await reviewLesson(ctxFor(root, { lint: crash }), "teach");
    expect(out.lint.status).toBe("failed");
    expect(out.ready_for_approval).toBe(false);
    const noScript = await reviewLesson({ bundlesRoot: root, dataDir: null, lintScript: join(root, "absent.mjs") }, "teach");
    expect(noScript.lint.status).toBe("unavailable");
    expect(noScript.ready_for_approval).toBe(false);
  });

  it("scrubs answer-key text out of lint messages", async () => {
    const { root } = library();
    const leaky = async (): Promise<LintFinding[]> => [
      { level: "ERROR", code: "flaw_reveal_gap", message: `s2: flaw "${KEYS.flaw}" is absent from model_correction` },
      { level: "WARN", code: "other", message: `quoted ${KEYS.correctChoice} and ${KEYS.keyPointCue}` },
    ];
    const out = await reviewLesson(ctxFor(root, { lint: leaky }), "teach");
    assertNoKeys(out);
    expect(out.lint.findings[0]).toMatchObject({ level: "ERROR", code: "flaw_reveal_gap" });
    expect(out.lint.findings[0]!.message.startsWith("s2:")).toBe(true);
  });

  it("runs the real bundle linter and withholds the flaw it quotes", async () => {
    // The flaw keyword is absent from model_correction -> the real linter prints it in its message.
    const b = bundle();
    ((b["scenes"] as Array<Record<string, unknown>>)[2]!)["model_correction"] = "A correction that never names the planted flaw.";
    const { root } = library("teach", b);
    const out = await reviewLesson({ bundlesRoot: root, dataDir: null }, "teach");
    expect(out.lint.status).toBe("ok");
    const gap = out.lint.findings.find((f) => f.code === "flaw_reveal_gap");
    expect(gap, JSON.stringify(out.lint)).toBeDefined();
    expect(gap!.level).toBe("ERROR");
    assertNoKeys(out);
    expect(out.ready_for_approval).toBe(false);
  });

  it("does not echo JSON parser text for a malformed lesson.json", async () => {
    const { root, lessonJson } = library();
    writeFileSync(lessonJson, `{"scenes": [ "${KEYS.correctChoice}" oops`);
    const out = await reviewLesson(ctxFor(root), "teach");
    expect(out.schema_valid).toBe(false);
    expect(out.schema_errors[0]?.message).toBe("lesson.json is not valid JSON");
    expect(out.plan).toBeNull();
    expect(out.ready_for_approval).toBe(false);
    assertNoKeys(out);
  });

  it("reports schema errors as path + message and still scans TODO", async () => {
    const b = bundle();
    delete (b["scenes"] as Array<Record<string, unknown>>)[1]!["choices"];
    (b["scenes"] as Array<Record<string, unknown>>)[3]!["prompt"] = "TODO: prompt";
    const { root } = library("teach", b);
    const out = await reviewLesson(ctxFor(root), "teach");
    expect(out.schema_valid).toBe(false);
    expect(out.schema_errors.some((e) => e.path.includes("choices"))).toBe(true);
    // RT-7: each error says what to change (formatBundleError), the way create_lesson reports a draft.
    expect(out.schema_errors.find((e) => e.path.includes("choices"))).toMatchObject({
      path: "scenes.1.choices", message: "required field is missing", hint: 'add "choices"',
    });
    expect(out.todo.count).toBe(1);
    expect(out.ready_for_approval).toBe(false);
  });

  describe("approval record (C5, read side)", () => {
    const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    const record = (hash: string) => ({
      schema: "studium-approval/1", bundle_sha256: hash, reviewer: "Dr Example", reviewed_at: "2026-10-30T09:00:00Z",
      checklist: { sources_checked: true }, lint: { errors: 0, warnings: 2 }, tool: "experience_packet.py approve",
    });

    it("recorded=false without approval.json", async () => {
      const { root } = library();
      expect((await reviewLesson(ctxFor(root), "teach")).approval).toEqual({ recorded: false, matches: false });
    });

    it("recorded and matching when the fingerprint is the lesson.json sha256", async () => {
      const { root, lessonJson } = library();
      writeFileSync(join(root, "teach", "approval.json"), JSON.stringify(record(sha(lessonJson))));
      const out = await reviewLesson(ctxFor(root), "teach");
      const expected = { recorded: true, matches: true, reviewer: "Dr Example", reviewed_at: "2026-10-30T09:00:00Z" };
      expect(out.approval).toEqual(expected);
      // C5 names the place: the authoring block gains approval (lead decision I-9); the top-level copy stays.
      expect(out.authoring?.approval).toEqual(expected);
    });

    it("recorded but not matching once the lesson changed after approval", async () => {
      const { root, lessonJson } = library();
      writeFileSync(join(root, "teach", "approval.json"), JSON.stringify(record(sha(lessonJson))));
      writeFileSync(lessonJson, JSON.stringify(bundle({ validated_by: "somebody else" })));
      const out = await reviewLesson(ctxFor(root), "teach");
      expect(out.approval).toMatchObject({ recorded: true, matches: false });
      expect(out.authoring?.approval).toMatchObject({ recorded: true, matches: false });
    });

    it("treats an unreadable or foreign-schema record as not recorded", async () => {
      const { root } = library();
      writeFileSync(join(root, "teach", "approval.json"), "{not json");
      expect((await reviewLesson(ctxFor(root), "teach")).approval).toMatchObject({ recorded: false, matches: false });
      writeFileSync(join(root, "teach", "approval.json"), JSON.stringify({ schema: "other/9", bundle_sha256: "x" }));
      expect((await reviewLesson(ctxFor(root), "teach")).approval).toMatchObject({ recorded: false, matches: false });
    });
  });

  describe("path confinement", () => {
    it("rejects traversal, absolute paths and symlinks leaving the bundles root", async () => {
      const { root } = library();
      const outside = tmp("outside");
      mkdirSync(join(outside, "evil"));
      writeFileSync(join(outside, "evil", "lesson.json"), JSON.stringify(bundle()));
      symlinkSync(join(outside, "evil"), join(root, "linked"));
      for (const ref of ["../x", join(outside, "evil"), "linked", "teach/../../x"]) {
        await expect(reviewLesson(ctxFor(root), ref), ref).rejects.toBeInstanceOf(TeacherToolError);
      }
    });

    it("accepts a directory, its lesson.json, and a flat json file; refuses a zip", async () => {
      const { root } = library();
      writeFileSync(join(root, "flat.json"), JSON.stringify(bundle()));
      writeFileSync(join(root, "pack.zip"), "zip");
      const viaDir = await reviewLesson(ctxFor(root), "teach");
      const viaFile = await reviewLesson(ctxFor(root), "teach/lesson.json");
      const flat = await reviewLesson(ctxFor(root), "flat.json");
      expect(viaFile.bundle_sha256).toBe(viaDir.bundle_sha256);
      expect(flat.approval).toEqual({ recorded: false, matches: false });
      await expect(reviewLesson(ctxFor(root), "pack.zip")).rejects.toThrow(/zip/);
      await expect(reviewLesson(ctxFor(root), "missing")).rejects.toBeInstanceOf(TeacherToolError);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// class_report
// ---------------------------------------------------------------------------------------------

let eventCounter = 0;
function event(pseudonym: string | null, type: string, fields: Record<string, unknown> = {}, lesson: string | null = "teach-001") {
  eventCounter += 1;
  const e: Record<string, unknown> = {
    event_id: `00000000-0000-4000-8000-${String(eventCounter).padStart(12, "0")}`,
    lesson_id: lesson, bundle_version: "unversioned", client_timestamp: "2026-10-30T10:00:00+00:00", type, ...fields,
  };
  if (pseudonym !== null) e["learner_pseudonym"] = pseudonym;
  if (lesson === null) delete e["lesson_id"];
  return e;
}

function writeStream(dataDir: string, pseudonym: string, bundleId: string, events: Array<Record<string, unknown>>): void {
  const dir = join(dataDir, pseudonym, bundleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "telemetry.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

const PSEUDOS = ["aaaa000000000001", "aaaa000000000002", "aaaa000000000003", "aaaa000000000004", "aaaa000000000005", "aaaa000000000006"];

/** Quiz-only learner stream: s1 (concept c1) answered with the given correctness / confidence / time. */
function quizStream(pseudo: string, correct: boolean, confidence: number, ms: number, extra: Array<Record<string, unknown>> = []) {
  return [
    event(pseudo, "lesson_started", { bundle_uri: "x" }),
    event(pseudo, "quiz_answered", { scene_id: "s1", item_id: "i", correct, response_time_ms: ms, confidence }),
    ...extra,
    event(pseudo, "lesson_completed", { total_duration_ms: 1000, autonomy_ratio: 0.5 }),
  ];
}

describe("class_report", () => {
  function sixLearners(): { root: string; dataDir: string } {
    const { root } = library();
    const dataDir = tmp("data");
    // s1: 4 correct of 6, confidence 0.8 for the 2 wrong ones; hints on 2 learners.
    const plan: Array<[boolean, number, number]> = [
      [true, 0.9, 2000], [true, 0.7, 4000], [true, 0.8, 3000], [true, 0.6, 5000], [false, 0.9, 6000], [false, 0.8, 4000],
    ];
    PSEUDOS.forEach((p, i) => {
      const [correct, conf, ms] = plan[i]!;
      const hint = i < 2 ? [event(p, "hint_requested", { scene_id: "s1", hint_index: 0 })] : [];
      writeStream(dataDir, p, "teach-001", quizStream(p, correct, conf, ms, hint));
    });
    return { root, dataDir };
  }

  it("aggregates per scene and per concept, with a cohort band and no learner identifier", async () => {
    const { root, dataDir } = sixLearners();
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.min_learners).toBe(5);
    expect(out.cohort_band).toBe("5–9");
    expect(out.completion_rate).toBe(1);
    const scene = out.scenes.find((s) => s.scene_id === "s1")!;
    expect(scene).toMatchObject({ type: "quiz", concept: "c1", n_attempts: 6, n_measured: 6, accuracy: 0.667, hint_reliance: 0.333, cohort_band: "5–9" });
    // mean confidence 4.7/6 = 0.7833, accuracy 4/6 = 0.6667
    expect(scene.calibration_gap).toBe(0.117);
    expect(scene.mean_time_s).toBe(4);
    expect(out.concepts.find((c) => c.concept === "c1")).toMatchObject({ n_attempts: 6, accuracy: 0.667 });
    expect(out.reteach_priority).toEqual(["c1"]);
    const json = JSON.stringify(out);
    for (const p of PSEUDOS) expect(json).not.toContain(p);
    expect(json).not.toMatch(/"learner_pseudonym"|"learner_id"|"n_learners"|"n_streams"/);
    expect(out.non_attribution.length).toBeGreaterThan(20);
  });

  // The Python twin is checked where the repo venv exists; elsewhere the run reports this test as
  // skipped, not passed.
  it.skipIf(!existsSync(PYTHON))("matches tools/class_report.py on the shared figures (quiz-only run)", async () => {
    const { root, dataDir } = sixLearners();
    const outDir = tmp("pyout");
    execFileSync(PYTHON, [join(REPO_ROOT, "tools", "class_report.py"), dataDir, "--bundle", join(root, "teach", "lesson.json"), "--out", outDir],
      { encoding: "utf8" });
    const py = JSON.parse(readFileSync(join(outDir, "class_report.json"), "utf8"));
    const ts = await classReport(ctxFor(root, { dataDir }), "teach");
    if (ts.status !== "ok") throw new Error("expected ok");
    const pyConcept = py.concepts.find((c: { concept: string }) => c.concept === "c1");
    const tsConcept = ts.concepts.find((c) => c.concept === "c1")!;
    expect(tsConcept.n_attempts).toBe(pyConcept.n_attempts);
    expect(tsConcept.accuracy).toBe(pyConcept.accuracy);
    expect(tsConcept.hint_reliance).toBe(pyConcept.hint_reliance);
    expect(tsConcept.calibration_gap).toBe(pyConcept.calibration_gap);
    expect(tsConcept.mean_time_s).toBe(pyConcept.mean_time_s);
    expect(ts.completion_rate).toBe(py.completion_rate);
    expect(ts.reteach_priority).toEqual(py.reteach_priority);
    expect(tsConcept.cohort_band).toBe(pyConcept.cohort_band);
  });

  it("computes the calibration gap over rated quiz answers only (an unrated answer has no confidence)", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    // Six correct answers: three rated 0.9, three unrated (lead decision I-5: confidence omitted, skipped here).
    PSEUDOS.forEach((p, i) => writeStream(dataDir, p, "teach-001", [
      event(p, "lesson_started", { bundle_uri: "x" }),
      event(p, "quiz_answered", { scene_id: "s1", item_id: "i", correct: true, response_time_ms: 1000, ...(i < 3 ? { confidence: 0.9 } : {}) }),
      event(p, "lesson_completed", { total_duration_ms: 1000, autonomy_ratio: 0.5 }),
    ]));
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    if (out.status !== "ok") throw new Error("expected ok");
    const scene = out.scenes.find((s) => s.scene_id === "s1")!;
    expect(scene).toMatchObject({ n_attempts: 6, n_measured: 6, accuracy: 1 });
    expect(scene.calibration_gap).toBe(-0.1); // 0.9 - 1 over the three rated answers, not (2.7 + 0) / 6 - 1
    // No rated answer at all: no calibration figure.
    const unrated = tmp("data");
    PSEUDOS.forEach((p) => writeStream(unrated, p, "teach-001", [
      event(p, "quiz_answered", { scene_id: "s1", item_id: "i", correct: true, response_time_ms: 1000 }),
    ]));
    const none = await classReport(ctxFor(root, { dataDir: unrated }), "teach");
    if (none.status !== "ok") throw new Error("expected ok");
    expect(none.scenes.find((s) => s.scene_id === "s1")!.calibration_gap).toBeNull();
  });

  it("suppresses the whole report below the floor and never states the cohort size", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.slice(0, 4).forEach((p) => writeStream(dataDir, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    expect(out.status).toBe("suppressed");
    expect(out).toMatchObject({ min_learners: 5, has_data: true });
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/\b4\b/);
    expect(json).not.toMatch(/accuracy|concepts|scenes/);
  });

  it("withholds a scene or concept that fewer than five learners contributed to, without counting them", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.forEach((p, i) => {
      const extra = i < 4 ? [event(p, "quiz_answered", { scene_id: "s2", item_id: "j", correct: false, response_time_ms: 1000, confidence: 0.5 })] : [];
      writeStream(dataDir, p, "teach-001", quizStream(p, true, 0.9, 1000, extra));
    });
    // s2 (concept c2) was answered by 4 of 6 learners.
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.scenes.map((s) => s.scene_id)).toEqual(["s1"]);
    expect(out.concepts.map((c) => c.concept)).toEqual(["c1"]);
    expect(out.withheld_below_floor).toBe(true);
    expect(JSON.stringify(out)).not.toContain("s2");
  });

  it("the floor cannot be lowered by the context, only raised", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.slice(0, 3).forEach((p) => writeStream(dataDir, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    expect((await classReport(ctxFor(root, { dataDir, minLearners: 2 }), "teach")).status).toBe("suppressed");
    const six = sixLearnersInto(root);
    expect((await classReport(ctxFor(root, { dataDir: six, minLearners: 8 }), "teach")).status).toBe("suppressed");
    expect((await classReport(ctxFor(root, { dataDir: six }), "teach")).status).toBe("ok");
  });

  function sixLearnersInto(_root: string): string {
    const dataDir = tmp("data6");
    PSEUDOS.forEach((p) => writeStream(dataDir, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    return dataDir;
  }

  it("does not turn an unjudged keyword score into accuracy (not measured is not zero)", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.forEach((p) => writeStream(dataDir, p, "teach-001", [
      event(p, "lesson_started", { bundle_uri: "x" }),
      event(p, "critique_submitted", { scene_id: "s3", llm_score: 1, completion_rate: 1, scene_type: "explain_back", score_source: "keyword" }),
    ]));
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    if (out.status !== "ok") throw new Error("expected ok");
    const scene = out.scenes.find((s) => s.scene_id === "s3")!;
    expect(scene).toMatchObject({ n_attempts: 6, n_measured: 0, accuracy: null });
    expect(out.reteach_priority).toEqual([]);
    expect(out.completion_rate).toBe(0); // six lessons started, none completed
  });

  it("counts a model-judged critique as measured", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.forEach((p, i) => writeStream(dataDir, p, "teach-001", [
      event(p, "critique_submitted", { scene_id: "s3", llm_score: i < 3 ? 0.9 : 0.2, completion_rate: 1, scene_type: "explain_back", score_source: "llm" }),
    ]));
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.scenes.find((s) => s.scene_id === "s3")).toMatchObject({ n_measured: 6, accuracy: 0.5 });
  });

  it("suppresses when any event carries no pseudonym or no lesson_id (no cohort can be established)", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.forEach((p) => writeStream(dataDir, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    writeStream(dataDir, "bbbb000000000001", "teach-001", [event(null, "lesson_started", { bundle_uri: "x" })]);
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    expect(out.status).toBe("suppressed");
    expect((out as { reason: string }).reason).toMatch(/learner_pseudonym/);
  });

  it("ignores other lessons' streams and reports no_data when nothing matches", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    PSEUDOS.forEach((p) => writeStream(dataDir, p, "other-lesson", quizStream(p, true, 0.9, 1000, [])
      .map((e) => ({ ...e, lesson_id: "other-lesson" }))));
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    expect(out.status).toBe("no_data");
    expect(JSON.stringify(out)).toMatch(/consent/i);
  });

  it("answers in the bundle's language", async () => {
    const fr = bundle({ metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" } });
    const { root } = library("teach", fr);
    const dataDir = tmp("data");
    PSEUDOS.slice(0, 2).forEach((p) => writeStream(dataDir, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    expect((out as { reason: string }).reason).toMatch(/seuil/i);
  });

  it("validates the inputs: course id, durable data dir, telemetryDir confinement", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    await expect(classReport(ctxFor(root, { dataDir }), "../teach")).rejects.toBeInstanceOf(TeacherToolError);
    await expect(classReport(ctxFor(root, { dataDir }), "Not A Course")).rejects.toBeInstanceOf(TeacherToolError);
    await expect(classReport(ctxFor(root, { dataDir }), "ghost")).rejects.toThrow(/unknown course/i);
    await expect(classReport(ctxFor(root, { dataDir: null }), "teach")).rejects.toThrow(/data/i);
    const outside = tmp("outside");
    await expect(classReport(ctxFor(root, { dataDir, telemetryDir: outside }), "teach")).rejects.toBeInstanceOf(TeacherToolError);
    await expect(classReport(ctxFor(root, { dataDir, telemetryDir: "../.." }), "teach")).rejects.toBeInstanceOf(TeacherToolError);
    symlinkSync(outside, join(dataDir, "link"));
    await expect(classReport(ctxFor(root, { dataDir, telemetryDir: "link" }), "teach")).rejects.toBeInstanceOf(TeacherToolError);
  });

  it("restricts the server-configured telemetryDir to a sub-folder of the data dir", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    const cohort = join(dataDir, "cohort-a");
    mkdirSync(cohort);
    PSEUDOS.forEach((p) => writeStream(cohort, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    PSEUDOS.slice(0, 2).forEach((p) => writeStream(dataDir, `x${p}`, "teach-001", quizStream(`x${p}`, true, 0.9, 1000)));
    const narrowed = await classReport(ctxFor(root, { dataDir, telemetryDir: "cohort-a" }), "teach");
    expect(narrowed.status).toBe("ok");
    const abs = await classReport(ctxFor(root, { dataDir, telemetryDir: cohort }), "teach");
    expect(abs.status).toBe("ok");
  });

  it("gives the model no way to narrow the folder: two calls cannot be differenced down to fewer than k learners", async () => {
    const { root } = library();
    const dataDir = tmp("data");
    const cohort = join(dataDir, "cohort-a");
    mkdirSync(cohort);
    // Five correct learners in a sub-folder plus one wrong "victim" at the top level: narrowing by
    // telemetry_dir would reveal the victim's single answer by subtraction.
    PSEUDOS.slice(0, 5).forEach((p) => writeStream(cohort, p, "teach-001", quizStream(p, true, 0.9, 1000)));
    writeStream(dataDir, "bbbb000000000009", "teach-001", quizStream("bbbb000000000009", false, 0.9, 1000));

    const server = new McpServer({ name: "t", version: "0" });
    registerTeacherTools(server, ctxFor(root, { dataDir }));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(clientT);

    const tool = (await client.listTools()).tools.find((t) => t.name === "class_report")!;
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).toEqual(["course_id"]);

    const read = async (args: Record<string, unknown>) =>
      (await client.callTool({ name: "class_report", arguments: args })).content as Array<{ text: string }>;
    const whole = await read({ course_id: "teach" });
    const withDir = await read({ course_id: "teach", telemetry_dir: "cohort-a" });
    // Whatever the model passes, the report covers the same learners.
    expect(withDir[0]!.text).toBe(whole[0]!.text);
    expect(JSON.parse(whole[0]!.text).cohort_band).toBeDefined();
  });

  it("only reads telemetry.jsonl, never the learner's events, state or mastery files", async () => {
    const { root, dataDir } = sixLearners();
    const secret = "PRIVATE-learner-answer-text";
    for (const p of PSEUDOS) {
      writeFileSync(join(dataDir, p, "teach-001", "events.jsonl"), JSON.stringify({ type: "response", text: secret }) + "\n");
      mkdirSync(join(dataDir, p, "teach-001", "mastery"), { recursive: true });
      writeFileSync(join(dataDir, p, "teach-001", "mastery", "m.jsonld"), secret);
    }
    const out = await classReport(ctxFor(root, { dataDir }), "teach");
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(out.status).toBe("ok");
  });
});
