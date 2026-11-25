// lesson-uri.driver.ts — C7: vscode://<publisher>.studium-vscode/open?bundle=<path of lesson.json>, and
// the same resolution for "Open this lesson" on a file. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/lesson-uri.driver.ts
import { dirname, join } from "node:path";
import { bundleOfQuery, checkLessonPath, parseOpenLessonLink, parseOpenLessonQuery, lessonLocation, rawQuery, type OpenLessonResult } from "./lesson-uri.js";
import { vscodeHandsOver } from "./vscode-uri-fixture.js";

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

// D2 (owner decision 1): the link the Copilot server gives (lesson-session-host open-link.ts: the prefix, then the
// lesson file's absolute path percent-encoded once) reaches the handler the way VS Code hands it over: uri.query decoded
// once, uri.toString() encoded again with "=" as %3D, so that "bundle=" is gone from it. parseOpenLessonLink reads the
// decoded query: a path with spaces, & + # % = ?, accents, quotes or a Windows drive opens as it is.
{
  const PREFIX = "vscode://holobiomicslab.studium-vscode/open?bundle=";
  const handed = vscodeHandsOver(PREFIX + encodeURIComponent("/lib/photo/lesson.json"));
  expect(handed.toString().includes("bundle%3D") && handed.query === "bundle=/lib/photo/lesson.json",
    `the fixture hands over what VS Code does (got ${handed.toString()} and ${handed.query})`);
  for (const path of ["/Users/zoë/Mes cours/a&b+c#d%e=f?g/lesson.json", "/lib/100% sûr/l'été (2)/lesson.json", "/lib/photo/lesson.json"]) {
    // Changed: the handler now takes the folders a link may open a lesson from (review finding 7); each lesson here sits
    // in a course folder of such a folder, as in the library.
    const result = parseOpenLessonLink(vscodeHandsOver(PREFIX + encodeURIComponent(path)).query, (p) => p === path, [dirname(dirname(path))]);
    const opened = ok(result);
    expect(!!opened && join(opened.bundlesRoot, opened.bundleRef) === path, `${path} opens from the link VS Code hands over (got ${JSON.stringify(result)})`);
  }
  const windows = "C:\\Users\\Zoë\\a&b c\\lesson.json";
  expect(bundleOfQuery(vscodeHandsOver(PREFIX + encodeURIComponent(windows)).query) === windows, "a Windows path comes through as it is");
  expect(bundleOfQuery("bundle=/lib/photo/lesson.json&x=1") === "/lib/photo/lesson.json", "a parameter after the path is not part of it");
  expect(bundleOfQuery("bundle=/lib/a&b/lesson.json&x=1") === "/lib/a&b/lesson.json", "nor when the path holds an &");
  expect(bundleOfQuery("x=1&bundle=/lib/photo/lesson.json") === "/lib/photo/lesson.json", "bundle may follow another parameter");
  expect(bundleOfQuery("bundles=/lib/photo/lesson.json") === null, "another parameter is not bundle");
  // Changed: the handler takes the folders a link may open a lesson from (review finding 7): here /lib.
  const ROOTS = ["/lib"];
  expect(err(parseOpenLessonLink("", exists, ROOTS))?.key === "uri_missing_bundle", "a link without a query → missing");
  expect(err(parseOpenLessonLink("bundle=", exists, ROOTS))?.key === "uri_missing_bundle", "an empty bundle → missing");
  expect(err(parseOpenLessonLink("bundle=photo/lesson.json", exists, ROOTS))?.key === "uri_not_absolute", "a relative path is refused");
  expect(err(parseOpenLessonLink("bundle=/lib/photo/../../etc/lesson.json", exists, ROOTS))?.key === "uri_not_absolute", "a path with .. is refused");
  expect(err(parseOpenLessonLink("bundle=/lib/photo/notes.txt", exists, ROOTS))?.key === "uri_not_lesson", "a file that is not .json is refused");
  expect(err(parseOpenLessonLink("bundle=/lib/gone/lesson.json", exists, ROOTS))?.key === "uri_not_found", "a missing file is reported");
}

// Review of the waiting branch, finding 7: a link opened any existing absolute .json on the disk. It now opens a lesson
// only from the folders given — the extension passes the library (<STUDIUM_HOME>/library), studium.bundlesRoot and the
// lessons shipped with Studium — and refuses any other file before looking whether it exists. "Open this lesson" on a
// file the learner picked (checkLessonPath without folders) is not limited.
{
  const anywhere = () => true;
  const ROOTS = ["/home/zoe/.studium/library", "/work/lessons", "/ext/dist/shipped-lessons"];
  const link = (path: string) => `bundle=${path}`;
  const opened = ok(parseOpenLessonLink(link("/work/lessons/photo/lesson.json"), anywhere, ROOTS));
  expect(!!opened && opened.bundlesRoot === "/work/lessons" && opened.bundleRef === "photo/lesson.json", "a lesson of studium.bundlesRoot opens");
  expect(!!ok(parseOpenLessonLink(link("/home/zoe/.studium/library/atomes/lesson.json"), anywhere, ROOTS)), "a lesson of the library opens");
  expect(!!ok(parseOpenLessonLink(link("/ext/dist/shipped-lessons/discover-studium-en/lesson.json"), anywhere, ROOTS)), "a shipped lesson opens");
  expect(!!ok(parseOpenLessonLink(link("/work/lessons/flat.json"), anywhere, ROOTS)), "a lesson file directly in such a folder opens");
  for (const outside of ["/Users/x/Downloads/evil/lesson.json", "/work/lessons-evil/a/lesson.json", "/home/zoe/.studium/data/x.json", "/work/x.json"]) {
    expect(err(parseOpenLessonLink(link(outside), anywhere, ROOTS))?.key === "uri_outside_lessons", `${outside} is refused: outside the lesson folders`);
  }
  expect(err(parseOpenLessonLink(link("/Users/x/Downloads/gone/lesson.json"), () => false, ROOTS))?.key === "uri_outside_lessons",
    "a file outside them is refused without saying whether it exists");
  expect(err(parseOpenLessonLink(link("/work/lessons/photo/lesson.json"), anywhere, []))?.key === "uri_outside_lessons", "no folder: nothing opens");
  expect(!!ok(checkLessonPath("/Users/x/Downloads/mine/lesson.json", anywhere)), "Open this lesson on a picked file is not limited");
}

// Review of the waiting branch, finding 6: the server's link encodes ! ' ( ) * too (lesson-session-host open-link.ts),
// so that a ")" in a path cannot end the Markdown link; VS Code decodes those escapes once, like any other.
{
  const PREFIX = "vscode://holobiomicslab.studium-vscode/open?bundle=";
  const strict = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  for (const path of ["/Users/x/smile :)/lesson.json", "/tmp/quote'(paren)*!/lesson.json"]) {
    expect(bundleOfQuery(vscodeHandsOver(PREFIX + strict(path)).query) === path, `${path}: a link with ( ) ' ! * encoded comes through as it is`);
  }
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} lesson-uri assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — lesson-uri (URI handler + open-this-lesson resolution) passed all ${checks} assertions.`);
