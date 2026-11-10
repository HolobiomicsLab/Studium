// lesson-picker.driver.ts — pure course discovery plus the thin node:fs adapter. No VS Code host.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-picker.driver.ts [bundles-root]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalLabel, discoverCourses, discoverCoursesInRoot, needsLessonPicker, toLessonPickerChoices } from "./lesson-picker.js";

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
  expect(courses[0]?.title === "Wave scenes" && courses[0]?.approval.state === "none", "pure discovery reads course metadata; a validated_by text alone gives no approval");
  const picks = toLessonPickerChoices(courses, "/courses");
  expect(picks[0]?.description === "L1 · fr" && picks[0]?.detail === "wave-scenes.json · aucune approbation enregistrée", "picker items expose target, language, ref, and the approval state (not validated_by)");
  expect(picks.at(-1)?.action === "folder" && picks.at(-1)?.detail === "/courses", "picker always offers another bundles-root folder");
}

// Approval state comes from approval.json bound to the bytes of the lesson; validated_by text never shows.
{
  const lesson = bundle("Signed", "L1", "fr", "Teacher Z");
  const sha = createHash("sha256").update(lesson, "utf8").digest("hex");
  const rec = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: "studium-approval/1", bundle_sha256: sha, reviewer: "Dr Roux", ...over });
  const detailOf = (approvalText: string | undefined, locale: "fr" | "en" = "fr") => {
    const c = discoverCourses([{ ref: "s/lesson.json", contents: lesson, ...(approvalText === undefined ? {} : { approvalText }) }]);
    const d = toLessonPickerChoices(c, "/r", locale)[0]!.detail;
    return { state: c[0]?.approval.state, detail: d };
  };
  const m = detailOf(rec());
  expect(m.state === "approved" && m.detail === "s/lesson.json · validée par Dr Roux", "a matching record names the reviewer from the record (fr)");
  expect(detailOf(rec(), "en").detail === "s/lesson.json · validated by Dr Roux", "a matching record names the reviewer (en)");
  expect(detailOf(rec({ bundle_sha256: "0".repeat(64) })).detail === "s/lesson.json · modifiée depuis sa validation", "a stale record reads changed since approval (fr)");
  expect(detailOf(rec({ bundle_sha256: "0".repeat(64) }), "en").detail === "s/lesson.json · changed since its approval", "a stale record reads changed (en)");
  expect(detailOf(undefined).detail === "s/lesson.json · aucune approbation enregistrée", "no record reads no approval recorded (fr)");
  expect(detailOf(undefined, "en").detail === "s/lesson.json · no approval recorded", "no record reads no approval recorded (en)");
  for (const [name, text] of [
    ["unparsable", "{nope"], ["array", "[]"], ["other schema", rec({ schema: "x/1" })], ["numeric digest", rec({ bundle_sha256: 7 })],
    ["empty reviewer", rec({ reviewer: "  " })], ["numeric reviewer", rec({ reviewer: 3 })], ["over 64 KiB", rec({ pad: "x".repeat(70000) })],
  ] as const) {
    expect(detailOf(text).state === "none", `a malformed record (${name}) reads as no record`);
  }
  expect(!detailOf(undefined).detail.includes("Teacher Z"), "a validated_by text alone never shows in the picker");
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
  const alphaText = bundle("Alpha", "L1", "fr", "Teacher A");
  writeFileSync(join(root, "alpha", "approval.json"), JSON.stringify({ schema: "studium-approval/1", bundle_sha256: createHash("sha256").update(alphaText).digest("hex"), reviewer: "Prof. Alpha" }));
  writeFileSync(join(root, "beta", "approval.json"), JSON.stringify({ schema: "studium-approval/1", bundle_sha256: "0".repeat(64), reviewer: "Prof. Beta" }));
  const courses = discoverCoursesInRoot(root);
  expect(courses[0]?.approval.state === "approved" && courses[1]?.approval.state === "changed", "the filesystem adapter hashes the file bytes and reads the sibling approval.json");
  expect(courses.map((course) => course.ref).join(",") === "alpha/lesson.json,beta/lesson.json", "filesystem adapter discovers exactly the two fake courses");
} finally {
  rmSync(root, { recursive: true, force: true });
}

const requestedRoot = process.argv[2];
if (requestedRoot) {
  const courses = discoverCoursesInRoot(requestedRoot);
  console.log(`DISCOVERED ${courses.length} courses in ${requestedRoot}`);
  for (const course of courses) console.log(`${course.ref}\t${course.title}\t${course.target} · ${course.language}\t${approvalLabel(course.approval, "en")}`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-picker assertions failed:`);
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log(`OK — lesson-picker (course discovery) passed all ${checks} assertions.`);
