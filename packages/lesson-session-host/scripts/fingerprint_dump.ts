// fingerprint_dump.ts — print, for each scene of a lesson JSON file, the canonical JSON and the
// fingerprint review-inbox.ts computes, for the TS/Python parity gate
// (tools/test_review_receipt_parity.py): [{ "canonical": "...", "sha256": "..." }, ...]
//   Run: tsx packages/lesson-session-host/scripts/fingerprint_dump.ts path/to/lesson.json
import { readFileSync } from "node:fs";
import { canonicalJson, sceneFingerprint } from "../src/review-inbox.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: fingerprint_dump.ts LESSON_JSON");
  process.exit(2);
}
const lesson = JSON.parse(readFileSync(path, "utf8")) as { scenes?: unknown };
const scenes = Array.isArray(lesson.scenes) ? lesson.scenes : [];
process.stdout.write(JSON.stringify(scenes.map((scene) => ({ canonical: canonicalJson(scene), sha256: sceneFingerprint(scene) }))));
