// packages/lesson-session-host/src/host.room.test.ts
// D1 PeerStudio — Room lifecycle, k-suppression, teacher-key gate.
// The Room is a pure coordination layer; no real LessonSession objects are needed.
import { describe, it, expect } from "vitest";
import { SessionHost, PeerRoomError } from "./host.js";
import { aggregateRatings, ROOM_K_FLOOR } from "./room.js";

const HOST_OPTS = { bundlesRoot: "/nonexistent", live: false };

// ---------------------------------------------------------------------------
// Pure aggregation helpers (no host needed)
// ---------------------------------------------------------------------------
describe("aggregateRatings", () => {
  const rating = (target: string, rater: string, passed: boolean, r = 4) => ({
    rater_session_id: rater, target_session_id: target, passed, rating: r, helpful: true, ts: 0,
  });

  it("suppresses targets below k_floor", () => {
    const ratings = [rating("t1", "r1", true), rating("t1", "r2", true)]; // 2 < 3
    expect(aggregateRatings(ratings, ROOM_K_FLOOR)).toHaveLength(0);
  });

  it("reveals aggregate once k_floor is reached", () => {
    const ratings = [
      rating("t1", "r1", true, 5),
      rating("t1", "r2", true, 3),
      rating("t1", "r3", false, 4),
    ];
    const agg = aggregateRatings(ratings);
    expect(agg).toHaveLength(1);
    const a = agg[0]!;
    expect(a.k).toBe(3);
    expect(a.passed_rate).toBeCloseTo(2 / 3);
    expect(a.avg_rating).toBeCloseTo((5 + 3 + 4) / 3);
    expect(a.avg_helpful).toBe(1); // all helpful
  });

  it("counts distinct raters, not ratings — one rater cannot lift a target over the floor", () => {
    // INT-STUDIUM-030, found auditing the floors. The type's own comments promise "k_floor
    // INDEPENDENT raters", and the code counted rows. Nothing stops a learner rating the same
    // target three times, and the aggregate that then unlocks is that one learner's three
    // opinions averaged — presented to the teacher as a k=3 peer consensus. This is the same
    // defect INT-STUDIUM-019 fixed on the collector side, where the floor counted telemetry
    // files instead of learners.
    const solo = [
      rating("t1", "r1", true, 5),
      rating("t1", "r1", true, 5),
      rating("t1", "r1", true, 5),
    ];
    expect(aggregateRatings(solo, ROOM_K_FLOOR)).toHaveLength(0);

    // A repeat rating neither inflates k nor double-weights its author: one rater is one
    // opinion, their latest. Averaging over rows would let a rater move a peer aggregate by
    // rating twice, which is the same failure wearing an average instead of a count.
    const mixed = [
      rating("t1", "r1", true, 5), rating("t1", "r1", false, 1), // r1 changed their mind
      rating("t1", "r2", true, 3), rating("t1", "r3", true, 4),
    ];
    const agg = aggregateRatings(mixed, ROOM_K_FLOOR);
    expect(agg).toHaveLength(1);
    expect(agg[0]!.k).toBe(3); // three people, four ratings
    expect(agg[0]!.passed_rate).toBeCloseTo(2 / 3);
    expect(agg[0]!.avg_rating).toBeCloseTo((1 + 3 + 4) / 3);
  });

  it("independently suppresses each target", () => {
    const ratings = [
      rating("t1", "r1", true), rating("t1", "r2", true), // 2 — suppressed
      rating("t2", "r1", true), rating("t2", "r2", true), rating("t2", "r3", true), // 3 — revealed
    ];
    const agg = aggregateRatings(ratings);
    expect(agg).toHaveLength(1);
    expect(agg[0]!.target_session_id).toBe("t2");
  });

  it("respects custom kFloor", () => {
    const ratings = [rating("t1", "r1", true), rating("t1", "r2", true)];
    expect(aggregateRatings(ratings, 2)).toHaveLength(1);
    expect(aggregateRatings(ratings, 3)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Room lifecycle via SessionHost
// ---------------------------------------------------------------------------
describe("SessionHost — PeerStudio room lifecycle", () => {
  it("openRoom returns room_id, join_code, teacher_key", () => {
    const host = new SessionHost(HOST_OPTS);
    const r = host.openRoom("atomistique-l1/lesson.json");
    expect(r.room_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.join_code).toMatch(/^[A-Z0-9]{6}$/);
    expect(r.teacher_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("joinRoom registers a session and returns session_count", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, join_code } = host.openRoom("b");
    const j1 = host.joinRoom(join_code, "s1");
    expect(j1.room_id).toBe(room_id);
    expect(j1.session_count).toBe(1);
    const j2 = host.joinRoom(join_code, "s2");
    expect(j2.session_count).toBe(2);
  });

  it("joinRoom is case-insensitive for join_code", () => {
    const host = new SessionHost(HOST_OPTS);
    const { join_code } = host.openRoom("b");
    expect(() => host.joinRoom(join_code.toLowerCase(), "s1")).not.toThrow();
  });

  it("joinRoom rejects unknown join_code", () => {
    const host = new SessionHost(HOST_OPTS);
    expect(() => host.joinRoom("ZZZZZZ", "s1")).toThrow(PeerRoomError);
  });

  it("submitRoomRating accumulates ratings and reports suppression", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, join_code } = host.openRoom("b");
    host.joinRoom(join_code, "s1");
    host.joinRoom(join_code, "s2");
    host.joinRoom(join_code, "s3");
    host.joinRoom(join_code, "s4");

    const r1 = host.submitRoomRating(room_id, "s2", "s1", { passed: true, rating: 5, helpful: true });
    expect(r1.k).toBe(1); expect(r1.suppressed).toBe(true);
    const r2 = host.submitRoomRating(room_id, "s3", "s1", { passed: true, rating: 4, helpful: false });
    expect(r2.k).toBe(2); expect(r2.suppressed).toBe(true);
    const r3 = host.submitRoomRating(room_id, "s4", "s1", { passed: false, rating: 3, helpful: true });
    expect(r3.k).toBe(3); expect(r3.suppressed).toBe(false);
  });

  it("submitRoomRating rejects self-rating", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, join_code } = host.openRoom("b");
    host.joinRoom(join_code, "s1");
    expect(() => host.submitRoomRating(room_id, "s1", "s1", { passed: true, rating: 4, helpful: true }))
      .toThrow(PeerRoomError);
  });

  it("submitRoomRating rejects out-of-range rating", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, join_code } = host.openRoom("b");
    host.joinRoom(join_code, "s1");
    expect(() => host.submitRoomRating(room_id, "s2", "s1", { passed: true, rating: 0, helpful: true }))
      .toThrow(PeerRoomError);
    expect(() => host.submitRoomRating(room_id, "s2", "s1", { passed: true, rating: 6, helpful: true }))
      .toThrow(PeerRoomError);
  });

  it("getRoomState is gated by teacher_key and returns k-suppressed aggregates", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, join_code, teacher_key } = host.openRoom("b");
    host.joinRoom(join_code, "s1");
    host.joinRoom(join_code, "s2");

    // No aggregates yet (no ratings)
    const state = host.getRoomState(room_id, teacher_key);
    expect(state.session_count).toBe(2);
    expect(state.rating_count).toBe(0);
    expect(state.aggregates).toHaveLength(0);
    expect(state.closed).toBe(false);

    // Wrong key → error
    expect(() => host.getRoomState(room_id, "wrong")).toThrow(PeerRoomError);
  });

  it("closeRoom marks room closed, join_code no longer valid, returns final aggregates", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, join_code, teacher_key } = host.openRoom("b");
    host.joinRoom(join_code, "s1");
    host.joinRoom(join_code, "s2");
    host.joinRoom(join_code, "s3");
    host.joinRoom(join_code, "s4");
    // 3 ratings for s1 → should appear in aggregates
    host.submitRoomRating(room_id, "s2", "s1", { passed: true, rating: 5, helpful: true });
    host.submitRoomRating(room_id, "s3", "s1", { passed: true, rating: 4, helpful: true });
    host.submitRoomRating(room_id, "s4", "s1", { passed: true, rating: 5, helpful: false });

    const summary = host.closeRoom(room_id, teacher_key);
    expect(summary.closed).toBe(true);
    expect(summary.aggregates).toHaveLength(1);
    expect(summary.aggregates[0]!.passed_rate).toBe(1);
    expect(summary.aggregates[0]!.avg_helpful).toBeCloseTo(2 / 3);

    // join_code no longer accepted
    expect(() => host.joinRoom(join_code, "s5")).toThrow(PeerRoomError);
    // No further ratings
    expect(() => host.submitRoomRating(room_id, "s2", "s3", { passed: true, rating: 3, helpful: false }))
      .toThrow(PeerRoomError);
  });

  it("closeRoom rejects wrong teacher_key", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id } = host.openRoom("b");
    expect(() => host.closeRoom(room_id, "bad-key")).toThrow(PeerRoomError);
  });

  it("no-fabrication: a room with 0 ratings emits 0 aggregates on close", () => {
    const host = new SessionHost(HOST_OPTS);
    const { room_id, teacher_key } = host.openRoom("b");
    const summary = host.closeRoom(room_id, teacher_key);
    expect(summary.aggregates).toHaveLength(0);
    expect(summary.rating_count).toBe(0);
  });
});
