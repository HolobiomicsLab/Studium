// lesson-uri.driver.ts — C7: vscode://<publisher>.studium-vscode/open?bundle=<path of lesson.json>, and
// the same resolution for "Open this lesson" on a file. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-uri.driver.ts
import { parseOpenLessonQuery, lessonLocation, rawQuery, type OpenLessonResult } from "./lesson-uri.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const exists = (p: string) => ["/lib/photo/lesson.json", "/lib/flat.json", "/lib/photo/notes.txt"].includes(p);
const ok = (r: OpenLessonResult) => (r.ok ? r : null);
const err = (r: OpenLessonResult) => (r.ok ? null : r.error);

// lessonLocation: <root>/<course>/lesson.json → root + "<course>/lesson.json"; a bare root-level json → root + name.
{
  const a = lessonLocation("/lib/photo/lesson.json");
  expect(a.bundlesRoot === "/lib" && a.bundleRef === "photo/lesson.json", "a course folder's lesson.json is resolved against its parent");
  const b = lessonLocation("/lib/flat.json");
  expect(b.bundlesRoot === "/lib" && b.bundleRef === "flat.json", "a bare root-level json is resolved against its folder");
}

// parseOpenLessonQuery
{
  const good = ok(parseOpenLessonQuery("bundle=%2Flib%2Fphoto%2Flesson.json", exists));
  expect(!!good && good.bundlesRoot === "/lib" && good.bundleRef === "photo/lesson.json", "a percent-encoded absolute path opens that lesson");
  expect(!!ok(parseOpenLessonQuery("bundle=/lib/photo/lesson.json&x=1", exists)), "extra parameters are ignored");
  expect(err(parseOpenLessonQuery("", exists))?.key === "uri_missing_bundle", "no bundle parameter → missing");
  expect(err(parseOpenLessonQuery("bundle=", exists))?.key === "uri_missing_bundle", "an empty bundle parameter → missing");
  expect(err(parseOpenLessonQuery("bundle=photo/lesson.json", exists))?.key === "uri_not_absolute", "a relative path is refused");
  expect(err(parseOpenLessonQuery("bundle=%2Flib%2Fphoto%2F..%2F..%2Fetc%2Flesson.json", exists))?.key === "uri_not_absolute", "a path with .. segments is refused");
  expect(err(parseOpenLessonQuery("bundle=%2Flib%2Fphoto%2Fnotes.txt", exists))?.key === "uri_not_lesson", "a non-json file is refused");
  expect(err(parseOpenLessonQuery("bundle=%2Flib%2Fgone%2Flesson.json", exists))?.key === "uri_not_found", "a missing file is reported");
  expect(err(parseOpenLessonQuery("bundle=%E0%A4%A", exists)) !== null, "a malformed escape is refused, never thrown");
  expect(err(parseOpenLessonQuery("bundle=%2Flib%2Fphoto%2Flesson.json%00", exists))?.key === "uri_not_lesson", "a NUL byte in the path is refused");
}

// rawQuery: the still-encoded query of a URI string, so a path holding & or + survives the round trip.
{
  expect(rawQuery("vscode://holobiomicslab.studium-vscode/open?bundle=%2Flib%2Fa%26b%2Flesson.json") === "bundle=%2Flib%2Fa%26b%2Flesson.json", "the encoded query is returned as is");
  expect(rawQuery("vscode://x/open?bundle=%2Fa%23b.json#frag") === "bundle=%2Fa%23b.json", "a fragment is cut off");
  expect(rawQuery("vscode://x/open") === "", "no query → empty string");
  const r = ok(parseOpenLessonQuery(rawQuery("vscode://x/open?bundle=%2Flib%2Fphoto%2Flesson.json"), exists));
  expect(!!r && r.bundleRef === "photo/lesson.json", "rawQuery output feeds parseOpenLessonQuery");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-uri assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — lesson-uri (URI handler + open-this-lesson resolution) passed all ${checks} assertions.`);
