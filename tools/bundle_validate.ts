import { readFileSync } from "node:fs";
import { LessonBundleSchema } from "../packages/lesson-bundle-schema/src/index";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: bundle_validate.ts LESSON_JSON [...]");
  process.exit(2);
}

let failures = 0;
for (const path of paths) {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    const result = LessonBundleSchema.safeParse(value);
    if (result.success) {
      console.log(`OK ${path}: ${result.data.scenes.length} scenes`);
      continue;
    }
    failures += 1;
    console.error(`FAIL ${path}: ${JSON.stringify(result.error.issues)}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${path}: ${String(error)}`);
  }
}

process.exit(failures === 0 ? 0 : 1);
