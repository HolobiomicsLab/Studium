// library-watch.ts — BN-1 / BN-4: turn file events in the learner's library (<STUDIUM_HOME>/library, where an
// assistant's Studium server writes, apps/lesson-mcp/src/server.ts authoringRoot) into what the extension shows.
//   - <library>/<course>/lesson.json written (create_lesson): refresh the Lessons view, then announce the lesson once
//     ("Your lesson … is ready"), after a burst of events settles. Not announced: a lesson the extension itself opened or
//     wrote in the last OWN_MS, or after the learner chose "Don't show again". With the window in the background the
//     notice waits and is shown when the window comes back; windows share a record of what was shown, so a second
//     window does not repeat it.
//   - <library>/_sources/<id>.json written (prepare_sources): "preparing a lesson" until a lesson whose top-level
//     source_plan_id is that id, or the id of a set prepared after it, lands, or for PREPARING_MAX_MS at most (a build
//     the assistant abandoned).
// Pure apart from the two readers at the bottom: no VS Code import; the clock, the timers, the window focus and the
// host's actions are injected, so library-watch.driver.ts drives it with a manual clock.
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Wait this long after the last event on a lesson before acting: one write can raise several events. */
export const DEBOUNCE_MS = 500;
/** A lesson the extension opened or wrote within this window is not announced. */
export const OWN_MS = 10_000;
/** "Preparing" is dropped after this long without the lesson. */
export const PREPARING_MAX_MS = 20 * 60_000;

/** What the notice needs from a lesson.json. `version` tells two writes of the same file apart. */
export interface LessonFacts { title: string; steps: number; sourcePlanId: string | null; version: string }
/** What the status bar needs from a source set: its id and what it was prepared from. */
export interface SourceSetFacts { id: string; title: string }
export interface PreparingState { id: string; title: string; since: number }

export type LibraryWatchAction =
  | { kind: "refresh" }
  | { kind: "status" }
  | { kind: "notify"; path: string; ref: string; title: string; steps: number };

export interface LibraryWatchDeps {
  /** The library folder, as the server computes it (absolute). */
  library: string;
  readLesson: (path: string) => LessonFacts | null;
  readSourceSet: (path: string) => SourceSetFacts | null;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Whether this window is in front. */
  focused: () => boolean;
  /** Whether the learner chose "Don't show again". */
  muted: () => boolean;
  /** Which lesson versions were already announced, shared by every window. */
  shown: { has: (key: string) => boolean; add: (key: string) => void };
  act: (action: LibraryWatchAction) => void;
}

type Notice = Extract<LibraryWatchAction, { kind: "notify" }> & { key: string; queuedAt: number };

export class LibraryWatch {
  private readonly library: string;
  private readonly debounces = new Map<string, unknown>();
  private readonly pending = new Map<string, Notice>();
  private readonly ownedAt = new Map<string, number>();
  private readonly preparingById = new Map<string, PreparingState & { timer: unknown }>();
  private disposed = false;

  constructor(private readonly deps: LibraryWatchDeps) {
    this.library = resolve(deps.library);
  }

  /** A create or change event on <library>/<course>/lesson.json. */
  lessonEvent(path: string): void {
    if (this.disposed) return;
    const file = resolve(path);
    if (!this.lessonRef(file)) return;
    const previous = this.debounces.get(file);
    if (previous !== undefined) this.deps.clearTimer(previous);
    this.debounces.set(file, this.deps.setTimer(() => { this.debounces.delete(file); this.settle(file); }, DEBOUNCE_MS));
  }

  /** A create or change event on <library>/_sources/<id>.json. A file that does not read as a source set is ignored. */
  sourcesEvent(path: string): void {
    if (this.disposed) return;
    const file = resolve(path);
    const parts = this.partsOf(file);
    if (!parts || parts.length !== 2 || parts[0] !== "_sources" || !parts[1]!.endsWith(".json")) return;
    const facts = this.safe(() => this.deps.readSourceSet(file));
    if (!facts) return;
    const earlier = this.preparingById.get(facts.id);
    if (earlier) this.deps.clearTimer(earlier.timer);
    const timer = this.deps.setTimer(() => {
      if (this.preparingById.delete(facts.id)) this.deps.act({ kind: "status" });
    }, PREPARING_MAX_MS);
    this.preparingById.set(facts.id, { id: facts.id, title: facts.title, since: this.deps.now(), timer });
    this.deps.act({ kind: "status" });
  }

  /** The window came to the front: show the notices that waited for it. */
  windowFocused(): void {
    if (this.disposed) return;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const notice of waiting) {
      const opened = this.ownedAt.get(notice.path);
      if (opened !== undefined && opened >= notice.queuedAt) continue;
      if (this.deps.muted() || this.deps.shown.has(notice.key)) continue;
      this.show(notice);
    }
  }

  /** The extension opened or wrote this lesson: do not announce it for OWN_MS, and drop a notice that waits for it. */
  markOwn(path: string): void {
    this.ownedAt.set(resolve(path), this.deps.now());
  }

  /** The source set being prepared most recently, or null. */
  preparing(): PreparingState | null {
    let latest: PreparingState | null = null;
    for (const { id, title, since } of this.preparingById.values()) if (!latest || since >= latest.since) latest = { id, title, since };
    return latest;
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.debounces.values()) this.deps.clearTimer(handle);
    for (const entry of this.preparingById.values()) this.deps.clearTimer(entry.timer);
    this.debounces.clear();
    this.preparingById.clear();
    this.pending.clear();
  }

  private settle(file: string): void {
    if (this.disposed) return;
    const ref = this.lessonRef(file);
    if (!ref) return;
    this.deps.act({ kind: "refresh" });
    const facts = this.safe(() => this.deps.readLesson(file));
    if (!facts) return;
    // The lesson ends « preparing » for the set it cites and for every set prepared before it: an assistant that called
    // prepare_sources twice in one build (a first set it then replaced) cites the last one only.
    const prepared = facts.sourcePlanId ? this.preparingById.get(facts.sourcePlanId) : undefined;
    if (prepared) {
      for (const entry of [...this.preparingById.values()]) {
        if (entry.since > prepared.since) continue;
        this.deps.clearTimer(entry.timer);
        this.preparingById.delete(entry.id);
      }
      this.deps.act({ kind: "status" });
    }
    const now = this.deps.now();
    const opened = this.ownedAt.get(file);
    if (opened !== undefined && now - opened < OWN_MS) return;
    if (this.deps.muted()) return;
    const key = `${ref}@${facts.version}`;
    if (this.deps.shown.has(key)) return;
    const notice: Notice = { kind: "notify", path: file, ref, title: facts.title, steps: facts.steps, key, queuedAt: now };
    if (this.deps.focused()) this.show(notice);
    else this.pending.set(file, notice);
  }

  private show(notice: Notice): void {
    this.deps.shown.add(notice.key);
    const { key: _key, queuedAt: _queuedAt, ...action } = notice;
    this.deps.act(action);
  }

  /** "<course>/lesson.json" for a lesson directly under the library, else null. */
  private lessonRef(file: string): string | null {
    const parts = this.partsOf(file);
    if (!parts || parts.length !== 2 || parts[1] !== "lesson.json" || parts[0] === "_sources") return null;
    return parts.join("/");
  }

  private partsOf(file: string): string[] | null {
    const rel = relative(this.library, file);
    if (!rel || isAbsolute(rel) || rel.startsWith("..")) return null;
    return rel.split(sep);
  }

  private safe<T>(read: () => T | null): T | null {
    try { return read(); } catch { return null; }
  }
}

/** Read a lesson.json for the notice: metadata.title, the number of scenes, the top-level source_plan_id (build.ts
 * writes it there, not under provenance). Null when the file is missing, malformed or untitled. */
export function readLessonFacts(path: string): LessonFacts | null {
  try {
    const stat = statSync(path);
    const lesson = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const metadata = lesson["metadata"] as Record<string, unknown> | undefined;
    const title = typeof metadata?.["title"] === "string" ? metadata["title"].trim() : "";
    if (!title) return null;
    const scenes = Array.isArray(lesson["scenes"]) ? lesson["scenes"].length : 0;
    const sourcePlanId = typeof lesson["source_plan_id"] === "string" && lesson["source_plan_id"] ? lesson["source_plan_id"] : null;
    return { title, steps: scenes, sourcePlanId, version: `${stat.mtimeMs}:${stat.size}` };
  } catch {
    return null;
  }
}

/** Read a source set written by prepare_sources: its source_set_id, and the title of its first source (else its goal). */
export function readSourceSetFacts(path: string): SourceSetFacts | null {
  try {
    const set = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const id = typeof set["source_set_id"] === "string" ? set["source_set_id"].trim() : "";
    if (!id) return null;
    const first = Array.isArray(set["sources"]) ? set["sources"][0] as Record<string, unknown> | undefined : undefined;
    const title = typeof first?.["title"] === "string" && first["title"].trim() ? first["title"].trim()
      : typeof set["goal"] === "string" ? set["goal"].trim() : "";
    return { id, title };
  } catch {
    return null;
  }
}
