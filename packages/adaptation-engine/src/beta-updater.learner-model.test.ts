// RT-2 (bounded): the two learner-model corrections of the Beta update — a cap on the pseudo-counts
// and a correction for guessing on choice items. Both are pinned against the probes of the
// 2026-10-30 map (beta.mts): mastery 0.94 after 10 correct still read 0.55 after 8 more wrong, and a
// coin-flipper on a 2-choice quiz read 0.50.
import { describe, expect, it } from "vitest";
import { defaultConceptState, masteryOf, type ConceptState } from "@studium/learner-state";
import { updateBeta, PSEUDO_COUNT_CAP } from "./beta-updater";

const answer = (correct: boolean, guess_rate?: number, hint_count = 0) => ({
  kind: "answer_submitted" as const, concept_id: "c", scene_id: "q", correct,
  time_ms: 0, hint_count, difficulty: 0.5, ...(guess_rate === undefined ? {} : { guess_rate }),
});
const play = (outcomes: boolean[], guess_rate?: number, from: ConceptState = defaultConceptState("c")) =>
  outcomes.reduce((s, correct) => updateBeta(s, answer(correct, guess_rate)), from);
const alternating = (n: number) => Array.from({ length: n }, (_, i) => i % 2 === 0);

describe("pseudo-count cap", () => {
  it("never lets alpha + beta exceed the cap, and keeps a long streak's posterior high", () => {
    const s = play(Array(30).fill(true));
    expect(PSEUDO_COUNT_CAP).toBe(20);
    expect(s.alpha + s.beta).toBeLessThanOrEqual(PSEUDO_COUNT_CAP + 1e-9);
    expect(masteryOf(s)).toBeGreaterThan(0.95);
    expect(s.total_attempts).toBe(30); // the evidence COUNT is not capped, only its weight
    expect(s.total_correct).toBe(30);
  });

  it("keeps the estimate responsive after a long streak (uncapped: 0.84 after 30 right + 5 wrong)", () => {
    const s = play([...Array(30).fill(true), ...Array(5).fill(false)]);
    expect(masteryOf(s)).toBeLessThan(0.7);
  });

  it("leaves short histories exactly as before (the cap only binds above 20 pseudo-observations)", () => {
    const s = play([true, true, false]);
    expect(s.alpha).toBeCloseTo(4, 10);
    expect(s.beta).toBeCloseTo(2.5, 10);
  });
});

describe("correction for guessing (formula scoring) on choice items", () => {
  it("a coin-flipper on a 2-choice quiz no longer reads 0.50", () => {
    expect(masteryOf(play(alternating(12)))).toBeCloseTo(0.5, 5); // the legacy reading, no guess rate
    expect(masteryOf(play(alternating(12), 0.5))).toBeLessThan(0.15);
  });

  it("random answers on a 4-choice quiz (1 right in 4) read near zero, not the 0.25 hit rate", () => {
    const quarter = [true, false, false, false, true, false, false, false, true, false, false, false];
    expect(masteryOf(play(quarter))).toBeGreaterThan(0.25);
    expect(masteryOf(play(quarter, 0.25))).toBeLessThan(0.1);
  });

  it("does not touch a correct answer: two clean answers on a 2-choice quiz still reach 0.8", () => {
    const s = play([true, true], 0.5);
    expect(s.alpha).toBeCloseTo(4, 10);
    expect(s.beta).toBeCloseTo(1, 10);
    expect(masteryOf(s)).toBeCloseTo(0.8, 10);
  });

  it("a wrong answer reclassifies the expected lucky credit g/(1-g) of an earlier success", () => {
    // one right then one wrong on a true/false item: the right answer's 1.5 of credit is exactly the
    // lucky guess a coin-flipper produces for every miss, so it moves from alpha to beta.
    const s = play([true, false], 0.5);
    expect(s.alpha).toBeCloseTo(1, 10);
    expect(s.beta).toBeCloseTo(4, 10);
    // the same pair on a 4-choice item reclassifies a third of that credit (g/(1-g) = 1/3).
    const four = play([true, false], 0.25);
    expect(four.alpha).toBeCloseTo(2, 10);
    expect(four.beta).toBeCloseTo(3, 10);
  });

  it("never takes alpha below the prior: a first answer that is wrong only adds its own weight", () => {
    const s = play([false], 0.5);
    expect(s.alpha).toBe(1);
    expect(s.beta).toBeCloseTo(2.5, 10);
  });

  it("counts observed answers, not corrected ones", () => {
    const s = play([true, false, true, false], 0.5);
    expect(s.total_attempts).toBe(4);
    expect(s.total_correct).toBe(2);
    expect(s.consecutive_errors).toBe(1);
  });

  it("is a no-op without a guess rate or with a zero one (free text, verdict deck, legacy signals)", () => {
    expect(play([true, false], 0)).toEqual(play([true, false]));
    expect(play([true, false]).alpha).toBeCloseTo(2.5, 10);
  });
});
