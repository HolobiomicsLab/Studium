// packages/lesson-session-host/src/orientation.ts
//
// INT-STUDIUM-058 (spec 2026-11-06, F4 and § 2.3) — where the learner is, at any moment and on any
// surface, without asking: the step out of the total, the concept on screen, the minutes left, the
// reviews due, what is expected of them, and why the lesson last adapted. `orientationOf` gives it as
// data, `statusLine` as one line of at most 80 characters. Two consumers read this module, so that
// every surface says the same thing: the panel presenter (packages/lesson-panel) and the conversation
// text (chat-display.ts).
//
// Public by construction: an orientation is built from scene ids and types, concept ids and titles,
// authored durations and the learner's own path. No scene text, key, hint or reveal enters it.
import type { Transition } from "@studium/lesson-session";
import type { ConceptMap, ConceptMapState } from "./concept-map.js";
import { expectedKind } from "./operator-context.js";
import type { SessionEntry } from "./registry.js";
import type { SessionHost } from "./host.js";

/** What the session expects of the learner now. `read`: a screen to read, then continue. `answer`: a
 * choice, a text, a confidence or a discussion turn. `self_rating`: their own rating of the answer
 * they just wrote, which nobody assessed. `run`: a computation to run before the scene can go on.
 * `nothing`: the session is complete. */
export type Waiting = "read" | "answer" | "self_rating" | "run" | "nothing";

export interface Orientation {
  /** The screen's position in the lesson (1-based). `detour`: the learner is on a prerequisite detour
   * and `returns_to` is the scene it comes back to. */
  step: { index: number; total: number; detour?: { returns_to: string } };
  /** The first concept of the screen, in the state the concept map gives it. Absent on a screen that
   * names no concept and once the session is complete. */
  concept?: { id: string; title: string; state: ConceptMapState };
  /** Authored durations of this screen and the ones after it, in minutes rounded up. Absent when the
   * lesson states none. */
  minutes_left?: number;
  /** Concepts of this session due for review now. The learner's other lessons are not counted here:
   * `get_study_plan` and `start_review_session` read them. */
  reviews_due: number;
  waiting: Waiting;
  /** How the session routed to this screen, when it did anything but advance: the engine's
   * navigation kind and its one-sentence reason. `detail` says how the decision was made (the rule
   * applied, the scenes it rests on), for a teacher or a learner who asks. */
  last_adaptation?: { kind: string; reason: string; detail?: { rule_id: string; evidence: string[] } };
}

/** How the session last routed, as the host keeps it between two calls (recordNavigation). */
export interface LastNavigation { kind: string; reason: string | null; rule_id: string | null; evidence: string[] }

/** The session facts an orientation is computed from (SessionHost.orientationFacts). */
export interface OrientationFacts {
  completed: boolean;
  /** 0-based index of the screen, and the number of screens. */
  index: number;
  total: number;
  scene: { id: string; type: string; concept_refs: readonly string[] };
  seconds_left: number;
  concept: { id: string; title: string; state: ConceptMapState } | null;
  /** The answer just given asked for the learner's own rating, and it has not been given. */
  self_rating_pending: boolean;
  /** The screen holds a run the learner has not recorded yet. */
  run_pending: boolean;
  reviews_due: number;
  last_navigation: LastNavigation | null;
  detour_returns_to: string | null;
}

const bare = (conceptId: string): string => conceptId.replace(/^concept:/, "");

/** Remember how the session routed after a response, for the orientations that follow. A detour opens
 * on a prerequisite remediation and closes with the first routing that is neither a replay nor an
 * alternate item: the rule the host already applies to its concept map (conceptMapMoment). */
export function recordNavigation(entry: SessionEntry, transition: Transition): void {
  const navigation = transition.navigation;
  if (!navigation) return;
  const answered = transition.verdict?.scene_id;
  entry.lastNavigation = {
    kind: navigation.kind, reason: navigation.reason, rule_id: navigation.rule_id,
    evidence: [...(answered ? [answered] : []), ...(navigation.skipped_scene_ids ?? [])],
  };
  if (navigation.kind === "remediate" && navigation.returns_to) entry.detourReturnsTo = navigation.returns_to;
  else if (navigation.kind !== "replay" && navigation.kind !== "remediate_alt") delete entry.detourReturnsTo;
}

/** Read the facts off a live session. The host supplies what only it computes: the concept map, the
 * reviews due at the session's moment and whether the screen still waits for a run. */
export function orientationFacts(
  entry: SessionEntry,
  host: { conceptMap: ConceptMap | null; reviewsDue: number; runPending: boolean },
): OrientationFacts {
  const completed = entry.completed === true;
  const presentation = entry.session.currentPresentation();
  const scene = presentation.scene;
  const refs: readonly string[] = "concept_refs" in scene ? scene.concept_refs : [];
  const answered = entry.session.learnerPath().steps.at(-1)?.scene_id;
  const requests = entry.session.getState().self_rating_requests ?? {};
  const first = refs[0] === undefined ? undefined : bare(refs[0]);
  const node = first === undefined ? undefined : host.conceptMap?.nodes.find((n) => n.id === first);
  const authored = first === undefined ? undefined : entry.bundle.concepts.find((c) => bare(c.id) === first);
  const concept = node ? { id: node.id, title: node.title, state: node.state }
    : authored ? { id: first!, title: authored.title, state: "current" as const } : null;
  return {
    completed,
    index: completed ? presentation.total - 1 : presentation.index,
    total: presentation.total,
    scene: { id: scene.id, type: scene.type, concept_refs: refs },
    seconds_left: completed ? 0
      : entry.bundle.scenes.slice(presentation.index).reduce((sum, s) => sum + s.estimated_seconds, 0),
    concept: completed ? null : concept,
    self_rating_pending: answered !== undefined && Object.hasOwn(requests, answered),
    run_pending: !completed && host.runPending,
    reviews_due: host.reviewsDue,
    last_navigation: entry.lastNavigation ?? null,
    detour_returns_to: completed ? null : entry.detourReturnsTo ?? null,
  };
}

function waitingOf(facts: OrientationFacts): Waiting {
  if (facts.self_rating_pending) return "self_rating";
  if (facts.completed) return "nothing";
  if (facts.run_pending) return "run";
  // A discussion is acknowledged at its end, but the learner writes its turns.
  return expectedKind(facts.scene.type) === "ack" && facts.scene.type !== "discussion" ? "read" : "answer";
}

/** Navigation kinds that are not an adaptation: nothing to explain. */
const PLAIN_NAVIGATION = new Set(["advance", "complete"]);

/** The orientation those facts amount to. */
export function orientationFrom(facts: OrientationFacts): Orientation {
  const navigation = facts.last_navigation;
  const adapted = navigation !== null && !PLAIN_NAVIGATION.has(navigation.kind) && navigation.reason !== null;
  return {
    step: {
      index: facts.index + 1, total: facts.total,
      ...(facts.detour_returns_to === null ? {} : { detour: { returns_to: facts.detour_returns_to } }),
    },
    ...(facts.concept ? { concept: facts.concept } : {}),
    ...(facts.seconds_left > 0 ? { minutes_left: Math.ceil(facts.seconds_left / 60) } : {}),
    reviews_due: facts.reviews_due,
    waiting: waitingOf(facts),
    ...(adapted ? {
      last_adaptation: {
        kind: navigation.kind, reason: navigation.reason!,
        ...(navigation.rule_id === null ? {} : { detail: { rule_id: navigation.rule_id, evidence: navigation.evidence } }),
      },
    } : {}),
  };
}

/** Where the learner of this session is now. `nowMs` sets the moment reviews are due at (the
 * session's own clock when absent). */
export function orientationOf(host: SessionHost, sessionId: string, opts: { nowMs?: number } = {}): Orientation {
  return orientationFrom(host.orientationFacts(sessionId, opts.nowMs));
}

export const STATUS_LINE_MAX = 80;
/** Under this many characters a cut title reads as noise: the line goes without it. */
const SHORTEST_TITLE = 8;
const SEPARATOR = " · ";

interface StatusWords {
  step: string; detour: string; minutes: string; review: string; reviews: string;
  waiting: Record<Waiting, string>;
}
const WORDS: Record<"fr" | "en", StatusWords> = {
  fr: {
    step: "étape {n}/{total}", detour: "détour", minutes: "{n} min", review: "1 révision due", reviews: "{n} révisions dues",
    waiting: { read: "à lire", answer: "à toi de répondre", self_rating: "à toi de t'évaluer", run: "calcul à lancer", nothing: "terminé" },
  },
  en: {
    step: "step {n}/{total}", detour: "detour", minutes: "{n} min", review: "1 review due", reviews: "{n} reviews due",
    waiting: { read: "to read", answer: "your answer", self_rating: "rate your recall", run: "run to do", nothing: "done" },
  },
};

/** The orientation as one line, `STATUS_LINE_MAX` characters at most: the lesson, the step, the
 * minutes left, the reviews due, what is expected. The step and what is expected always stay; a long
 * title is cut, then dropped. */
export function statusLine(o: Orientation, lessonTitle: string, locale: "fr" | "en"): string {
  const w = WORDS[locale];
  const facts = [
    w.step.replace("{n}", String(o.step.index)).replace("{total}", String(o.step.total)),
    ...(o.step.detour ? [w.detour] : []),
    ...(o.minutes_left === undefined ? [] : [w.minutes.replace("{n}", String(o.minutes_left))]),
    ...(o.reviews_due === 0 ? [] : [o.reviews_due === 1 ? w.review : w.reviews.replace("{n}", String(o.reviews_due))]),
    w.waiting[o.waiting],
  ].join(SEPARATOR);
  const title = lessonTitle.trim();
  const room = STATUS_LINE_MAX - facts.length - SEPARATOR.length;
  if (title.length === 0 || room < Math.min(title.length, SHORTEST_TITLE)) return facts.slice(0, STATUS_LINE_MAX);
  const shown = title.length <= room ? title : `${title.slice(0, room - 1).trimEnd()}…`;
  return `${shown}${SEPARATOR}${facts}`;
}
