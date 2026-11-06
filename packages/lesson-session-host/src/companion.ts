// packages/lesson-session-host/src/companion.ts
//
// INT-STUDIUM-058 § 2.5: the companion brief. A lesson is played on two lanes: the fast lane (a panel,
// a pane or forms: the server answers, no model writes) and the companion lane (the conversation: an
// agent relays). When the learner turns to the agent after acts on the fast lane, the agent reads a
// brief: where the learner is, what they did since the agent last looked, what the session waits for.
//
// The brief holds ids, types, titles, durations, and the outcome of answers already given. No scene
// text, key, hint or reference: it is built from the orientation (orientation.ts) and from the acts
// noted here.
import type { SessionEntry } from "./registry.js";
import type { Help, Orientation, Waiting } from "./orientation.js";

/** Which lane an act came through. */
export type Lane = "fast" | "companion";
export type ActKind = "read" | "answer" | "hint" | "self_rating" | "contest";
export interface CompanionAct { scene_id: string; act: ActKind; lane: Lane; correct?: boolean; confidence?: number }

/** The acts a brief lists at most; older ones are counted, not listed. */
export const BRIEF_ACTS_MAX = 12;

export interface CompanionBrief {
  session_id: string;
  /** The acts of the session up to this brief; the next brief lists what came after. */
  cursor: number;
  status_line: string;
  where: {
    lesson_title: string; step: Orientation["step"];
    scene: { id: string; type: string; title: string }; waiting: Waiting;
  };
  /** The latest acts since the last brief, oldest first, BRIEF_ACTS_MAX at most. */
  since_last: CompanionAct[];
  /** How many acts there were since the last brief, listed or not. */
  since_last_count: number;
  help: Help;
  /** Three fixed lines for the agent, in the lesson's language. */
  rules: string[];
}

export const COMPANION_RULES: Record<"fr" | "en", readonly [string, string, string]> = {
  fr: [
    "Ne donne jamais la réponse d'une question qui attend.",
    "L'explication de l'idée qu'une question teste attend que l'apprenant ait essayé.",
    "Ne remontre pas ce que l'apprenant a déjà vu.",
  ],
  en: [
    "Never give the answer to a question that waits.",
    "The explanation of the idea a question tests waits until the learner has tried.",
    "Do not show again what the learner has already seen.",
  ],
};

/** What a session keeps for its briefs: the acts not yet briefed (the latest ones, and their count)
 * and how many were briefed before. In memory only: a session resumed after a restart starts empty. */
export interface CompanionLog { seen: number; pending: number; latest: CompanionAct[] }

/** Note an act of the learner. Only the latest BRIEF_ACTS_MAX are kept: a session nobody briefs does
 * not grow. */
export function noteAct(entry: SessionEntry, act: CompanionAct): void {
  const log = (entry.companion ??= { seen: 0, pending: 0, latest: [] });
  log.pending += 1;
  log.latest.push(act);
  if (log.latest.length > BRIEF_ACTS_MAX) log.latest.shift();
}

/** The acts since the last brief, and move the cursor past them. */
export function takeActs(entry: SessionEntry): Pick<CompanionBrief, "cursor" | "since_last" | "since_last_count"> {
  const log = (entry.companion ??= { seen: 0, pending: 0, latest: [] });
  const taken = { cursor: log.seen + log.pending, since_last: log.latest, since_last_count: log.pending };
  entry.companion = { seen: taken.cursor, pending: 0, latest: [] };
  return taken;
}
