// lesson-picker.driver.ts — pure course discovery plus the thin node:fs adapter. No VS Code host.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-picker.driver.ts [bundles-root]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCourses, discoverCoursesInRoot, needsLessonPicker, toLessonPickerChoices } from "./lesson-picker.js";

const failures: string[] = [];
let checks = 0;
function expect(condition: boolean, message: string) { checks++; if (!condition) failures.push(message); }

const bundle = (title: string, target: string, language: string, validatedBy: string) => JSON.stringify({
  metadata: { title, target, language },
  validated_by: validatedBy,
});

// Pure discovery accepts root JSON and course/lesson.json, rejects unrelated/deep/ignored paths, and sorts refs.
{
  const courses = discoverCourses([
    { ref: "zeta/lesson.json", contents: bundle("Zeta", "M1", "en", "Teacher Z") },
    { ref: "wave-scenes.json", contents: bundle("Wave scenes", "L1", "fr", "Teacher W") },
    { ref: "courses/not-a-lesson.json", contents: bundle("Wrong shape", "L2", "fr", "Teacher X") },
    { ref: "node_modules/hidden/lesson.json", contents: bundle("Hidden", "L3", "en", "Teacher H") },
    { ref: "broken.json", contents: "not json" },
  ]);
  expect(courses.map((course) => course.ref).join(",") === "wave-scenes.json,zeta/lesson.json", "pure discovery keeps supported refs in deterministic order");
  expect(courses[0]?.title === "Wave scenes" && courses[0]?.validatedBy === "Teacher W", "pure discovery reads course metadata and validation");
  const picks = toLessonPickerChoices(courses, "/courses");
  expect(picks[0]?.description === "L1 · fr" && picks[0]?.detail?.includes("Teacher W"), "picker items expose target, language, ref, and validation");
  expect(picks.at(-1)?.action === "folder" && picks.at(-1)?.detail === "/courses", "picker always offers another bundles-root folder");
}

// First-run/missing-ref routing is pure: absent and missing refs pick; an existing configured ref opens.
{
  const exists = (ref: string) => ref === "alpha/lesson.json";
  expect(needsLessonPicker(undefined, exists), "first run without bundleRef opens the picker");
  expect(needsLessonPicker("missing/lesson.json", exists), "a missing configured bundleRef opens the picker");
  expect(!needsLessonPicker("alpha/lesson.json", exists), "an existing configured bundleRef opens directly");
}

// Filesystem adapter: two fake courses are found; ignored and over-depth trees are not traversed.
const root = mkdtempSync(join(tmpdir(), "studium-lesson-picker-"));
try {
  for (const dir of ["alpha", "beta", "node_modules/ignored", "dist/ignored", ".git/ignored", "one/two/three"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, "alpha", "lesson.json"), bundle("Alpha", "L1", "fr", "Teacher A"));
  writeFileSync(join(root, "beta", "lesson.json"), bundle("Beta", "L2", "en", "Teacher B"));
  writeFileSync(join(root, "node_modules", "ignored", "lesson.json"), bundle("Ignored node_modules", "L3", "en", "Nobody"));
  writeFileSync(join(root, "dist", "ignored", "lesson.json"), bundle("Ignored dist", "L3", "en", "Nobody"));
  writeFileSync(join(root, ".git", "ignored", "lesson.json"), bundle("Ignored git", "L3", "en", "Nobody"));
  writeFileSync(join(root, "one", "two", "three", "lesson.json"), bundle("Too deep", "L3", "en", "Nobody"));
  const courses = discoverCoursesInRoot(root);
  expect(courses.map((course) => course.ref).join(",") === "alpha/lesson.json,beta/lesson.json", "filesystem adapter discovers exactly the two fake courses");
} finally {
  rmSync(root, { recursive: true, force: true });
}

const requestedRoot = process.argv[2];
if (requestedRoot) {
  const courses = discoverCoursesInRoot(requestedRoot);
  console.log(`DISCOVERED ${courses.length} courses in ${requestedRoot}`);
  for (const course of courses) console.log(`${course.ref}\t${course.title}\t${course.target} · ${course.language}\tvalidated_by=${course.validatedBy}`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-picker assertions failed:`);
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log(`OK — lesson-picker (course discovery) passed all ${checks} assertions.`);
