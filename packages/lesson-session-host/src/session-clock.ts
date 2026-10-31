// packages/lesson-session-host/src/session-clock.ts
//
// `now_ms` (lead decision L-1, findings RFR-01, R-en-02, CC-3). A harness that replays days of study
// in minutes passes now_ms to get_study_plan, start_lesson_session and start_review_session. Reading
// the schedule at that instant is not enough: the session it starts must also STAMP there — its
// answers, its self-ratings, the FSRS memory they move and the review dates that follow — or a review
// played « a week later » is recorded as played today and the plan never advances. A session started
// with now_ms therefore runs on an OffsetClock: now_ms plus the time elapsed since it started.
//
// now_ms is checked once, here, for every entry point that accepts it: an integer epoch in ms whose
// date has a four-digit year, so every date Studium prints from it stays well-formed.
import { z } from "zod";
import type { Clock } from "@studium/lesson-session";

/** The last instant whose ISO date has a four-digit year: 9999-12-31T23:59:59.999Z. */
export const NOW_MS_MAX = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

const NOW_MS_RULE = `now_ms must be an integer epoch in milliseconds between 0 and ${NOW_MS_MAX}`;

/** now_ms as every tool accepts it (L-1). */
export const NowMsSchema = z.number({ invalid_type_error: NOW_MS_RULE })
  .int({ message: NOW_MS_RULE }).min(0, { message: NOW_MS_RULE }).max(NOW_MS_MAX, { message: NOW_MS_RULE })
  .describe("epoch ms, for deterministic scheduling: the session started with it stamps its answers, ratings and reviews there; defaults to the server clock");

/** `value` when it is a valid now_ms, else a RangeError saying what is accepted. */
export function checkNowMs(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > NOW_MS_MAX) throw new RangeError(`${NOW_MS_RULE} (got ${value})`);
  return value;
}

const WALL_CLOCK: Clock = { now: () => new Date().toISOString() };

/** A clock that starts at `anchorMs` and advances with `base` (the wall clock by default). */
export class OffsetClock implements Clock {
  private readonly startedAt: number;
  constructor(private readonly anchorMs: number, private readonly base: Clock = WALL_CLOCK) {
    this.startedAt = Date.parse(base.now());
  }
  now(): string {
    const elapsed = Math.max(0, Date.parse(this.base.now()) - this.startedAt);
    return new Date(this.anchorMs + elapsed).toISOString();
  }
}
