// packages/lesson-session-host/src/orientation.ts
//
// INT-STUDIUM-058 (spec 2026-11-06, F4 and § 2.3) — where the learner is, at any moment and on any
// surface, without asking: the step out of the total, the concept on screen, the minutes left, the
// reviews due, what is expected of them, and why the lesson last adapted. `orientationOf` gives it as
// data, `statusLine` as one line of at most 80 characters. `voicesOf` (F5) says who speaks: who signs
// the lesson a screen comes from and whether it was reviewed, and who assessed an answer. `helpOf`
// (F7) says which help is open now, in the order to try it: reread, a hint, an explanation, the
// reference; an explanation of a question comes after a first try at it. Two
// consumers read this module, so that every surface says the same thing: the panel presenter
// (packages/lesson-panel) and the conversation text (chat-display.ts).
//
// Public by construction: an orientation is built from scene ids and types, concept ids and titles,
// authored durations and the learner's own path. No scene text, key, hint or reveal enters it.
import type { Transition } from "@studium/lesson-session";
import type { AuthoringBlock, DraftedBy } from "./authoring.js";
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
  /** The screen is a check question of a contest (contest.ts): the concept contested, which question
   * this is (1-based) and how many the contest asks. Absent on every other screen. */
  contest?: ContestCheck;
}

/** A contest's check question on screen. */
export interface ContestCheck { concept_id: string; question: number; total: number }

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
  /** The screen is a question that has authored hints. */
  has_hints: boolean;
  /** Hint requests still open on this visit of the screen. */
  hints_left: number;
  /** The learner already submitted an answer to this very scene (it is being asked again). */
  tried: boolean;
  /** The last act of the session was an answer that received a verdict: this screen is the first
   * after an assessed answer. False after a read, a hint, a rating, a contest and on a resumed
   * session. */
  answered_before: boolean;
  /** A contest's check question is on screen. */
  contest: ContestCheck | null;
}

const bare = (conceptId: string): string => conceptId.replace(/^concept:/, "");

/** Note an act that is not an answer (a hint, a self-rating, a contest): the screen is no longer the
 * first after an assessed answer. */
export function recordOtherAct(entry: SessionEntry): void {
  entry.answeredBefore = false;
}

/** Remember how the session routed after a response, for the orientations that follow. A detour opens
 * on a prerequisite remediation and closes with the first routing that is neither a replay nor an
 * alternate item: the rule the host already applies to its concept map (conceptMapMoment). The
 * response itself is noted too: an answer that received a verdict opens the explanation of the
 * screen that follows it (helpFrom). */
export function recordNavigation(entry: SessionEntry, transition: Transition): void {
  entry.answeredBefore = transition.verdict?.graded === true;
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
  const steps = entry.session.learnerPath().steps;
  const answered = steps.at(-1)?.scene_id;
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
    has_hints: !completed && scene.type === "quiz" && scene.hints.length > 0,
    hints_left: completed ? 0 : entry.session.hintsLeft(),
    tried: !completed && steps.some((step) => step.scene_id === scene.id && step.answered),
    answered_before: !completed && entry.answeredBefore === true,
    contest: completed ? null : contestCheckOf(entry, scene.id),
  };
}

/** The contest's check question on screen, if any. The question is told by the scene, not by the
 * answers counted so far: a transition is served before the host counts the answer that led to it. */
function contestCheckOf(entry: SessionEntry, sceneId: string): ContestCheck | null {
  const pending = entry.contest;
  if (!pending || !entry.session.checkPending()) return null;
  const at = pending.scene_ids.indexOf(sceneId);
  return at < 0 ? null : { concept_id: pending.concept_id, question: at + 1, total: pending.scene_ids.length };
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
    ...(facts.contest ? { contest: { ...facts.contest } } : {}),
  };
}

/** Where the learner of this session is now. `nowMs` sets the moment reviews are due at (the
 * session's own clock when absent). */
export function orientationOf(host: SessionHost, sessionId: string, opts: { nowMs?: number } = {}): Orientation {
  return orientationFrom(host.orientationFacts(sessionId, opts.nowMs));
}

/** Who speaks. `author`: the lesson — `name` is the teacher who signs it (the bundle's validator, or
 * the reviewer whose approval is bound to this exact file), null when nobody does; `reviewed` is
 * false for a lesson no teacher validated and for one changed since its approval; `drafted_by` says
 * who wrote the content and its keys. `key`: the author's answer key assessed the answer. `judge`: a
 * judge model did. `agent`: text the assistant generated at the learner's request, which the lesson's
 * author did not write. */
export type Voice =
  | { kind: "author"; name: string | null; reviewed: boolean; drafted_by: DraftedBy }
  | { kind: "key" }
  | { kind: "judge" }
  | { kind: "agent" };

/** The part of a transition's verdict a voice reads: who assessed the answer. */
export type AssessedBy = Pick<NonNullable<Transition["verdict"]>, "assessed_by">;

/** The voice of the screen and, after an answer somebody assessed, the voice of its verdict. */
export interface Voices { scene: Voice; verdict?: Voice }

/** The lesson's voice. An approval record next to the lesson, when there is one, decides `reviewed`:
 * it is bound to the file's bytes, so it says whether this very version was read. */
export function authorVoice(authoring: AuthoringBlock, validatedBy: string): Voice {
  const approval = authoring.approval;
  const approved = approval.recorded && approval.matches;
  return {
    kind: "author",
    name: authoring.validated ? validatedBy : approved ? approval.reviewer ?? null : null,
    reviewed: approval.recorded ? approval.matches : authoring.validated,
    drafted_by: authoring.drafted_by,
  };
}

/** Who assessed an answer; nothing when nobody did (an acknowledgement, an unjudged written answer). */
export function verdictVoice(verdict: AssessedBy | null | undefined): Voice | undefined {
  if (verdict?.assessed_by === "key") return { kind: "key" };
  if (verdict?.assessed_by === "judge") return { kind: "judge" };
  return undefined;
}

/** Who speaks on this session's screen, and in `verdict` when an answer was just assessed. */
export function voicesOf(host: SessionHost, sessionId: string, verdict?: AssessedBy | null): Voices {
  const assessed = verdictVoice(verdict);
  return { scene: host.authorVoice(sessionId), ...(assessed ? { verdict: assessed } : {}) };
}

/** Longest voice line. With the status line and the Markdown around both, a screen grows by 200
 * characters at most. */
export const VOICE_LINE_MAX = 110;

interface VoiceWords {
  drafted: Record<DraftedBy, string>;
  validated_by: string; validated: string; changed_since: string; unreviewed: string;
}
const VOICE_WORDS: Record<"fr" | "en", VoiceWords> = {
  fr: {
    drafted: { agent: "Leçon rédigée par l'IA", learner: "Leçon que tu as rédigée", teacher: "Leçon" },
    validated_by: "validée par {name}", validated: "validée par un enseignant",
    changed_since: "modifiée depuis sa validation par {name}", unreviewed: "non relue par un enseignant",
  },
  en: {
    drafted: { agent: "AI-drafted lesson", learner: "Lesson you wrote", teacher: "Lesson" },
    validated_by: "validated by {name}", validated: "validated by a teacher",
    changed_since: "changed since {name} validated it", unreviewed: "not reviewed by a teacher",
  },
};

/** The lesson's voice as one line for the conversation text, `VOICE_LINE_MAX` characters at most: who
 * drafted it, and whether a teacher read this version of it. A long name is cut. Empty for a voice
 * that is not the lesson's author. */
export function voiceLine(voice: Voice, locale: "fr" | "en"): string {
  if (voice.kind !== "author") return "";
  const w = VOICE_WORDS[locale];
  const drafted = w.drafted[voice.drafted_by];
  const compose = (name: string | null): string => {
    const review = voice.reviewed ? (name ? w.validated_by : w.validated) : name ? w.changed_since : w.unreviewed;
    const text = `${drafted}${voice.drafted_by === "teacher" ? " " : ", "}${review.replace("{name}", name ?? "")}`;
    return /[.…]$/.test(text) ? text : `${text}.`;
  };
  const line = compose(voice.name);
  if (line.length <= VOICE_LINE_MAX || !voice.name) return line;
  const room = voice.name.length - (line.length - VOICE_LINE_MAX) - 1;
  return compose(`${voice.name.slice(0, Math.max(1, room)).trimEnd()}…`);
}

/** One kind of help, in the order to try them: read the screen again, take an authored hint, ask for
 * an explanation, compare with the reference. `cost` says what taking it changes; `why_not` why it
 * is closed now. Both are phrases for the learner, in the session's language. */
export interface HelpRung { kind: "reread" | "hint" | "explain" | "reference"; available: boolean; cost?: string; why_not?: string }
export interface Help { rungs: HelpRung[] }

interface HelpWords { hint_cost: string; no_hint: string; hints_used: string; try_first: string; after_answer: string; no_reference: string }
const HELP_WORDS: Record<"fr" | "en", HelpWords> = {
  fr: {
    hint_cost: "un indice réduit le crédit de cette réponse", no_hint: "pas d'indice pour cet écran",
    hints_used: "plus d'indice pour cet essai", try_first: "essaie d'abord de répondre",
    after_answer: "la référence s'affiche après ta réponse", no_reference: "pas de référence pour cet écran",
  },
  en: {
    hint_cost: "a hint lowers the credit of this answer", no_hint: "no hint on this screen",
    hints_used: "no hint left for this try", try_first: "try an answer first",
    after_answer: "the reference shows after your answer", no_reference: "no reference on this screen",
  },
};

/** The help ladder those facts open. An explanation waits for a first try only where an answer is
 * expected: on a screen to read, during a self-rating or a run, nothing is given away by explaining;
 * and on the screen right after an assessed answer it explains the answer just given, even when the
 * lesson has moved on to a question not tried yet.
 * The reference is the one the verdict released: it is on screen while the learner rates their own
 * answer, and never before an answer. */
export function helpFrom(facts: OrientationFacts, locale: "fr" | "en"): Help {
  const w = HELP_WORDS[locale];
  const waiting = waitingOf(facts);
  const hint: HelpRung = facts.hints_left > 0 ? { kind: "hint", available: true, cost: w.hint_cost }
    : { kind: "hint", available: false, why_not: facts.has_hints ? w.hints_used : w.no_hint };
  const explain: HelpRung = waiting !== "answer" || facts.tried || facts.answered_before ? { kind: "explain", available: true }
    : { kind: "explain", available: false, why_not: w.try_first };
  const reference: HelpRung = waiting === "self_rating" ? { kind: "reference", available: true }
    : { kind: "reference", available: false, why_not: waiting === "answer" ? w.after_answer : w.no_reference };
  return { rungs: [{ kind: "reread", available: true }, hint, explain, reference] };
}

/** Which help is open on this session's screen now. */
export function helpOf(host: SessionHost, sessionId: string, locale: "fr" | "en"): Help {
  return helpFrom(host.orientationFacts(sessionId), locale);
}

export const STATUS_LINE_MAX = 80;
/** Under this many characters a cut title reads as noise: the line goes without it. */
const SHORTEST_TITLE = 8;
const SEPARATOR = " · ";
/** Where a title may be cut so that what is left reads as a whole phrase (« Atomistique L1 »). */
const TITLE_SEPARATORS = [" — ", " – ", " : ", " (", " [", ": "];

interface StatusWords {
  step: string; check: string; detour: string; minutes: string; review: string; reviews: string;
  waiting: Record<Waiting, string>;
}
const WORDS: Record<"fr" | "en", StatusWords> = {
  fr: {
    step: "étape {n}/{total}", check: "contrôle {n}/{total}", detour: "détour", minutes: "{n} min", review: "1 révision due", reviews: "{n} révisions dues",
    waiting: { read: "à lire", answer: "à toi de répondre", self_rating: "à toi de t'évaluer", run: "calcul à lancer", nothing: "terminé" },
  },
  en: {
    step: "step {n}/{total}", check: "check {n}/{total}", detour: "detour", minutes: "{n} min", review: "1 review due", reviews: "{n} reviews due",
    waiting: { read: "to read", answer: "your answer", self_rating: "rate your recall", run: "run to do", nothing: "done" },
  },
};

/** The longest part of `title` that ends right before one of its separators and fits in `room`, or
 * null when none of `SHORTEST_TITLE` characters or more does. */
function titleHead(title: string, room: number): string | null {
  let best: string | null = null;
  for (const separator of TITLE_SEPARATORS) {
    for (let at = title.indexOf(separator); at >= 0; at = title.indexOf(separator, at + 1)) {
      const head = title.slice(0, at).trimEnd();
      if (head.length >= SHORTEST_TITLE && head.length <= room && head.length > (best?.length ?? 0)) best = head;
    }
  }
  return best;
}

/** The orientation as one line, `STATUS_LINE_MAX` characters at most: the lesson, the step (or, on a
 * contest's check question, which check it is), the minutes left, the reviews due, what is expected.
 * The step and what is expected always stay. A long title is cut before its last separator that
 * fits, so that it reads the same from one screen to the next; without one it is cut with « … »; with
 * no room for a readable one it is dropped. */
export function statusLine(o: Orientation, lessonTitle: string, locale: "fr" | "en"): string {
  const w = WORDS[locale];
  const where = o.contest
    ? w.check.replace("{n}", String(o.contest.question)).replace("{total}", String(o.contest.total))
    : w.step.replace("{n}", String(o.step.index)).replace("{total}", String(o.step.total));
  const facts = [
    where,
    ...(o.step.detour ? [w.detour] : []),
    ...(o.minutes_left === undefined ? [] : [w.minutes.replace("{n}", String(o.minutes_left))]),
    ...(o.reviews_due === 0 ? [] : [o.reviews_due === 1 ? w.review : w.reviews.replace("{n}", String(o.reviews_due))]),
    w.waiting[o.waiting],
  ].join(SEPARATOR);
  const title = lessonTitle.trim();
  const room = STATUS_LINE_MAX - facts.length - SEPARATOR.length;
  if (title.length === 0 || room < Math.min(title.length, SHORTEST_TITLE)) return facts.slice(0, STATUS_LINE_MAX);
  const shown = title.length <= room ? title : titleHead(title, room) ?? `${title.slice(0, room - 1).trimEnd()}…`;
  return `${shown}${SEPARATOR}${facts}`;
}
