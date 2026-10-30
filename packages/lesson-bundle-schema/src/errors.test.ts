// RT-7: a bundle that does not validate is reported as {path, message, hint}, not as the raw
// ZodError dump (the probe of the 2026-10-30 map: schema_version 1.5 + an unknown scene type).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LessonBundleSchema, formatBundleError, type BundleIssue } from "./index";

function bundle(overrides: Record<string, unknown> = {}, scene: Record<string, unknown> = {}) {
  return {
    schema_version: "1.4", bundle_id: "b", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
    scenes: [{
      id: "s1", type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0,
      adaptation_hooks: [], question: "?", feedback_correct: "y", feedback_incorrect: "n", hints: [],
      choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }], ...scene,
    }],
    rules: [], validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z", ...overrides,
  };
}

function issuesOf(input: unknown): BundleIssue[] {
  const parsed = LessonBundleSchema.safeParse(input);
  if (parsed.success) throw new Error("expected a validation failure");
  return formatBundleError(parsed.error, input);
}

function issueAt(issues: BundleIssue[], path: string): BundleIssue {
  const issue = issues.find((candidate) => candidate.path === path);
  if (!issue) throw new Error(`no issue at ${path}: ${JSON.stringify(issues)}`);
  return issue;
}

describe("formatBundleError", () => {
  it("names the version this Studium reads and the unknown scene type, with the accepted ones", () => {
    const issues = issuesOf(bundle({ schema_version: "1.5" }, { type: "hologram" }));
    const version = issueAt(issues, "schema_version");
    expect(version.message).toBe('must be "1.4", got "1.5"');
    expect(version.hint).toMatch(/lesson bundles 1\.4/);
    const type = issueAt(issues, "scenes.0.type");
    expect(type.message).toBe('"hologram" is not a known type');
    expect(type.hint).toMatch(/^use one of: intro, concept, quiz, /);
    expect(JSON.stringify(issues)).not.toMatch(/invalid_literal|invalid_union_discriminator/);
  });

  it("reports a missing field by name", () => {
    const input = bundle({}, { question: undefined });
    expect(issueAt(issuesOf(input), "scenes.0.question")).toEqual({
      path: "scenes.0.question", message: "required field is missing", hint: 'add "question"',
    });
  });

  it("states array and string bounds in words", () => {
    const issues = issuesOf(bundle({ validated_by: "x" }, { choices: [{ id: "a", text: "A", correct: true }] }));
    expect(issueAt(issues, "scenes.0.choices").message).toBe("needs at least 2 items, has 1");
    expect(issueAt(issues, "validated_by").message).toBe("needs at least 3 characters");
  });

  it("explains a malformed date-time with an example", () => {
    const issue = issueAt(issuesOf(bundle({ validated_at: "yesterday" })), "validated_at");
    expect(issue.message).toBe("must be an ISO 8601 date-time");
    expect(issue.hint).toMatch(/2026-10-30T12:00:00Z/);
  });

  it("lists unknown fields of a strict object and an enum's accepted values", () => {
    const schema = z.object({ level: z.enum(["low", "high"]) }).strict();
    const input = { level: "mid", levle: "x" };
    const parsed = schema.safeParse(input);
    if (parsed.success) throw new Error("expected a failure");
    const issues = formatBundleError(parsed.error, input);
    expect(issueAt(issues, "level")).toEqual({ path: "level", message: '"mid" is not allowed', hint: "use one of: low, high" });
    expect(issueAt(issues, "")).toEqual({ path: "", message: "unknown field: levle", hint: "remove it or fix its spelling" });
  });

  it("reports a failed plain union through its closest alternative", () => {
    const schema = z.object({ out: z.union([z.string(), z.object({ value: z.number() })]) });
    const input = { out: { value: "seven" } };
    const parsed = schema.safeParse(input);
    if (parsed.success) throw new Error("expected a failure");
    expect(formatBundleError(parsed.error, input)).toEqual([
      { path: "out.value", message: "expected number, got string", hint: "give a number" },
    ]);
  });

  it("gives every issue a non-empty message and hint", () => {
    const issues = issuesOf({ scenes: [{}], rules: "none" });
    expect(issues.length).toBeGreaterThan(3);
    for (const issue of issues) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.hint.length).toBeGreaterThan(0);
    }
  });
});
