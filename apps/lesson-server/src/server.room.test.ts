// apps/lesson-server/src/server.room.test.ts
// D1 PeerStudio: HTTP endpoints for Room lifecycle (open / join / submit / get / close).
import { describe, it, expect } from "vitest";
import { buildServer } from "./server.js";

const app = () => buildServer({ bundlesRoot: ".", live: false });

describe("POST /rooms", () => {
  it("opens a room and returns room_id, join_code, teacher_key", async () => {
    const s = app();
    const res = await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "any-bundle" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.room_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.join_code).toMatch(/^[A-Z0-9]{6}$/);
    expect(body.teacher_key).toMatch(/^[0-9a-f-]{36}$/);
    await s.close();
  });

  it("400 for missing bundle_ref", async () => {
    const s = app();
    const res = await s.inject({ method: "POST", url: "/rooms", payload: {} });
    expect(res.statusCode).toBe(400);
    await s.close();
  });
});

describe("POST /rooms/join", () => {
  it("joins a room and increments session_count", async () => {
    const s = app();
    const open = await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } });
    const { join_code, room_id } = open.json();

    const j = await s.inject({ method: "POST", url: "/rooms/join", payload: { join_code, session_id: "s1" } });
    expect(j.statusCode).toBe(200);
    expect(j.json()).toMatchObject({ success: true, room_id, session_count: 1 });
    await s.close();
  });

  it("400 for unknown join_code", async () => {
    const s = app();
    const res = await s.inject({ method: "POST", url: "/rooms/join", payload: { join_code: "ZZZZZZ", session_id: "s1" } });
    expect(res.statusCode).toBe(400);
    await s.close();
  });
});

describe("POST /rooms/:id/ratings", () => {
  it("accepts a rating and reports suppression", async () => {
    const s = app();
    const { room_id, join_code } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    await s.inject({ method: "POST", url: "/rooms/join", payload: { join_code, session_id: "s1" } });
    await s.inject({ method: "POST", url: "/rooms/join", payload: { join_code, session_id: "s2" } });

    const res = await s.inject({
      method: "POST", url: `/rooms/${room_id}/ratings`,
      payload: { rater_session_id: "s2", target_session_id: "s1", passed: true, rating: 4, helpful: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, k: 1, suppressed: true });
    await s.close();
  });

  it("400 for self-rating", async () => {
    const s = app();
    const { room_id } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    const res = await s.inject({
      method: "POST", url: `/rooms/${room_id}/ratings`,
      payload: { rater_session_id: "s1", target_session_id: "s1", passed: true, rating: 4, helpful: false },
    });
    expect(res.statusCode).toBe(400);
    await s.close();
  });
});

describe("GET /rooms/:id", () => {
  it("returns room state when teacher_key is correct", async () => {
    const s = app();
    const { room_id, teacher_key } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    const res = await s.inject({ method: "GET", url: `/rooms/${room_id}?teacher_key=${teacher_key}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, session_count: 0, rating_count: 0, closed: false, aggregates: [] });
    await s.close();
  });

  it("400 for missing teacher_key", async () => {
    const s = app();
    const { room_id } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    const res = await s.inject({ method: "GET", url: `/rooms/${room_id}` });
    expect(res.statusCode).toBe(400);
    await s.close();
  });

  it("400 for wrong teacher_key", async () => {
    const s = app();
    const { room_id } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    const res = await s.inject({ method: "GET", url: `/rooms/${room_id}?teacher_key=wrong` });
    expect(res.statusCode).toBe(400);
    await s.close();
  });
});

describe("POST /rooms/:id/close", () => {
  it("closes the room and returns the final aggregates", async () => {
    const s = app();
    const { room_id, join_code, teacher_key } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    for (const sid of ["s1", "s2", "s3", "s4"]) {
      await s.inject({ method: "POST", url: "/rooms/join", payload: { join_code, session_id: sid } });
    }
    // 3 ratings for s1 → k_floor reached
    for (const rater of ["s2", "s3", "s4"]) {
      await s.inject({
        method: "POST", url: `/rooms/${room_id}/ratings`,
        payload: { rater_session_id: rater, target_session_id: "s1", passed: true, rating: 5, helpful: true },
      });
    }
    const res = await s.inject({ method: "POST", url: `/rooms/${room_id}/close`, payload: { teacher_key } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.closed).toBe(true);
    expect(body.aggregates).toHaveLength(1);
    expect(body.aggregates[0].passed_rate).toBe(1);
    await s.close();
  });

  it("400 for wrong teacher_key", async () => {
    const s = app();
    const { room_id } = (await s.inject({ method: "POST", url: "/rooms", payload: { bundle_ref: "b" } })).json();
    const res = await s.inject({ method: "POST", url: `/rooms/${room_id}/close`, payload: { teacher_key: "bad" } });
    expect(res.statusCode).toBe(400);
    await s.close();
  });
});
