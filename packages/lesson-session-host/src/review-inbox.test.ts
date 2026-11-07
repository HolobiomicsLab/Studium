// INT-STUDIUM-058 task 6.1: the review inbox (pure part) and the reader of the review receipts.
import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewInbox, canonicalJson, readLastReceipt, sceneFingerprint, sceneHoldsKey,
  REVIEW_RECEIPT_SCHEMA, type ReviewReceipt,
} from "./review-inbox.js";

const intro = { id: "s0", type: "intro", markdown: "Welcome." };
const quiz = { id: "s1", type: "quiz", question: "Q?", choices: [{ id: "a", text: "x", correct: false }, { id: "b", text: "y", correct: true }] };
const figure = { id: "s2", type: "concept", markdown: "See the figure.", image_path: "assets/fig.png" };
const explain = { id: "s3", type: "explain_back", prompt: "Explain.", key_points: [{ id: "p", text: "k" }] };
const todoScene = { id: "s4", type: "concept", markdown: "TODO: write me" };

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "inbox-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function receipt(items: ReviewReceipt["items"], decidedAt = "2026-11-01T10:00:00Z"): ReviewReceipt {
  return {
    schema: REVIEW_RECEIPT_SCHEMA, reviewer: "Dr Example", decided_at: decidedAt, bundle_ref: "teach",
    bundle_sha256: "a".repeat(64), decision: "approved", items, opened: items.length, not_opened: 0,
  };
}

describe("canonicalJson", () => {
  it("is compact, sorts keys recursively, keeps array order and non-ASCII text (Python sort_keys, ensure_ascii=False)", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: "é" }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":"é","z":1}]},"b":1}');
  });
  it("sorts keys by code point, like Python, not by UTF-16 unit", () => {
    // U+FF21 sorts before U+1F600 by code point but after it by UTF-16 unit (0xD83D < 0xFF21).
    expect(canonicalJson({ "\u{1F600}": 1, "Ａ": 2 })).toBe('{"Ａ":2,"\u{1F600}":1}');
  });
});

describe("sceneFingerprint", () => {
  it("is the sha256 of the canonical JSON of the whole scene, independent of key order", () => {
    const expected = createHash("sha256").update(canonicalJson(quiz), "utf8").digest("hex");
    expect(sceneFingerprint(quiz)).toBe(expected);
    const reordered = { choices: quiz.choices, type: "quiz", question: "Q?", id: "s1" };
    expect(sceneFingerprint(reordered)).toBe(expected);
  });
});

describe("sceneHoldsKey", () => {
  it("is true for a non-empty answer-bearing field or a correct quiz choice, false otherwise", () => {
    expect(sceneHoldsKey(quiz)).toBe(true);
    expect(sceneHoldsKey(explain)).toBe(true);
    expect(sceneHoldsKey(intro)).toBe(false);
    expect(sceneHoldsKey({ id: "x", type: "explain_back", key_points: [], model_explanation: "  " })).toBe(false);
    expect(sceneHoldsKey({ id: "x", type: "quiz", choices: [{ id: "a", text: "t", correct: false }] })).toBe(false);
    expect(sceneHoldsKey(null)).toBe(false);
  });
});

describe("buildReviewInbox", () => {
  const scenes = [intro, quiz, figure, explain, todoScene];
  const build = (extra: Partial<Parameters<typeof buildReviewInbox>[0]> = {}) => buildReviewInbox({
    rawScenes: scenes, lintFindings: [], todoPerScene: new Map([["s4", 1]]), schemaValid: true, lastReceipt: null, ...extra,
  });

  it("sorts items blocks, grading, wording, media, stable by scene order inside a class", () => {
    const inbox = build();
    expect(inbox.items.map((i) => [i.id, i.consequence])).toEqual([
      ["s4", "blocks"], ["s1", "grading"], ["s3", "grading"], ["s0", "wording"], ["s2", "media"],
    ]);
    expect(inbox.counts.consequence).toEqual({ blocks: 1, grading: 2, wording: 1, media: 1 });
  });

  it("marks every item new without a receipt and withholds the fingerprint of key-holding items", () => {
    const inbox = build();
    expect(inbox.items.every((i) => i.what_changed === "new")).toBe(true);
    expect(inbox.counts.what_changed).toEqual({ new: 5, changed: 0, unchanged: 0 });
    expect(inbox.last_receipt).toBeNull();
    for (const item of inbox.items) {
      if (item.holds_key) expect(item).not.toHaveProperty("sha256");
      else expect(item.sha256).toBe(sceneFingerprint(scenes.find((s) => s.id === item.id)));
    }
  });

  it("compares with the last receipt: same fingerprint unchanged, other fingerprint changed, absent id new", () => {
    const last = receipt([
      { id: "s0", sha256: sceneFingerprint(intro), consequence: "wording", opened: true, verdict: "ok" },
      { id: "s1", sha256: sceneFingerprint({ ...quiz, question: "Old?" }), consequence: "grading", opened: true },
    ]);
    const inbox = build({ lastReceipt: last });
    const byId = new Map(inbox.items.map((i) => [i.id, i.what_changed]));
    expect(Object.fromEntries(byId)).toEqual({ s0: "unchanged", s1: "changed", s2: "new", s3: "new", s4: "new" });
    expect(inbox.last_receipt).toEqual({
      reviewer: "Dr Example", decided_at: "2026-11-01T10:00:00Z", decision: "approved",
      bundle_sha256: "a".repeat(64), opened: 2, not_opened: 0,
    });
    expect(JSON.stringify(inbox.last_receipt)).not.toContain(sceneFingerprint(intro));
  });

  it("checks schema, todo and lint per scene; a lint ERROR is attributed by its message prefix only", () => {
    const inbox = build({
      lintFindings: [
        { level: "ERROR", code: "quiz_answer_key", message: "s0: 2 correct choices" },
        { level: "WARN", code: "x", message: "s2: only a warning" },
        { level: "ERROR", code: "unfilled_placeholder", message: "scenes.2.markdown: unfilled placeholder" },
        { level: "ERROR", code: "lwg_cycle", message: "prerequisite cycle: a -> b" },
      ],
      schemaValid: false, schemaErrors: [{ path: "scenes.3.prompt" }, { path: "concepts" }],
    });
    const item = (id: string) => inbox.items.find((i) => i.id === id)!;
    expect(item("s0").consequence).toBe("blocks");
    expect(item("s0").checks).toEqual([{ check: "schema", passed: true }, { check: "todo", passed: true }, { check: "lint", passed: false }]);
    expect(item("s2").consequence).toBe("blocks");
    expect(item("s3").checks.find((c) => c.check === "schema")!.passed).toBe(false);
    expect(item("s4").checks.find((c) => c.check === "todo")!.passed).toBe(false);
    expect(item("s1").consequence).toBe("grading");
    expect(JSON.stringify(inbox)).not.toContain("correct choices");
  });

  it("leaves the lint check out when the linter did not run", () => {
    const inbox = build({ lintFindings: null });
    expect(inbox.items[0]!.checks.map((c) => c.check)).toEqual(["schema", "todo"]);
  });

  // Walkthrough fix 1: the inbox shows what it asks to judge, the scene's public face, never a key.
  it("gives each item a preview: title, kind, the learner-facing text, and a quiz's choice texts without any correct flag", () => {
    const titled = { ...quiz, title: "Le quiz", feedback_correct: "FEEDBACK-KEY", hints: ["HINT-KEY"] };
    const inbox = build({ rawScenes: [intro, titled] });
    const item = (id: string) => inbox.items.find((i) => i.id === id)!;
    expect(item("s1").preview).toEqual({ title: "Le quiz", kind: "quiz", text: "Q?", choices: ["x", "y"] });
    expect(item("s0").preview).toEqual({ title: "s0", kind: "intro", text: "Welcome." });
    const json = JSON.stringify(inbox);
    expect(json).not.toContain('"correct"');
    expect(json).not.toContain("FEEDBACK-KEY");
    expect(json).not.toContain("HINT-KEY");
  });

  it("never takes the preview text from a key or reveal field, and cuts it at 280 characters", () => {
    const keyed = {
      id: "k", type: "explain_back", title: "T",
      reveal: "REVEAL-KEY", answer_key: "ANSWER-KEY", expected: "EXPECTED-KEY", key_points: [{ id: "p", text: "POINT-KEY" }],
      model_answer: "MODEL-KEY", model_explanation: "EXPLANATION-KEY", prompt: `Explain  it\n${"é".repeat(400)}`,
    };
    const onlyKeys = { id: "k2", type: "comparison", reveal: "REVEAL-KEY", answer_key: "ANSWER-KEY", model_answer: "MODEL-KEY" };
    const inbox = build({ rawScenes: [keyed, onlyKeys] });
    const preview = inbox.items.find((i) => i.id === "k")!.preview;
    expect(preview.text.startsWith("Explain it éé")).toBe(true);
    expect(Array.from(preview.text).length).toBeLessThanOrEqual(280);
    expect(preview.text.endsWith("…")).toBe(true);
    expect(inbox.items.find((i) => i.id === "k2")!.preview.text).toBe("");
    const json = JSON.stringify(inbox.items.map((i) => i.preview));
    for (const key of ["REVEAL-KEY", "ANSWER-KEY", "EXPECTED-KEY", "POINT-KEY", "MODEL-KEY", "EXPLANATION-KEY"]) expect(json).not.toContain(key);
  });

  it("leaves the fingerprint unchanged: the preview is derived, not part of what is hashed", () => {
    const item = build({ rawScenes: [intro] }).items[0]!;
    expect(item.sha256).toBe(sceneFingerprint(intro));
  });

  it("returns no items when scenes is not an array", () => {
    const inbox = build({ rawScenes: null });
    expect(inbox.items).toEqual([]);
    expect(inbox.counts.what_changed).toEqual({ new: 0, changed: 0, unchanged: 0 });
  });
});

describe("readLastReceipt", () => {
  it("returns null without a reviews folder", async () => {
    expect(await readLastReceipt(tmp())).toEqual({ receipt: null, unreadable: 0 });
    expect(await readLastReceipt(null)).toEqual({ receipt: null, unreadable: 0 });
  });

  it("keeps the latest receipt by decided_at, ties broken by file name; counts malformed files; ignores other names", async () => {
    const course = tmp();
    mkdirSync(join(course, "reviews"));
    const write = (name: string, value: unknown) => writeFileSync(join(course, "reviews", name), typeof value === "string" ? value : JSON.stringify(value));
    write("2026-11-03-aaaa.json", receipt([], "2026-11-03T08:00:00Z"));
    write("2026-11-01-bbbb.json", { ...receipt([], "2026-11-05T08:00:00Z"), reviewer: "Same time, earlier file name" });
    write("2026-11-02-cccc.json", { ...receipt([], "2026-11-05T08:00:00Z"), reviewer: "Same time, later file name" });
    write("2026-11-04-dddd.json", "{ not json");
    write("2026-11-04-eeee.json", { schema: "other/v1" });
    write("notes.json", receipt([], "2026-12-31T00:00:00Z"));
    write("2026-11-09-XYZW.json", receipt([], "2026-12-31T00:00:00Z"));
    const out = await readLastReceipt(course);
    expect(out.receipt?.reviewer).toBe("Same time, later file name");
    expect(out.unreadable).toBe(2);
  });

  it("does not follow a receipt or a reviews folder that leaves the course folder", async () => {
    const course = tmp();
    const outside = tmp();
    writeFileSync(join(outside, "2026-11-05-ffff.json"), JSON.stringify(receipt([], "2026-11-05T08:00:00Z")));
    mkdirSync(join(course, "reviews"));
    symlinkSync(join(outside, "2026-11-05-ffff.json"), join(course, "reviews", "2026-11-05-ffff.json"));
    expect((await readLastReceipt(course)).receipt).toBeNull();
    const course2 = tmp();
    symlinkSync(outside, join(course2, "reviews"));
    expect((await readLastReceipt(course2)).receipt).toBeNull();
  });
});
