// library-watch.driver.ts — BN-1 / BN-4: what the extension does when an assistant's server writes into the
// learner's library (<STUDIUM_HOME>/library). A lesson written there refreshes the Lessons view and announces itself
// once ("Your lesson … is ready", Open / Later / Don't show again); a source set written by prepare_sources shows
// "preparing a lesson" until the lesson that cites it lands, or for 20 minutes at most. The facts are read from copies
// of files a real 0.6.4 server wrote (src/fixtures/library), so the field names cannot drift from the server's.
// No VS Code APIs; the clock and the timers are injected.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/library-watch.driver.ts
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEBOUNCE_MS, LibraryWatch, OWN_MS, PREPARING_MAX_MS, readLessonFacts, readSourceSetFacts, type LibraryWatchAction,
} from "./library-watch.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "library");
const SS_ID = "ss-5c83b10d26d8c7bf";
const TITLE = "La photosynthèse : des photons aux glucides";
const SOURCE_TITLE = "La photosynthèse : notes de cours (L1)";

/** A watch over a fresh temporary library, with a manual clock and timers, recording what it asks the host to do. */
function harness(opts: { focused?: boolean; muted?: boolean; shown?: Set<string>; library?: string } = {}) {
  const library = opts.library ?? mkdtempSync(join(tmpdir(), "studium-libwatch-"));
  let clock = 1_000_000;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const actions: LibraryWatchAction[] = [];
  const state = { focused: opts.focused ?? true, muted: opts.muted ?? false };
  const shown = opts.shown ?? new Set<string>();
  const watch = new LibraryWatch({
    library,
    readLesson: readLessonFacts,
    readSourceSet: readSourceSetFacts,
    now: () => clock,
    setTimer: (fn, ms) => { const id = nextTimer++; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    focused: () => state.focused,
    muted: () => state.muted,
    shown: { has: (key) => shown.has(key), add: (key) => { shown.add(key); } },
    act: (action) => { actions.push(action); },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= clock).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      due[1].fn();
    }
  };
  /** Copy the real lesson into <library>/<course>/lesson.json, optionally changed; returns its path. */
  const writeLesson = (course = "photosynthese", change?: (lesson: Record<string, any>) => void) => {
    const path = join(library, course, "lesson.json");
    mkdirSync(join(library, course), { recursive: true });
    if (!change) { copyFileSync(join(fixtures, "photosynthese", "lesson.json"), path); return path; }
    const lesson = JSON.parse(readFileSync(join(fixtures, "photosynthese", "lesson.json"), "utf8"));
    change(lesson);
    writeFileSync(path, JSON.stringify(lesson));
    return path;
  };
  const writeSources = (id = SS_ID) => {
    const path = join(library, "_sources", `${id}.json`);
    mkdirSync(join(library, "_sources"), { recursive: true });
    copyFileSync(join(fixtures, "_sources", `${SS_ID}.json`), path);
    return path;
  };
  const kinds = () => actions.map((a) => a.kind).join(",");
  const notices = () => actions.filter((a): a is Extract<LibraryWatchAction, { kind: "notify" }> => a.kind === "notify");
  return { library, watch, actions, state, shown, advance, writeLesson, writeSources, kinds, notices };
}

// The facts come from the fields a real server writes: metadata.title, the scenes, the TOP-LEVEL source_plan_id.
{
  const facts = readLessonFacts(join(fixtures, "photosynthese", "lesson.json"));
  expect(facts?.title === TITLE, `the lesson title is metadata.title (got ${facts?.title})`);
  expect(facts?.steps === 9, `the step count is the number of scenes (got ${facts?.steps})`);
  expect(facts?.sourcePlanId === SS_ID, `the source set is the top-level source_plan_id (got ${facts?.sourcePlanId})`);
  expect(typeof facts?.version === "string" && facts.version.length > 0, "a version tells two writes of the same lesson apart");
  const sources = readSourceSetFacts(join(fixtures, "_sources", `${SS_ID}.json`));
  expect(sources?.id === SS_ID && sources.title === SOURCE_TITLE, `a source set gives its id and its first source's title (got ${JSON.stringify(sources)})`);
  const scratch = mkdtempSync(join(tmpdir(), "studium-libwatch-bad-"));
  writeFileSync(join(scratch, "bad.json"), "{ not json");
  writeFileSync(join(scratch, "empty.json"), "{}");
  expect(readLessonFacts(join(scratch, "bad.json")) === null, "a malformed lesson gives no facts, without throwing");
  expect(readLessonFacts(join(scratch, "missing.json")) === null, "a missing lesson gives no facts, without throwing");
  expect(readSourceSetFacts(join(scratch, "bad.json")) === null, "a malformed source set gives no facts, without throwing");
  expect(readSourceSetFacts(join(scratch, "empty.json")) === null, "a source set without an id gives no facts");
}

// BN-1: a lesson written into the library refreshes the view, then announces itself once, after the burst settles.
{
  const h = harness();
  const path = h.writeLesson();
  h.watch.lessonEvent(path);
  expect(h.actions.length === 0, `nothing happens before the ${DEBOUNCE_MS} ms debounce (got ${h.kinds()})`);
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "refresh,notify", `then the list refreshes and the lesson is announced (got ${h.kinds()})`);
  const notice = h.notices()[0];
  expect(notice?.title === TITLE && notice.steps === 9 && notice.ref === "photosynthese/lesson.json" && notice.path === path,
    `the notice names the lesson, its steps and its ref (got ${JSON.stringify(notice)})`);
}
{
  const h = harness();
  const path = h.writeLesson();
  h.watch.lessonEvent(path);
  h.advance(200);
  h.watch.lessonEvent(path);
  h.advance(200);
  h.watch.lessonEvent(path);
  h.advance(DEBOUNCE_MS);
  expect(h.notices().length === 1 && h.actions.filter((a) => a.kind === "refresh").length === 1,
    `three events within the debounce give one refresh and one notice (got ${h.kinds()})`);
}

// Only <library>/<course>/lesson.json counts: other paths are ignored.
{
  const h = harness();
  h.watch.lessonEvent(join(h.library, "a", "b", "lesson.json"));
  h.watch.lessonEvent(join(h.library, "lesson.json"));
  h.watch.lessonEvent(join(tmpdir(), "elsewhere", "lesson.json"));
  h.watch.lessonEvent(join(h.library, "photosynthese", "notes.json"));
  h.advance(DEBOUNCE_MS);
  expect(h.actions.length === 0, `paths outside <library>/<course>/lesson.json are ignored (got ${h.kinds()})`);
}

// A lesson the extension itself opened (or wrote) in the last ${OWN_MS / 1000} s refreshes the list but is not announced.
{
  const h = harness();
  const path = h.writeLesson();
  h.watch.markOwn(path);
  h.watch.lessonEvent(path);
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "refresh", `a lesson the extension just opened is not announced (got ${h.kinds()})`);
  h.advance(OWN_MS);
  h.writeLesson("photosynthese", (l) => { l.metadata.title = `${TITLE} (2)`; });
  h.watch.lessonEvent(path);
  h.advance(DEBOUNCE_MS);
  expect(h.notices().length === 1, `after ${OWN_MS / 1000} s, a new write is announced again (got ${h.kinds()})`);
}

// "Don't show again": events still refresh the list, nothing is announced.
{
  const h = harness({ muted: true });
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "refresh", `muted: refresh only (got ${h.kinds()})`);
}

// Critic 3: the build takes minutes and the learner switches app. With the window unfocused the notice waits, and is
// shown once when the window comes back.
{
  const h = harness({ focused: false });
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "refresh", `unfocused: the list refreshes, the notice waits (got ${h.kinds()})`);
  h.state.focused = true;
  h.watch.windowFocused();
  expect(h.notices().length === 1 && h.notices()[0]!.title === TITLE, `the window comes back: the notice is shown (got ${h.kinds()})`);
  h.watch.windowFocused();
  expect(h.notices().length === 1, "and only once");
}
{
  const h = harness({ focused: false });
  const path = h.writeLesson();
  h.watch.lessonEvent(path);
  h.advance(DEBOUNCE_MS);
  h.advance(5_000);
  h.watch.markOwn(path); // opened from the Lessons view meanwhile
  h.state.focused = true;
  h.watch.windowFocused();
  expect(h.notices().length === 0, `a waiting notice for a lesson opened meanwhile is dropped (got ${h.kinds()})`);
}
{
  const h = harness({ focused: false, muted: false });
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  h.state.muted = true;
  h.state.focused = true;
  h.watch.windowFocused();
  expect(h.notices().length === 0, "a waiting notice is dropped once the learner chose Don't show again");
}

// Two VS Code windows watch the same library: the one in front announces the lesson, the other does not repeat it.
{
  const shown = new Set<string>();
  const front = harness({ shown });
  const back = harness({ shown, focused: false, library: front.library });
  const path = front.writeLesson();
  front.watch.lessonEvent(path);
  back.watch.lessonEvent(path);
  front.advance(DEBOUNCE_MS);
  back.advance(DEBOUNCE_MS);
  back.state.focused = true;
  back.watch.windowFocused();
  expect(front.notices().length === 1 && back.notices().length === 0,
    `one notice across windows (front ${front.notices().length}, back ${back.notices().length})`);
}

// BN-4: prepare_sources writes _sources/<id>.json: "preparing" starts, with the source's title; the lesson citing that
// id (its top-level source_plan_id) ends it and is announced.
{
  const h = harness();
  expect(h.watch.preparing() === null, "nothing is being prepared at first");
  h.watch.sourcesEvent(h.writeSources());
  expect(h.kinds() === "status", `a source set updates the status bar (got ${h.kinds()})`);
  const p = h.watch.preparing();
  expect(p?.id === SS_ID && p.title === SOURCE_TITLE, `preparing names the source (got ${JSON.stringify(p)})`);
  h.advance(3 * 60_000);
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  expect(h.watch.preparing() === null, "the lesson that cites the source set ends preparing");
  expect(h.kinds() === "status,refresh,status,notify", `preparing, then ready (got ${h.kinds()})`);
}
{
  const h = harness();
  h.watch.sourcesEvent(h.writeSources());
  h.watch.lessonEvent(h.writeLesson("other", (l) => { l.source_plan_id = "ss-0000000000000000"; }));
  h.advance(DEBOUNCE_MS);
  expect(h.watch.preparing()?.id === SS_ID, "a lesson built from another source set leaves preparing on");
  expect(h.notices().length === 1, "and is announced all the same");
}
{
  const h = harness();
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "refresh,notify", `a lesson with no source set being prepared: ready only (got ${h.kinds()})`);
}
{
  const h = harness();
  h.watch.sourcesEvent(h.writeSources());
  h.advance(PREPARING_MAX_MS - 1);
  expect(h.watch.preparing() !== null, "preparing holds just under 20 minutes");
  h.advance(1);
  expect(h.watch.preparing() === null, "and clears at 20 minutes when no lesson came");
  expect(h.kinds() === "status,status", `the status bar is told both times (got ${h.kinds()})`);
}
{
  const h = harness();
  const path = join(h.library, "_sources", "ss-bad.json");
  mkdirSync(join(h.library, "_sources"), { recursive: true });
  writeFileSync(path, "{ half written");
  let threw = false;
  try { h.watch.sourcesEvent(path); } catch { threw = true; }
  expect(!threw && h.watch.preparing() === null && h.actions.length === 0, "a malformed source set is ignored without throwing");
  h.watch.sourcesEvent(join(h.library, "elsewhere", `${SS_ID}.json`));
  expect(h.watch.preparing() === null, "a .json outside _sources is not a source set");
}
{
  const h = harness();
  h.watch.sourcesEvent(h.writeSources());
  h.watch.dispose();
  h.advance(PREPARING_MAX_MS);
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "status", `after dispose, nothing more happens (got ${h.kinds()})`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} library-watch assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — library-watch (lesson ready, preparing) passed all ${checks} assertions.`);
