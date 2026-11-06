// The server's prompts (INT-STUDIUM-058 § 2.6): what may be proposed to a learner during a session.
//
// A proposal asks the learner for a decision (review now, take a break, open the next lesson, look at
// the map, play in forms). The rules are the server's, so that no surface and no agent proposes more
// than the learner agreed to:
//   - never while the learner owes an answer or a self-rating;
//   - a budget per session, set by the attention level the learner chose (0 quiet, 3 normal, 6 coached);
//   - a closed list of kinds and of triggers;
//   - each proposal made once, and its outcome kept: accepted, dismissed, or ignored when the scene
//     (or the session) it belonged to went by without an answer.
// A notice (an adaptation, a resume) is information: always shown, never counted, nothing to answer.
//
// This module holds the rules only. It knows no surface: the label and the action of each proposal
// are added where the view is built.

export const PROMPT_KINDS = ["review_due", "break", "next_lesson", "map_offer", "forms_offer", "resume_notice", "adaptation_notice"] as const;
export type PromptKind = typeof PROMPT_KINDS[number];
/** The kinds that inform and ask nothing. */
export const NOTICE_KINDS: ReadonlySet<PromptKind> = new Set<PromptKind>(["resume_notice", "adaptation_notice"]);

export type PromptAttention = "quiet" | "normal" | "coached";
/** Proposals per session. Starting values (spec § 2.6), to be corrected from the outcomes measured. */
export const PROMPT_BUDGET: Readonly<Record<PromptAttention, number>> = { quiet: 0, normal: 3, coached: 6 };

/** What the lesson waits for from the learner (the orientation's `waiting`). */
export type PromptWaiting = "read" | "answer" | "self_rating" | "run" | "nothing";
export type PromptOutcome = "accepted" | "dismissed" | "ignored";

/** A proposal or a notice a trigger puts forward. `expires`: with its scene, or with the session. */
export interface PromptCandidate {
  id: string;
  kind: PromptKind;
  reason: string;
  expires: "scene" | "session";
}

/** What became of a proposal. `scene_id`: the scene on screen when it was made. */
export interface PromptRecord {
  id: string;
  kind: PromptKind;
  scene_id: string | null;
  outcome: PromptOutcome;
}

/** A candidate the book does not take (an unknown kind, no reason) or an answer to nothing open. */
export class PromptRefusedError extends Error {
  constructor(message: string) { super(message); this.name = "PromptRefusedError"; }
}

interface OpenPrompt { prompt: PromptCandidate; sceneId: string | null }

const KNOWN_KINDS: ReadonlySet<string> = new Set(PROMPT_KINDS);

/** The prompts of one session: which are open, how many proposals were made, what became of each. */
export class PromptBook {
  private level: PromptAttention;
  private readonly made = new Set<string>();
  private proposals = 0;
  private openNow: OpenPrompt[] = [];
  private readonly settled = new Map<string, PromptRecord>();
  private readonly order: string[] = [];

  constructor(attention: PromptAttention = "normal") { this.level = attention; }

  get attention(): PromptAttention { return this.level; }
  /** The learner changed the level: the budget of the session follows, what was made stays counted. */
  setAttention(level: PromptAttention): void { this.level = level; }

  /** Put candidates forward at a moment of the session; returns those shown from now on. A proposal
   * is held back while an answer or a self-rating is owed (it may be put forward again later), is
   * made once per session, and stops at the budget. A notice always goes out. */
  emit(candidates: readonly PromptCandidate[], moment: { waiting: PromptWaiting; sceneId: string | null }): PromptCandidate[] {
    for (const candidate of candidates) {
      if (!KNOWN_KINDS.has(candidate.kind)) throw new PromptRefusedError(`unknown prompt kind "${String(candidate.kind)}"`);
      if (!candidate.id.trim() || !candidate.reason.trim()) throw new PromptRefusedError(`a prompt needs an id and a reason (${candidate.kind})`);
    }
    const busy = moment.waiting === "answer" || moment.waiting === "self_rating";
    const emitted: PromptCandidate[] = [];
    for (const candidate of candidates) {
      if (this.made.has(candidate.id)) continue;
      if (!NOTICE_KINDS.has(candidate.kind)) {
        if (busy || this.proposals >= PROMPT_BUDGET[this.level]) continue;
        this.proposals += 1;
        this.order.push(candidate.id);
      }
      this.made.add(candidate.id);
      this.openNow.push({ prompt: { ...candidate }, sceneId: moment.sceneId });
      emitted.push({ ...candidate });
    }
    return emitted;
  }

  /** What a view shows now: the open proposals and notices, oldest first. */
  open(): PromptCandidate[] { return this.openNow.map(entry => ({ ...entry.prompt })); }

  /** The learner answered a proposal. */
  settle(id: string, outcome: "accepted" | "dismissed"): PromptRecord {
    const entry = this.openNow.find(candidate => candidate.prompt.id === id);
    if (!entry) throw new PromptRefusedError(`no open prompt "${id}"`);
    if (NOTICE_KINDS.has(entry.prompt.kind)) throw new PromptRefusedError(`"${id}" is a notice: there is nothing to accept or dismiss`);
    this.openNow = this.openNow.filter(candidate => candidate !== entry);
    return this.close(entry, outcome);
  }

  /** The scene changed: what was bound to it leaves. A proposal nobody answered is counted ignored. */
  sceneChanged(): PromptRecord[] { return this.expire(entry => entry.prompt.expires === "scene"); }

  /** The session ended: every proposal still open is counted ignored. */
  sessionEnded(): PromptRecord[] { return this.expire(() => true); }

  /** Proposals made in this session, whatever became of them. Notices are not counted. */
  counted(): number { return this.proposals; }

  /** What became of each proposal answered or gone by, in the order they were made. */
  records(): PromptRecord[] {
    return this.order.flatMap(id => { const record = this.settled.get(id); return record ? [{ ...record }] : []; });
  }

  private expire(leaves: (entry: OpenPrompt) => boolean): PromptRecord[] {
    const gone = this.openNow.filter(leaves);
    this.openNow = this.openNow.filter(entry => !leaves(entry));
    return gone.filter(entry => !NOTICE_KINDS.has(entry.prompt.kind)).map(entry => this.close(entry, "ignored"));
  }

  private close(entry: OpenPrompt, outcome: PromptOutcome): PromptRecord {
    const record: PromptRecord = { id: entry.prompt.id, kind: entry.prompt.kind, scene_id: entry.sceneId, outcome };
    this.settled.set(record.id, record);
    return { ...record };
  }
}

/** A notice about the scene it is shown on: one per kind and per scene. */
export function noticeCandidate(kind: "resume_notice" | "adaptation_notice", reason: string, sceneId: string | null): PromptCandidate {
  return { id: `${kind}:${sceneId ?? "session"}`, kind, reason, expires: "scene" };
}

/** What the triggers read. `moment`: the start of a session, a pause between two scenes, the end of
 * a lesson, the end of the session. `breakAfterMinutes`: the length the learner chose, null for none. */
export interface TriggerFacts {
  moment: "session_start" | "pause" | "lesson_end" | "session_end";
  reviewsDue: number;
  minutesInSession: number;
  breakAfterMinutes: number | null;
  surfaceRank: 1 | 2 | 3;
  formsAvailable: boolean;
  hasMap: boolean;
  hasNextLesson: boolean;
  locale: "fr" | "en";
}

const WORDS = {
  fr: {
    review_one: "1 notion à revoir aujourd'hui",
    review_many: "{n} notions à revoir aujourd'hui",
    break: "{n} minutes de séance sans pause",
    next_lesson: "Leçon terminée : une autre leçon de ta bibliothèque peut suivre.",
    map_offer: "Leçon terminée : la carte montre où en est chaque notion.",
    forms_offer: "Cette leçon peut se jouer en formulaires : la réponse suivante arrive sans attendre l'assistant.",
  },
  en: {
    review_one: "1 concept to review today",
    review_many: "{n} concepts to review today",
    break: "{n} minutes in this session without a break",
    next_lesson: "Lesson finished: another lesson of your library can follow.",
    map_offer: "Lesson finished: the map shows where each concept stands.",
    forms_offer: "This lesson can be played in forms: the next answer comes without waiting for the assistant.",
  },
} as const;

/** The proposals the facts of a moment call for. The list of triggers is closed (spec § 2.6): reviews
 * due at the start and at the end of a session; a session longer than the learner chose; the end of
 * a lesson; forms the client could show while the lesson is played in the conversation. Whether each
 * one goes out is the book's decision. */
export function promptCandidates(facts: TriggerFacts): PromptCandidate[] {
  const w = WORDS[facts.locale];
  const count = (text: string, n: number) => text.replace("{n}", String(n));
  const out: PromptCandidate[] = [];
  if (facts.reviewsDue > 0 && (facts.moment === "session_start" || facts.moment === "session_end")) {
    const start = facts.moment === "session_start";
    out.push({
      id: start ? "review_due:start" : "review_due:end", kind: "review_due",
      reason: facts.reviewsDue === 1 ? w.review_one : count(w.review_many, facts.reviewsDue),
      expires: start ? "scene" : "session",
    });
  }
  if (facts.moment === "pause" && facts.breakAfterMinutes !== null && facts.breakAfterMinutes > 0 && facts.minutesInSession >= facts.breakAfterMinutes) {
    const times = Math.floor(facts.minutesInSession / facts.breakAfterMinutes);
    out.push({ id: `break:${times}`, kind: "break", reason: count(w.break, Math.floor(facts.minutesInSession)), expires: "scene" });
  }
  if (facts.moment === "pause" && facts.surfaceRank === 1 && facts.formsAvailable) {
    out.push({ id: "forms_offer", kind: "forms_offer", reason: w.forms_offer, expires: "session" });
  }
  if (facts.moment === "lesson_end") {
    if (facts.hasNextLesson) out.push({ id: "next_lesson", kind: "next_lesson", reason: w.next_lesson, expires: "session" });
    if (facts.hasMap) out.push({ id: "map_offer", kind: "map_offer", reason: w.map_offer, expires: "session" });
  }
  return out;
}
