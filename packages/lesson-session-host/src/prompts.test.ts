// The rules of the server's prompts (INT-STUDIUM-058 § 2.6): what may be proposed to a learner
// during a session, when, how many times, and what became of each proposal.
import { describe, expect, it } from "vitest";
import {
  NOTICE_KINDS, PROMPT_BUDGET, PROMPT_KINDS, PromptBook, PromptRefusedError, noticeCandidate, promptCandidates,
  type PromptCandidate, type TriggerFacts,
} from "./prompts.js";

const READING = { waiting: "read", sceneId: "s1" } as const;
const offer = (id: string, kind: PromptCandidate["kind"] = "break", expires: PromptCandidate["expires"] = "scene"): PromptCandidate =>
  ({ id, kind, reason: `reason of ${id}`, expires });
const FACTS: TriggerFacts = {
  moment: "pause", reviewsDue: 0, minutesInSession: 0, breakAfterMinutes: null, surfaceRank: 3, formsAvailable: false,
  hasMap: false, hasNextLesson: false, locale: "fr",
};

describe("the prompt book of a session", () => {
  it("emits nothing to decide while the learner owes an answer or a self-rating", () => {
    const book = new PromptBook();
    for (const waiting of ["answer", "self_rating"] as const) {
      expect(book.emit([offer("review_due:start", "review_due")], { waiting, sceneId: "q1" })).toEqual([]);
    }
    expect(book.open()).toEqual([]);
    expect(book.counted()).toBe(0);
    // Held back, not lost: the same proposal goes out at the next pause.
    expect(book.emit([offer("review_due:start", "review_due")], READING).map(p => p.id)).toEqual(["review_due:start"]);
    for (const waiting of ["read", "run", "nothing"] as const) {
      expect(new PromptBook().emit([offer("break:1")], { waiting, sceneId: "s1" })).toHaveLength(1);
    }
  });

  it("in quiet mode counts no proposal and still shows the notices of an adaptation and of a resume", () => {
    const book = new PromptBook("quiet");
    const notices = [
      noticeCandidate("adaptation_notice", "Retour sur un prérequis.", "s2"),
      noticeCandidate("resume_notice", "Reprise à l'étape 4.", "s2"),
    ];
    const emitted = book.emit([offer("review_due:start", "review_due"), ...notices, offer("break:1")], READING);
    expect(emitted.map(p => p.kind)).toEqual(["adaptation_notice", "resume_notice"]);
    expect(book.counted()).toBe(0);
    expect(book.open().map(p => p.kind)).toEqual(["adaptation_notice", "resume_notice"]);
    // A notice is information: it is shown while an answer is owed too, and never counted.
    const answering = new PromptBook("quiet");
    expect(answering.emit(notices, { waiting: "answer", sceneId: "q1" })).toHaveLength(2);
    expect(answering.counted()).toBe(0);
    expect(PROMPT_BUDGET).toEqual({ quiet: 0, normal: 3, coached: 6 });
  });

  it("in normal mode does not emit the fourth proposal of the session; notices are not counted", () => {
    const book = new PromptBook("normal");
    const ids = ["review_due:start", "break:1", "forms_offer", "break:2"];
    const emitted = ids.flatMap(id => book.emit([offer(id)], READING).map(p => p.id));
    expect(emitted).toEqual(["review_due:start", "break:1", "forms_offer"]);
    expect(book.counted()).toBe(3);
    expect(book.emit([noticeCandidate("adaptation_notice", "Une notion a été sautée.", "s1")], READING)).toHaveLength(1);
    expect(book.counted()).toBe(3);
    // Coached mode has six; turning the level up lets the next ones out, turning it down stops them.
    book.setAttention("coached");
    expect(book.emit([offer("break:2"), offer("break:3"), offer("break:4"), offer("break:5")], READING).map(p => p.id)).toEqual(["break:2", "break:3", "break:4"]);
    expect(book.counted()).toBe(6);
    book.setAttention("quiet");
    expect(book.emit([offer("break:6")], READING)).toEqual([]);
  });

  it("emits a proposal once: the same id is not proposed twice in a session", () => {
    const book = new PromptBook();
    expect(book.emit([offer("forms_offer", "forms_offer", "session")], READING)).toHaveLength(1);
    expect(book.emit([offer("forms_offer", "forms_offer", "session")], READING)).toEqual([]);
    expect(book.counted()).toBe(1);
  });

  it("counts a proposal left without an answer when the scene changes as ignored", () => {
    const book = new PromptBook();
    book.emit([offer("review_due:start", "review_due"), offer("forms_offer", "forms_offer", "session"),
      noticeCandidate("adaptation_notice", "Retour sur un prérequis.", "s1")], READING);
    expect(book.settle("forms_offer", "dismissed")).toMatchObject({ id: "forms_offer", outcome: "dismissed" });
    expect(book.sceneChanged()).toEqual([{ id: "review_due:start", kind: "review_due", scene_id: "s1", outcome: "ignored" }]);
    expect(book.open()).toEqual([]);                                 // the notice left with its scene, unrecorded
    expect(book.records()).toEqual([
      { id: "review_due:start", kind: "review_due", scene_id: "s1", outcome: "ignored" },
      { id: "forms_offer", kind: "forms_offer", scene_id: "s1", outcome: "dismissed" },
    ]);
    // A proposal bound to the session stays open across scenes, and is ignored when the session ends.
    book.emit([offer("review_due:end", "review_due", "session")], { waiting: "nothing", sceneId: null });
    expect(book.sceneChanged()).toEqual([]);
    expect(book.open().map(p => p.id)).toEqual(["review_due:end"]);
    expect(book.sessionEnded()).toEqual([{ id: "review_due:end", kind: "review_due", scene_id: null, outcome: "ignored" }]);
    expect(book.counted()).toBe(3);                                  // ignored proposals were made: they stay counted
  });

  it("records an accepted proposal, and refuses to settle one it does not hold open", () => {
    const book = new PromptBook();
    book.emit([offer("break:1")], READING);
    expect(book.settle("break:1", "accepted")).toEqual({ id: "break:1", kind: "break", scene_id: "s1", outcome: "accepted" });
    expect(() => book.settle("break:1", "dismissed")).toThrow(PromptRefusedError);
    expect(() => book.settle("unknown", "accepted")).toThrow(PromptRefusedError);
    // A notice asks nothing: there is nothing to accept or dismiss.
    book.emit([noticeCandidate("resume_notice", "Reprise.", "s1")], READING);
    expect(() => book.settle("resume_notice:s1", "accepted")).toThrow(PromptRefusedError);
  });

  it("holds a closed list of kinds: an unknown kind is refused", () => {
    expect([...PROMPT_KINDS]).toEqual(["review_due", "break", "next_lesson", "map_offer", "forms_offer", "resume_notice", "adaptation_notice"]);
    expect([...NOTICE_KINDS]).toEqual(["resume_notice", "adaptation_notice"]);
    const book = new PromptBook();
    expect(() => book.emit([{ id: "x", kind: "streak" as never, reason: "Dix jours de suite !", expires: "scene" }], READING)).toThrow(PromptRefusedError);
    expect(() => book.emit([{ id: "y", kind: "break", reason: " ", expires: "scene" }], READING)).toThrow(/reason/);
    expect(book.open()).toEqual([]);
  });
});

describe("what triggers a proposal", () => {
  it("reviews due at the start of a session: « 3 notions à revoir aujourd'hui »", () => {
    expect(promptCandidates({ ...FACTS, moment: "session_start", reviewsDue: 3 })).toEqual([
      { id: "review_due:start", kind: "review_due", reason: "3 notions à revoir aujourd'hui", expires: "scene" },
    ]);
    expect(promptCandidates({ ...FACTS, moment: "session_start", reviewsDue: 1 })[0]?.reason).toBe("1 notion à revoir aujourd'hui");
    expect(promptCandidates({ ...FACTS, moment: "session_start", reviewsDue: 3, locale: "en" })[0]?.reason).toBe("3 concepts to review today");
    expect(promptCandidates({ ...FACTS, moment: "session_start", reviewsDue: 0 })).toEqual([]);
    // The start of a session may have waited for an answer: the first pause puts them forward again.
    expect(promptCandidates({ ...FACTS, moment: "pause", reviewsDue: 2 })).toEqual([
      { id: "review_due:start", kind: "review_due", reason: "2 notions à revoir aujourd'hui", expires: "scene" },
    ]);
    expect(promptCandidates({ ...FACTS, moment: "pause", reviewsDue: 0 })).toEqual([]);
    // Again when the session ends.
    expect(promptCandidates({ ...FACTS, moment: "session_end", reviewsDue: 2 })).toEqual([
      { id: "review_due:end", kind: "review_due", reason: "2 notions à revoir aujourd'hui", expires: "session" },
    ]);
  });

  it("a break once the session has run past the length the learner chose, and again at each multiple", () => {
    expect(promptCandidates({ ...FACTS, minutesInSession: 50, breakAfterMinutes: null })).toEqual([]);
    expect(promptCandidates({ ...FACTS, minutesInSession: 24, breakAfterMinutes: 25 })).toEqual([]);
    expect(promptCandidates({ ...FACTS, minutesInSession: 26, breakAfterMinutes: 25 })).toEqual([
      { id: "break:1", kind: "break", reason: "26 minutes de séance sans pause", expires: "scene" },
    ]);
    expect(promptCandidates({ ...FACTS, minutesInSession: 51, breakAfterMinutes: 25, locale: "en" })).toEqual([
      { id: "break:2", kind: "break", reason: "51 minutes in this session without a break", expires: "scene" },
    ]);
  });

  it("the next lesson and the map when a lesson ends", () => {
    expect(promptCandidates({ ...FACTS, moment: "lesson_end" })).toEqual([]);
    expect(promptCandidates({ ...FACTS, moment: "lesson_end", hasNextLesson: true, hasMap: true }).map(p => [p.id, p.kind, p.expires])).toEqual([
      ["next_lesson", "next_lesson", "session"], ["map_offer", "map_offer", "session"],
    ]);
    expect(promptCandidates({ ...FACTS, moment: "pause", hasNextLesson: true, hasMap: true })).toEqual([]);
  });

  it("forms, once, when the lesson is played in the conversation and the client can show forms", () => {
    expect(promptCandidates({ ...FACTS, surfaceRank: 1, formsAvailable: true })).toEqual([
      { id: "forms_offer", kind: "forms_offer", reason: "Cette leçon peut se jouer en formulaires : la réponse suivante arrive sans attendre l'assistant.", expires: "session" },
    ]);
    expect(promptCandidates({ ...FACTS, moment: "session_start", surfaceRank: 1, formsAvailable: true }).map(p => p.id)).toEqual(["forms_offer"]);
    expect(promptCandidates({ ...FACTS, moment: "lesson_end", surfaceRank: 1, formsAvailable: true })).toEqual([]);
    expect(promptCandidates({ ...FACTS, surfaceRank: 1, formsAvailable: false })).toEqual([]);
    expect(promptCandidates({ ...FACTS, surfaceRank: 2, formsAvailable: true })).toEqual([]);
    // The book emits the id once, so the trigger may fire at every pause.
    const book = new PromptBook();
    const again = () => book.emit(promptCandidates({ ...FACTS, surfaceRank: 1, formsAvailable: true }), READING);
    expect(again()).toHaveLength(1);
    expect(again()).toEqual([]);
  });

  it("every trigger's words exist in both languages and differ", () => {
    const all = (locale: "fr" | "en") => [
      ...promptCandidates({ ...FACTS, moment: "session_start", reviewsDue: 2, locale }),
      ...promptCandidates({ ...FACTS, minutesInSession: 30, breakAfterMinutes: 25, surfaceRank: 1, formsAvailable: true, locale }),
      ...promptCandidates({ ...FACTS, moment: "lesson_end", hasNextLesson: true, hasMap: true, locale }),
    ];
    const fr = all("fr"), en = all("en");
    expect(fr.map(p => p.kind)).toEqual(["review_due", "break", "forms_offer", "next_lesson", "map_offer"]);
    expect(en.map(p => p.id)).toEqual(fr.map(p => p.id));
    fr.forEach((prompt, i) => { expect(prompt.reason).not.toBe(en[i]!.reason); expect(prompt.reason.trim().length).toBeGreaterThan(10); });
  });
});
