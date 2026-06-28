// course-resolver.ts — load + validate a course manifest (course.json) from the bundles root, so a host
// can route a multi-lesson course. Mirrors bundle-resolver.ts but for the lesson-level course spine.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CourseSchema, type Course } from "@studium/lesson-bundle-schema";

export async function resolveCourse(bundlesRoot: string, courseRef: string): Promise<Course> {
  return CourseSchema.parse(JSON.parse(await readFile(join(bundlesRoot, courseRef), "utf8")));
}
