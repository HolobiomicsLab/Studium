// apps/lesson-server/src/server.course.test.ts
// GET /courses?ref= — serve a parsed course manifest (lesson DAG) for the teacher
// dashboard's course-progress overlay. Path-traversal guarded.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildServer } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// fixtures/ live at the repo root: apps/lesson-server/src -> ../../../fixtures
const FIXTURES = resolve(HERE, "../../../fixtures");
const app = () => buildServer({ bundlesRoot: FIXTURES, live: false });

describe("GET /courses", () => {
  it("returns the parsed course manifest with ordered lessons + prerequisites", async () => {
    const s = app();
    const res = await s.inject({ method: "GET", url: "/courses?ref=courses/decay-course.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.course.course_id).toBe("decay-course");
    expect(body.course.lessons.map((l: { lesson_id: string }) => l.lesson_id)).toEqual([
      "capsule-run-demo",
      "capsule-loop-demo",
    ]);
    expect(body.course.lessons[1].prerequisite_lesson_ids).toEqual(["capsule-run-demo"]);
    await s.close();
  });

  it("400 when ref is missing", async () => {
    const s = app();
    const res = await s.inject({ method: "GET", url: "/courses" });
    expect(res.statusCode).toBe(400);
    await s.close();
  });

  it("400 on path traversal (..)", async () => {
    const s = app();
    const res = await s.inject({ method: "GET", url: "/courses?ref=../../etc/passwd" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid ref/);
    await s.close();
  });

  it("404 when the manifest does not exist", async () => {
    const s = app();
    const res = await s.inject({ method: "GET", url: "/courses?ref=courses/nope.json" });
    expect(res.statusCode).toBe(404);
    await s.close();
  });
});
