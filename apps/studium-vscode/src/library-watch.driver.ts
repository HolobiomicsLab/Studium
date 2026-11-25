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
  DEBOUNCE_MS, LibraryWatch, OWN_MS, PREPARING_MAX_MS, dontShowLessonReadyAgain, lessonReadyMuted, migrateLessonReadyMute, readLessonFacts,
  readSourceSetFacts, type LessonReadySetting, type LibraryWatchAction,
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
  /** Copy the real source set into <library>/_sources/<id>.json; another id is written into the copy too. */
  const writeSources = (id = SS_ID) => {
    const path = join(library, "_sources", `${id}.json`);
    mkdirSync(join(library, "_sources"), { recursive: true });
    if (id === SS_ID) { copyFileSync(join(fixtures, "_sources", `${SS_ID}.json`), path); return path; }
    const set = JSON.parse(readFileSync(join(fixtures, "_sources", `${SS_ID}.json`), "utf8"));
    set.source_set_id = id;
    writeFileSync(path, JSON.stringify(set));
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
  // Changed: a notice now carries the lessons it announces (review finding 2: lessons that land together share one
  // notice), so the lesson's fields are read from its single entry; what is checked is unchanged.
  const notice = h.notices()[0];
  const only = notice?.lessons.length === 1 ? notice.lessons[0] : undefined;
  expect(only?.title === TITLE && only.steps === 9 && only.ref === "photosynthese/lesson.json" && only.path === path,
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

// Review finding 2: lessons that land together are announced in one notice, not one each; and only a lesson an assistant
// built is announced (build.ts always writes a top-level source_plan_id): a lesson copied into the library by hand is
// listed, not announced.
{
  const h = harness();
  const courses = ["photosynthese", "respiration", "fermentation"];
  for (const course of courses) {
    h.watch.lessonEvent(h.writeLesson(course, (l) => { l.metadata.title = course; }));
    h.advance(100);
  }
  h.advance(DEBOUNCE_MS);
  const notices = h.notices();
  expect(notices.length === 1, `three lessons landing together give one notice (got ${notices.length})`);
  expect(JSON.stringify(notices[0]?.lessons?.map((l) => [l.title, l.ref])) === JSON.stringify(courses.map((c) => [c, `${c}/lesson.json`])),
    `the notice names each of them (got ${JSON.stringify(notices[0])})`);
  expect(h.actions.filter((a) => a.kind === "refresh").length === 1, `and the list is refreshed once (got ${h.kinds()})`);
}
{
  const h = harness();
  h.watch.lessonEvent(h.writeLesson("copied", (l) => { delete l.source_plan_id; }));
  h.advance(DEBOUNCE_MS);
  expect(h.kinds() === "refresh", `a lesson without a top-level source_plan_id (copied by hand) is listed, not announced (got ${h.kinds()})`);
  h.watch.lessonEvent(h.writeLesson("nested", (l) => { delete l.source_plan_id; l.provenance = { source_plan_id: SS_ID }; }));
  h.advance(DEBOUNCE_MS);
  expect(h.notices().length === 0, "a source_plan_id under provenance does not count: build.ts writes it at the top level");
}
{
  const h = harness();
  h.watch.lessonEvent(h.writeLesson("copied", (l) => { delete l.source_plan_id; l.metadata.title = "copied"; }));
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  expect(h.notices().length === 1 && JSON.stringify(h.notices()[0]?.lessons?.map((l) => l.title)) === JSON.stringify([TITLE]),
    `landing with an assistant's lesson, the copied one is still not announced (got ${JSON.stringify(h.notices())})`);
}
{
  const h = harness({ focused: false });
  h.watch.lessonEvent(h.writeLesson());
  h.advance(DEBOUNCE_MS);
  h.advance(60_000);
  h.watch.lessonEvent(h.writeLesson("respiration", (l) => { l.metadata.title = "respiration"; }));
  h.advance(DEBOUNCE_MS);
  h.state.focused = true;
  h.watch.windowFocused();
  expect(h.notices().length === 1 && h.notices()[0]?.lessons?.length === 2,
    `lessons that landed while the window was in the background share one notice when it comes back (got ${JSON.stringify(h.notices())})`);
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
  // Changed: the title is read from the notice's lessons (review finding 2), same check.
  expect(h.notices().length === 1 && h.notices()[0]!.lessons.length === 1 && h.notices()[0]!.lessons[0]!.title === TITLE,
    `the window comes back: the notice is shown (got ${h.kinds()})`);
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
// Review finding 1: an assistant that called prepare_sources twice in one build (a first set it then replaced) cites the
// second set in its lesson. The lesson ends « preparing » for both: a set prepared before the one it cites was part of
// the same build, and left on it would keep the spinner next to the ready notice for up to 20 minutes. A set prepared
// after it belongs to another build and stays.
{
  const h = harness();
  const FIRST = "ss-1111111111111111";
  const SECOND = "ss-2222222222222222";
  h.watch.sourcesEvent(h.writeSources(FIRST));
  h.advance(60_000);
  h.watch.sourcesEvent(h.writeSources(SECOND));
  expect(h.watch.preparing()?.id === SECOND, `the second source set is the one being prepared (got ${JSON.stringify(h.watch.preparing())})`);
  h.advance(60_000);
  h.watch.lessonEvent(h.writeLesson("photosynthese", (l) => { l.source_plan_id = SECOND; }));
  h.advance(DEBOUNCE_MS);
  expect(h.watch.preparing() === null, `the lesson citing the second set also ends the first one (got ${JSON.stringify(h.watch.preparing())})`);
  expect(h.kinds() === "status,status,refresh,status,notify", `one status update, then the notice (got ${h.kinds()})`);
}
{
  const h = harness();
  const EARLIER = "ss-3333333333333333";
  const LATER = "ss-4444444444444444";
  h.watch.sourcesEvent(h.writeSources(EARLIER));
  h.advance(60_000);
  h.watch.sourcesEvent(h.writeSources(LATER));
  h.advance(60_000);
  h.watch.lessonEvent(h.writeLesson("photosynthese", (l) => { l.source_plan_id = EARLIER; }));
  h.advance(DEBOUNCE_MS);
  expect(h.watch.preparing()?.id === LATER, `a set prepared after the one the lesson cites stays on (got ${JSON.stringify(h.watch.preparing())})`);
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

// Review finding 4: « Don't show again » turns off the user setting studium.notifyLessonReady, so the learner can turn the
// notice back on. Before the setting, the choice was a global-state flag nothing could undo: it is moved into the setting
// once, at start, and then forgotten. The setting and the flag are faked here; extension.ts maps them onto VS Code.
function noticeSetting(init: { user?: boolean; legacy?: boolean; unwritable?: boolean } = {}) {
  const state = { user: init.user, legacy: init.legacy ?? false, unwritable: init.unwritable ?? false, writes: [] as boolean[] };
  const setting: LessonReadySetting = {
    enabled: () => state.user !== false,
    userValue: () => state.user,
    setUserValue: async (on) => {
      if (state.unwritable) throw new Error("Unable to write into user settings.");
      state.writes.push(on);
      state.user = on;
    },
    legacyMuted: () => state.legacy,
    setLegacyMuted: async (muted) => { state.legacy = muted; },
  };
  return { state, setting };
}
/** These cases await the setting's writes; the package is CommonJS, so no top-level await. */
async function lessonReadySettingCases() {
  {
    const { state, setting } = noticeSetting();
    expect(!lessonReadyMuted(setting), "by default, lesson-ready notices are on");
    await dontShowLessonReadyAgain(setting);
    expect(JSON.stringify(state.writes) === "[false]" && !state.legacy && lessonReadyMuted(setting),
      `Don't show again writes false to the user setting, not the old flag (got ${JSON.stringify(state)})`);
    state.user = true; // the learner turns the setting back on in the Settings editor
    expect(!lessonReadyMuted(setting), "turning the setting back on brings the notices back");
    await migrateLessonReadyMute(setting);
    expect(!lessonReadyMuted(setting) && state.writes.length === 1, "and the next start does not mute them again");
  }
  {
    const { state, setting } = noticeSetting({ legacy: true });
    expect(lessonReadyMuted(setting), "the flag of an earlier version still mutes before it is moved");
    await migrateLessonReadyMute(setting);
    expect(state.user === false && !state.legacy && lessonReadyMuted(setting),
      `at start the flag becomes the user setting, and is forgotten (got ${JSON.stringify(state)})`);
    state.user = true;
    expect(!lessonReadyMuted(setting), "so turning the setting back on is enough");
  }
  {
    const { state, setting } = noticeSetting({ legacy: true, user: true });
    await migrateLessonReadyMute(setting);
    expect(state.writes.length === 0 && !state.legacy && !lessonReadyMuted(setting),
      `a learner who already set the setting keeps their choice; the flag is forgotten (got ${JSON.stringify(state)})`);
  }
  {
    const { state, setting } = noticeSetting();
    await migrateLessonReadyMute(setting);
    expect(state.writes.length === 0 && state.user === undefined, "without the flag, the start writes no setting");
  }
  {
    // A settings.json VS Code cannot write (one with a syntax error, say): the choice is kept in the flag meanwhile.
    const { state, setting } = noticeSetting({ unwritable: true });
    let threw = false;
    try { await dontShowLessonReadyAgain(setting); } catch { threw = true; }
    expect(!threw && state.legacy && lessonReadyMuted(setting), `unwritable settings: Don't show again still holds, in the flag (got ${JSON.stringify(state)})`);
    await migrateLessonReadyMute(setting);
    expect(state.legacy && lessonReadyMuted(setting), "a start that still cannot write keeps the flag");
    state.unwritable = false;
    await migrateLessonReadyMute(setting);
    expect(state.user === false && !state.legacy, `the first start that can write moves it into the setting (got ${JSON.stringify(state)})`);
  }
}

void lessonReadySettingCases().catch((error) => { failures.push(`the lesson-ready setting cases threw: ${error}`); }).finally(() => {
  if (failures.length) {
    console.error(`FAIL — ${failures.length}/${checks} library-watch assertions failed:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`OK — library-watch (lesson ready, preparing) passed all ${checks} assertions.`);
});
