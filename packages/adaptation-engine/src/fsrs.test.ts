import { describe, it, expect } from "vitest";
import {
  defaultMemoryState,
  retrievability,
  reviewMemory,
  dueAt,
  isDue,
  gradeFromAnswer,
  reinforcementPriority,
  dueForReinforcement,
  nextReinforcement,
} from "./fsrs";

const t0 = Date.UTC(2026, 0, 1);
const days = (n: number): number => t0 + n * 86_400_000;

describe("FSRS retention scheduler", () => {
  it("an unseen concept has R=0 and is due", () => {
    const s = defaultMemoryState("c");
    expect(retrievability(s, t0)).toBe(0);
    expect(isDue(s, t0)).toBe(true);
  });

  it("R=1 right after a review and decays monotonically toward 0", () => {
    const s = reviewMemory(defaultMemoryState("c"), 3, t0);
    expect(retrievability(s, t0)).toBeCloseTo(1, 6);
    const r1 = retrievability(s, days(1));
    const r5 = retrievability(s, days(5));
    expect(r1).toBeLessThan(1);
    expect(r5).toBeLessThan(r1);
    expect(r5).toBeGreaterThan(0);
  });

  it("a 'good' review raises stability and pushes the due date out", () => {
    const s1 = reviewMemory(defaultMemoryState("c"), 3, t0);
    const due1 = dueAt(s1);
    const s2 = reviewMemory(s1, 3, due1);
    expect(s2.stability).toBeGreaterThan(s1.stability);
    expect(dueAt(s2)).toBeGreaterThan(due1);
    expect(s2.reps).toBe(2);
  });

  it("spacing effect: reviewing overdue grows stability more than reviewing fresh", () => {
    const base = reviewMemory(defaultMemoryState("c"), 3, t0);
    const fresh = reviewMemory(base, 3, days(1)); // high R
    const overdue = reviewMemory(base, 3, dueAt(base) + 5 * 86_400_000); // low R
    expect(overdue.stability).toBeGreaterThan(fresh.stability);
  });

  it("a lapse drops stability and raises difficulty", () => {
    const s1 = reviewMemory(reviewMemory(defaultMemoryState("c"), 3, t0), 3, days(10));
    const lapsed = reviewMemory(s1, 1, days(20));
    expect(lapsed.stability).toBeLessThanOrEqual(s1.stability);
    expect(lapsed.difficulty).toBeGreaterThan(s1.difficulty);
    expect(lapsed.lapses).toBe(1);
  });

  it("easy beats good beats hard for stability growth", () => {
    const base = reviewMemory(defaultMemoryState("c"), 3, t0);
    const when = dueAt(base);
    const hard = reviewMemory(base, 2, when).stability;
    const good = reviewMemory(base, 3, when).stability;
    const easy = reviewMemory(base, 4, when).stability;
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it("difficulty stays within [1,10] under repeated lapses", () => {
    let s = reviewMemory(defaultMemoryState("c"), 3, t0);
    for (let i = 1; i < 30; i++) s = reviewMemory(s, 1, days(i));
    expect(s.difficulty).toBeLessThanOrEqual(10);
    expect(s.difficulty).toBeGreaterThanOrEqual(1);
  });

  it("gradeFromAnswer maps wrong→again, hinted→hard, clean→good (M5 anti-offloading)", () => {
    expect(gradeFromAnswer({ correct: false, hint_count: 0 })).toBe(1);
    expect(gradeFromAnswer({ correct: true, hint_count: 2 })).toBe(2);
    expect(gradeFromAnswer({ correct: true, hint_count: 0 })).toBe(3);
  });

  it("reinforcementPriority peaks for mastered-but-decaying concepts", () => {
    expect(reinforcementPriority(0.9, 0.5)).toBeGreaterThan(reinforcementPriority(0.9, 0.95));
    expect(reinforcementPriority(0.9, 0.5)).toBeGreaterThan(reinforcementPriority(0.3, 0.5));
  });

  it("dueForReinforcement returns mastered+due concepts, most-urgent first, excluding unmastered", () => {
    const a = reviewMemory(defaultMemoryState("a"), 3, t0);
    const b = reviewMemory(defaultMemoryState("b"), 3, t0);
    const now = days(30); // both well overdue
    const out = dueForReinforcement({ a, b }, { a: 0.9, b: 0.7 }, now, { minMastery: 0.6 });
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out[0]).toBe("a"); // higher mastery → higher priority at equal decay
    expect(dueForReinforcement({ a }, { a: 0.3 }, now, { minMastery: 0.6 })).toEqual([]);
  });

  it("nextReinforcement returns the single most-urgent due concept (router head), or null", () => {
    const a = reviewMemory(defaultMemoryState("a"), 3, t0);
    const b = reviewMemory(defaultMemoryState("b"), 3, t0);
    const now = days(30);
    // a has higher mastery → higher priority at equal decay → it is THE next reinforcement
    expect(nextReinforcement({ a, b }, { a: 0.9, b: 0.7 }, now, { minMastery: 0.6 })).toBe("a");
    // nothing mastered+due → null (not an empty list — a single routing decision)
    expect(nextReinforcement({}, {}, now)).toBeNull();
    expect(nextReinforcement({ a }, { a: 0.3 }, now, { minMastery: 0.6 })).toBeNull();
    // freshly reviewed (not yet decayed) → not due → null
    expect(nextReinforcement({ a }, { a: 0.9 }, t0, { minMastery: 0.6 })).toBeNull();
  });
});
