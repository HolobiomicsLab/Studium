import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost, type SessionStartResult } from "./host.js";
import { GraphViewSchema } from "@studium/typed-graph-lens";

const roots: string[] = [];
const LEARNED_AT = Date.parse("2026-10-01T09:00:00Z");
function tmp(): string { const root = mkdtempSync(join(tmpdir(), "host-b2-")); roots.push(root); return root; }
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const base = (id: string, type: string, concept: string) => ({
  id, type, title: id, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const quiz = (id: string, concept: string) => ({
  ...base(id, "quiz", concept), question: "Which?",
  choices: Array.from({ length: 6 }, (_, i) => ({ id: `source-${i}`, text: `Choice ${i}`, correct: i === 0 })),
  feedback_correct: "Yes.", feedback_incorrect: "Try again.", hints: [],
});
function bundle(scenes: Array<{ concept_refs: string[]; [key: string]: unknown }>, language = "en") {
  return {
    schema_version: "1.4", bundle_id: "b2-lesson", source_plan_id: "p",
    metadata: { title: "B2 lesson", target: "L1", duration_minutes: 5, language, discipline: "chemistry",
      authoring: { mode: "self_study", author_is_learner: true, drafted_by: "agent" } },
    concepts: [...new Set(scenes.flatMap((s) => s.concept_refs))].map((id) => ({
      id, title: id, description: "d", bloom_level_target: "understand",
    })),
    scenes, rules: [], validated_by: "SELF-STUDY — not teacher-validated", validated_at: "2026-10-01T00:00:00Z",
  };
}
function setup(scenes: Array<{ concept_refs: string[]; [key: string]: unknown }>, dataDir: string | null = null) {
  const root = tmp();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(bundle(scenes)));
  const host = new SessionHost({ bundlesRoot: root, live: false, dataDir, timeZone: "Europe/Paris",
    clock: { now: () => new Date(LEARNED_AT).toISOString() } });
  return { root, host };
}
function choices(started: Pick<SessionStartResult, "presentation">) {
  return (started.presentation.scene as { choices: Array<{ id: string; text: string }> }).choices;
}
async function correct(host: SessionHost, id: string) {
  const choice = choices({ presentation: host.currentPresentation(id) }).find((c) => c.text === "Choice 0")!;
  return host.respond(id, { kind: "quiz_choice", choiceId: choice.id });
}

describe("B2 public completion and provenance", () => {
  it("the public workflow graph reports unmeasured mastery as null without a numeric display value", async () => {
    const scenes = [quiz("q", "measured"), { ...base("reading", "concept", "unmeasured"), markdown: "Read this." }];
    const { root, host } = setup(scenes);
    writeFileSync(join(root, "lesson.json"), JSON.stringify({ ...bundle(scenes), learning_workflow_graph: {
      schema_version: "1.0", course_id: "course", edges: [], nodes: ["measured", "unmeasured"].map((id) => ({
        id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand",
      })),
    } }));
    const started = await host.create("lesson.json", "ana");
    const before = host.workflowGraph(started.sessionId)!;
    expect(before.nodes.every((node) => node.value === undefined && node.attrs?.mastery === null)).toBe(true);
    await correct(host, started.sessionId);
    const after = host.workflowGraph(started.sessionId)!;
    expect(GraphViewSchema.safeParse(after).success).toBe(true);
    expect(after.nodes.find((node) => node.id === "concept:measured")?.value).toBeGreaterThan(0);
    expect(after.nodes.find((node) => node.id === "concept:unmeasured")).toMatchObject({ attrs: { mastery: null } });
    expect(after.nodes.find((node) => node.id === "concept:unmeasured")?.value).toBeUndefined();
  });

  it("reports unmeasured mastery as null on every presentation and completion, with the host's split", async () => {
    const { host } = setup([
      quiz("q1", "consolidated"), quiz("q2", "consolidated"), quiz("q3", "consolidated"),
      quiz("q4", "practised"), { ...base("reading", "concept", "unmeasured"), markdown: "Read this." },
    ]);
    const started = await host.create("lesson.json", "learner");
    expect(started.presentation.learnerSnapshot.conceptMastery).toEqual({ consolidated: null, practised: null, unmeasured: null });
    for (let i = 0; i < 4; i += 1) await correct(host, started.sessionId);
    expect(host.currentPresentation(started.sessionId).learnerSnapshot.conceptMastery.unmeasured).toBeNull();
    const done = await host.respond(started.sessionId, { kind: "ack" });
    expect(done.kind).toBe("complete");
    if (done.kind !== "complete") throw new Error("expected completion");
    expect(done.summary.mastery.unmeasured).toBeNull();
    expect(done.summary.mastery.consolidated).toBeGreaterThanOrEqual(0.6);
    expect(done).toMatchObject({ completion: {
      consolidated: ["consolidated"], practised: [{ concept_id: "practised", answers: 1 }], not_measured: ["unmeasured"],
    } });
  });

  it("serves drafted_by and the AI-key provenance even on the final verdict", async () => {
    const { host } = setup([quiz("q", "c")]);
    const started = await host.create("lesson.json");
    expect(started.authoring).toHaveProperty("drafted_by", "agent");
    expect(started.presentation.authoring).toHaveProperty("drafted_by", "agent");
    const done = await correct(host, started.sessionId);
    // A standalone notice capitalizes its first word.
    expect(done.verdict?.display_markdown).toContain("Per the AI-drafted key — see the cited passage.");
  });

  it("shows a stale approval notice on the first screen only", async () => {
    const { host, root } = setup([quiz("q1", "c"), quiz("q2", "c")]);
    writeFileSync(join(root, "approval.json"), JSON.stringify({ schema: "studium-approval/1", bundle_sha256: "stale-hash" }));
    const started = await host.create("lesson.json");
    expect(started.authoring.approval).toMatchObject({ recorded: true, matches: false });
    // RT-4 names what changed in learner language, without exposing the hash.
    expect(started.presentation.display_markdown).toContain("this lesson changed after the teacher approved it");
    const next = await correct(host, started.sessionId);
    expect(next.display_markdown).not.toContain("this lesson changed after the teacher approved it");
  });
});

describe("RFR-12 review choice order", () => {
  it("names the source bundle of every review item for relative assets", async () => {
    const { host } = setup([quiz("q", "c")]);
    const learned = await host.create("lesson.json", "ana");
    await correct(host, learned.sessionId);
    const review = await host.startReview("ana", { nowMs: Date.parse("2026-11-01T12:00:00Z") });
    expect(review).toMatchObject({ status: "started", review: { items: [{ bundle_ref: "lesson.json" }] } });
  });

  it("uses learner and review day in the host zone, while an open session keeps its letters", async () => {
    vi.stubEnv("STUDIUM_PER_LEARNER_SHUFFLE", "");
    const { host } = setup([quiz("q", "c")]);
    for (const learner of ["ana", "ben"]) {
      const start = await host.create("lesson.json", learner);
      await correct(host, start.sessionId);
    }
    const order = async (learner: string, iso: string) => {
      const review = await host.startReview(learner, { nowMs: Date.parse(iso) });
      if (review.status !== "started") throw new Error("expected a due review");
      return { review, order: choices(review) };
    };
    const first = await order("ana", "2026-11-01T22:30:00Z"); // 23:30 in Paris
    const sameDay = await order("ana", "2026-11-01T22:59:00Z");
    const nextDay = await order("ana", "2026-11-01T23:01:00Z"); // still Nov 1 UTC, Nov 2 in Paris
    const other = await order("ben", "2026-11-01T22:30:00Z");
    expect(first.order).toEqual(sameDay.order);
    expect(nextDay.order).not.toEqual(first.order);
    expect(other.order).not.toEqual(first.order);
    expect(choices({ presentation: host.currentPresentation(first.review.sessionId) })).toEqual(first.order);
    expect(first.review.review.items[0]).toHaveProperty("bundle_ref", "lesson.json");
    const right = first.order.find((c) => c.text === "Choice 0")!;
    expect((await host.respond(first.review.sessionId, { kind: "quiz_choice", choiceId: right.id })).verdict?.correct).toBe(true);
  });

  it("keeps a resumed lesson's letters across days and server restarts", async () => {
    vi.stubEnv("STUDIUM_PER_LEARNER_SHUFFLE", "1");
    const dataDir = tmp();
    const { root, host } = setup([quiz("q1", "c1"), quiz("q2", "c2")], dataDir);
    const first = await host.create("lesson.json", "ana", { nowMs: LEARNED_AT });
    await correct(host, first.sessionId);
    const before = choices({ presentation: host.currentPresentation(first.sessionId) });
    const restarted = new SessionHost({ bundlesRoot: root, live: false, dataDir, timeZone: "Europe/Paris" });
    const resumed = await restarted.create("lesson.json", "ana", { nowMs: LEARNED_AT + 86_400_000 });
    expect(resumed.resume.kind).toBe("resumed");
    expect(choices(resumed)).toEqual(before);
  });
});
