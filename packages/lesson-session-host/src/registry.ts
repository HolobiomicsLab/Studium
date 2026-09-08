// packages/lesson-session-host/src/registry.ts
import type { LessonSession, SessionDeps } from "@studium/lesson-session";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

export interface SessionEntry {
  session: LessonSession;
  deps: SessionDeps;
  bundle: LessonBundle;
  /** dir that relative render-asset paths resolve against (holds lesson.json); "" for a .zip bundle */
  baseDir: string;
  /** per-session cache of inlined text-asset payloads, keyed by resolved path (files are static for
   * the session) — avoids re-reading a big .cube on every get_scene_artifacts turn. */
  assetCache: Map<string, string>;
  /** the LEARNER-level pseudonym (fixed scope, stable across lessons) keying the cross-lesson profile —
   * used to merge this session's concept_states forward on completion. */
  profilePseudonym?: string;
}

export class SessionRegistry {
  private readonly map = new Map<string, SessionEntry>();
  create(id: string, entry: SessionEntry): void { this.map.set(id, entry); }
  get(id: string): SessionEntry | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
  delete(id: string): boolean { return this.map.delete(id); }
  get size(): number { return this.map.size; }
}
