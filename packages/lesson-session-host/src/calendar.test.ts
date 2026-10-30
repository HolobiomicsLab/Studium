// packages/lesson-session-host/src/calendar.test.ts
//
// RFR-13, R-en-05: the dates Studium returns (due_date, next_review_date, next_due_date) and the dates
// it prints (« samedi 31 octobre 2026 ») come from ONE time zone, the server's (get_server_info
// reports it; it defaults to the machine's own). They used to disagree near midnight: a UTC day in the
// JSON, a local day in the text.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { calendarDate, checkTimeZone, localTimeZone } from "./calendar.js";
import { formatReviewDate } from "./chat-display.js";
import { buildStudyPlan } from "./study-plan.js";
import { emptyStudyRecord } from "./study-record.js";
import { defaultMemoryState, dueAt, reviewMemory, type ConceptMemoryState } from "./fsrs-memory.js";
import { SessionHost } from "./host.js";

const LATE_EVENING_UTC = Date.parse("2026-10-30T23:30:00Z"); // Saturday 00:30 in Paris (UTC+1)

describe("calendarDate and formatReviewDate", () => {
  it("name the same day in the same time zone", () => {
    expect(calendarDate(LATE_EVENING_UTC, "Europe/Paris")).toBe("2026-10-31");
    expect(formatReviewDate(LATE_EVENING_UTC, "fr", "Europe/Paris")).toBe("samedi 31 octobre 2026");
    expect(calendarDate(LATE_EVENING_UTC, "UTC")).toBe("2026-10-30");
    expect(formatReviewDate(LATE_EVENING_UTC, "en", "UTC")).toBe(new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(LATE_EVENING_UTC));
    expect(formatReviewDate(LATE_EVENING_UTC, "en", "UTC")).toContain("30 October 2026");
  });

  it("refuses a time zone the runtime does not know, and defaults to the machine's", () => {
    expect(() => checkTimeZone("Mars/Olympus_Mons")).toThrow(/time zone/);
    expect(checkTimeZone("Europe/Paris")).toBe("Europe/Paris");
    expect(localTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("the study plan dates its reviews in its time zone", () => {
  it("returns the day it prints, near midnight", () => {
    const fresh = reviewMemory(defaultMemoryState("c-a"), 3, 0);
    const interval = dueAt(fresh) - 0;
    const memory: Record<string, ConceptMemoryState> = { "c-a": { ...fresh, last_reviewed_at: LATE_EVENING_UTC - interval } };
    const plan = buildStudyPlan({
      nowMs: LATE_EVENING_UTC + 60_000, memory, mastery: { "c-a": 0.9 }, record: emptyStudyRecord(), completedLessons: [],
      catalog: { lessons: [], courses: [], skipped: 0 }, locale: "fr", learnerId: "ana",
      playableReviews: new Set(["c-a"]), measured: new Set(["c-a"]), timeZone: "Europe/Paris",
    });
    expect(plan.due_reviews[0]!.due_date).toBe("2026-10-31");
    expect(plan.display_markdown).toContain("samedi 31 octobre 2026");
  });
});

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("the host dates every review in its time zone", () => {
  it("rate_recall's next_review_date is the day its line prints, near midnight", async () => {
    const bundles = mkdtempSync(join(tmpdir(), "calendar-"));
    dirs.push(bundles);
    const scene = {
      id: "s-e", type: "explain_back", title: "E", objective_refs: [], concept_refs: ["c-e"], estimated_seconds: 30,
      adaptation_hooks: [], prompt: "Explique.", key_points: [{ id: "kp", text: "point", cues: ["x"] }],
      model_explanation: "modèle", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    };
    const bundle = {
      schema_version: "1.4", bundle_id: "lesson-e", source_plan_id: "p",
      metadata: { title: "E", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
      concepts: [{ id: "c-e", title: "Notion", description: "d", bloom_level_target: "understand" }],
      scenes: [scene], rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
    };
    mkdirSync(dirname(join(bundles, "E.json")), { recursive: true });
    writeFileSync(join(bundles, "E.json"), JSON.stringify(bundle));
    // A "good" rating schedules the next review one interval later: start so that it falls at 20:00 UTC,
    // which is already the next day at UTC+14.
    const interval = dueAt(reviewMemory(defaultMemoryState("c-e"), 3, 0));
    const ratedAt = Date.parse("2026-11-05T20:00:00Z") - interval;
    const clock = { now: () => new Date(ratedAt).toISOString() };
    const zone = "Pacific/Kiritimati";
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock, timeZone: zone });
    expect(host.timeZone).toBe(zone);
    const s = await host.create("E.json", "ana");
    await host.respond(s.sessionId, { kind: "reply", text: "Une explication." });
    const rated = await host.rateRecall(s.sessionId, "s-e", "good");
    expect(rated.next_review_date).toBe("2026-11-06");
    expect(rated.next_review_date).toBe(calendarDate(rated.next_review_at, zone));
    expect(rated.display_markdown).toContain(formatReviewDate(rated.next_review_at, "fr", zone));
    expect(() => new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, timeZone: "Nowhere/Land" })).toThrow(/time zone/);
  });
});
