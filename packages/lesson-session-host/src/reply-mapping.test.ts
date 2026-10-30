// packages/lesson-session-host/src/reply-mapping.test.ts
//
// HJ-4: `submit_response {kind: "reply", text}` takes the learner's words as typed in a chat and the
// host turns them into the current scene's input — the letter of a quiz choice, a 0–4 confidence,
// the numbers of the claims judged wrong, or the text itself. A reply that cannot be read is refused
// in one line that says what the scene takes; nothing is graded on a guess. An explicit quiz_choice
// must name a displayed id: an unknown one used to be graded as a wrong answer.
import { describe, it, expect } from "vitest";
import { replyToInput, checkDisplayedChoice, ResponseInputError } from "./reply-mapping.js";

const quiz = {
  id: "q", type: "quiz", title: "Q", question: "Combien ?",
  choices: [
    { id: "a", text: "Deux", correct: false }, { id: "b", text: "Trois", correct: true },
    { id: "c", text: "Quatre", correct: false }, { id: "d", text: "Aucune idée", correct: false },
  ],
} as never;
const meta = { id: "m", type: "meta_checkpoint", pre_question: "?", post_question: "?" } as never;
const deck = { id: "f", type: "spot_the_flaw" } as never;
const DECK = [{ token: "d0", text: "x" }, { token: "d1", text: "y" }, { token: "d2", text: "z" }];

describe("replyToInput", () => {
  it.each(["b", "B", "b)", "(b)", " b. ", "réponse b", "Answer: b", "option B", "je choisis b"])(
    "reads the quiz letter in %j", (text) => {
      expect(replyToInput(quiz, text)).toEqual({ kind: "quiz_choice", choiceId: "b" });
    });

  it("reads a quiz reply that repeats a choice's text", () => {
    expect(replyToInput(quiz, "  trois ")).toEqual({ kind: "quiz_choice", choiceId: "b" });
  });

  it("refuses, in one line naming the displayed ids, a reply that names no choice", () => {
    for (const text of ["e", "je ne sais pas", "a ou b"]) {
      expect(() => replyToInput(quiz, text)).toThrow(ResponseInputError);
      expect(() => replyToInput(quiz, text)).toThrow(/^this quiz takes one of the displayed choice ids: a, b, c, d/);
    }
  });

  it("reads a confidence from 0 to 4, or a pre and a post", () => {
    expect(replyToInput(meta, "3")).toEqual({ kind: "confidence", value: 3 });
    expect(replyToInput(meta, "plutôt 2 sur 4")).toEqual({ kind: "confidence", value: 2 });
    expect(replyToInput(meta, "avant 1, après 3")).toEqual({ kind: "confidence", pre: 1, post: 3 });
    expect(() => replyToInput(meta, "7")).toThrow(/^this checkpoint takes a confidence from 0 to 4/);
    expect(() => replyToInput(meta, "beaucoup")).toThrow(/0 to 4/);
  });

  it("reads the numbers of the claims judged wrong in a verdict deck, none for « aucune »", () => {
    expect(replyToInput(deck, "1, 3", DECK)).toEqual({ kind: "flaw_verdicts", verdicts: [
      { token: "d0", flagged: true }, { token: "d1", flagged: false }, { token: "d2", flagged: true },
    ] });
    for (const none of ["aucune", "None", "toutes sont justes"]) {
      expect(replyToInput(deck, none, DECK)).toEqual({ kind: "flaw_verdicts",
        verdicts: DECK.map((d) => ({ token: d.token, flagged: false })) });
    }
    expect(() => replyToInput(deck, "4", DECK)).toThrow(/^this deck numbers its claims 1 to 3/);
  });

  it("passes the learner's words through on a free-text scene, and acknowledges a reading", () => {
    expect(replyToInput({ id: "e", type: "explain_back" } as never, "Parce que…")).toEqual({ kind: "explanation", text: "Parce que…" });
    expect(replyToInput({ id: "s", type: "spot_the_flaw" } as never, "Unités")).toEqual({ kind: "flaw_report", text: "Unités" });
    expect(replyToInput({ id: "i", type: "intro" } as never, "ok")).toEqual({ kind: "ack" });
  });

  it("moves a discussion on with « continuer », and sends an argument to submit_turn", () => {
    expect(replyToInput({ id: "d", type: "discussion" } as never, "continuer")).toEqual({ kind: "ack" });
    expect(() => replyToInput({ id: "d", type: "discussion" } as never, "Je pense que…")).toThrow(/submit_turn/);
  });
});

describe("checkDisplayedChoice", () => {
  it("accepts a displayed id, whatever its case, and normalizes it", () => {
    expect(checkDisplayedChoice(quiz, { kind: "quiz_choice", choiceId: "C" })).toEqual({ kind: "quiz_choice", choiceId: "c" });
    expect(checkDisplayedChoice(quiz, { kind: "quiz_choice", choiceId: "a", confidence: 2 }))
      .toEqual({ kind: "quiz_choice", choiceId: "a", confidence: 2 });
  });

  it("refuses an id the quiz does not display, instead of grading it wrong", () => {
    expect(() => checkDisplayedChoice(quiz, { kind: "quiz_choice", choiceId: "s2-b" }))
      .toThrow(/^quiz_choice "s2-b" is not a displayed choice id: a, b, c, d/);
  });

  it("refuses a quiz_choice without an id in one line, naming the displayed ids", () => {
    // The file and HTTP channels pass inputs the MCP schema never checked.
    expect(() => checkDisplayedChoice(quiz, { kind: "quiz_choice" } as never))
      .toThrow(/^quiz_choice needs choiceId, one of the displayed choice ids: a, b, c, d$/);
  });

  it("refuses an id-less quiz_choice on a scene that is not a quiz, saying how to answer it", () => {
    expect(() => checkDisplayedChoice({ id: "e", type: "explain_back" } as never, { kind: "quiz_choice" } as never))
      .toThrow(/^quiz_choice answers a quiz, and this scene is a explain_back: send the learner's words as \{kind: "reply", text\}$/);
  });

  it("leaves any other scene or input alone", () => {
    const input = { kind: "explanation" as const, text: "x" };
    expect(checkDisplayedChoice(quiz, input)).toBe(input);
    expect(checkDisplayedChoice({ id: "i", type: "intro" } as never, { kind: "quiz_choice", choiceId: "z" }))
      .toEqual({ kind: "quiz_choice", choiceId: "z" });
  });
});
