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

describe("L-10 — a choice id followed by the learner's reason (RFR-11, R-en-08)", () => {
  it.each([
    "b, je dirais le glucose et l'oxygène",
    "b - 42 is bigger than 17 so it can only be after it",
    "b) parce que la liaison est polaire",
    "b: the bond is polar",
    "B. Because the bond is polar",
    "b because it is a reduction",
    "b car il y a deux liaisons",
    "(b) since a molecule needs it",
    "I think it's b, because the bond is polar",
    "je dirais b, car la liaison est polaire",
    "Je pense que c'est la b.",
    "Option b, because a molecule needs it",
    "réponse b : il y a trois atomes",
  ])("reads the leading or named id in %j", (text) => {
    expect(replyToInput(quiz, text)).toEqual({ kind: "quiz_choice", choiceId: "b" });
  });

  it.each(["a, b", "a ou b", "b or c", "b, ou peut-être c", "c'est b ou c", "b - no wait, c", "a/b", "b et d", "b, a et c sont fausses"])(
    "refuses %j, which names more than one choice, keeping the refusal's first words", (text) => {
      expect(() => replyToInput(quiz, text)).toThrow(ResponseInputError);
      expect(() => replyToInput(quiz, text)).toThrow(/^this quiz takes one of the displayed choice ids: a, b, c, d; this reply names more than one/);
    });

  it("refuses a reason that names no displayed id at its head or after « it's », « c'est », « je dirais »", () => {
    // « Trois, comme dans la question a. » answers by the text of b and mentions « a » in passing: it is
    // refused rather than graded as a.
    for (const text of ["e, because", "je pense que c'est juste", "the bond is polar", "Trois, comme dans la question a."]) {
      expect(() => replyToInput(quiz, text)).toThrow(/^this quiz takes one of the displayed choice ids: a, b, c, d; reply with the learner's letter/);
    }
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

// Pass of 10 Nov 2026 (usages-apprenant D1, D3, D4, D7, difficulties 1 and 2).
const DECK4 = [{ token: "d0", text: "w" }, { token: "d1", text: "x" }, { token: "d2", text: "y" }, { token: "d3", text: "z" }];
const flagged = (...ns: number[]) => ({ kind: "flaw_verdicts", verdicts: DECK4.map((d, i) => ({ token: d.token, flagged: ns.includes(i + 1) })) });
const quiz30 = {
  id: "q", type: "quiz", title: "Q", question: "Combien ?",
  choices: [
    { id: "a", text: "12 neutrons", correct: false }, { id: "b", text: "30 neutrons", correct: true },
    { id: "c", text: "Le carbone", correct: false }, { id: "d", text: "Le carbone et l'oxygène", correct: false },
  ],
} as never;
const reading = { id: "i", type: "intro" } as never;

describe("D1 — a verdict deck reads « none flagged » only from the whole reply", () => {
  it.each([
    "aucune", "aucun", "Aucune erreur", "aucune n'est fausse", "aucune fausse", "rien à signaler", "toutes justes",
    "toutes sont justes", "none", "None are wrong", "none is wrong", "nothing wrong", "all correct", "all right",
    "all sound", "they are all correct", "Aucune.", "none!",
  ])("accepts %j as no claim flagged", (text) => {
    expect(replyToInput(deck, text, DECK4)).toEqual(flagged());
  });

  it.each(["aucune idée", "rien compris", "none of them look right to me", "nothing makes sense", "none?", "aucune ?"])(
    "refuses %j, which is not a verdict", (text) => {
      expect(() => replyToInput(deck, text, DECK4)).toThrow(ResponseInputError);
      expect(() => replyToInput(deck, text, DECK4)).toThrow(/^this deck numbers its claims 1 to 4/);
    });

  it.each(["je ne sais pas", "aucune idée", "I don't know", "no idea", "pas compris"])(
    "refuses %j without pushing to guess, saying the claims are not judged yet and how to answer", (text) => {
      expect(() => replyToInput(deck, text, DECK4)).toThrow(
        /^this deck numbers its claims 1 to 4: the learner has not judged the claims yet.*numbers of the claims judged wrong.*« aucune »/);
    });

  it.each([
    ["la 2 et la 3", [2, 3]], ["2, 3", [2, 3]], ["claims 2 and 4", [2, 4]],
    ["les affirmations 2 et 4 sont fausses", [2, 4]], ["2 and 4 are wrong", [2, 4]], ["1", [1]],
  ])("reads %j as the claims judged wrong", (text, ns) => {
    expect(replyToInput(deck, text, DECK4)).toEqual(flagged(...(ns as number[])));
  });

  it.each([
    "2, mais pas sûr de la 3", "pas la 2", "2 sauf la 3", "peut-être la 2", "j'hésite entre 2 et 3", "not 2", "2 except 3",
    "unsure about 2", "maybe 2 and 3", "2 ?", "la 2 et la 3 sont justes", "2 and 3 are right",
  ])("refuses %j, which carries a negation, a doubt or the opposite verdict", (text) => {
    expect(() => replyToInput(deck, text, DECK4)).toThrow(ResponseInputError);
    expect(() => replyToInput(deck, text, DECK4)).toThrow(/send the numbers alone/);
  });

  it("refuses a reply whose reason carries other numbers, saying to send the numbers alone", () => {
    expect(() => replyToInput(deck, "la 1 car la demi-vie de 1.6 s", DECK4)).toThrow(/^this deck numbers its claims 1 to 4.*send the numbers alone/);
    expect(() => replyToInput(deck, "2 car 42 est trop grand", DECK4)).toThrow(/send the numbers alone/);
  });

  it("never reads a decimal or an out-of-range number as a claim number", () => {
    expect(() => replyToInput(deck, "1.6", DECK4)).toThrow(ResponseInputError);
    expect(() => replyToInput(deck, "0", DECK4)).toThrow(/^this deck numbers its claims 1 to 4/);
    expect(() => replyToInput(deck, "2 et 7", DECK4)).toThrow(/^this deck numbers its claims 1 to 4/);
  });
});

describe("D3 — a written answer cannot be empty", () => {
  const written = ["ai_critique", "spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim"];
  it.each(written)("refuses an empty or blank reply on a %s scene", (type) => {
    for (const text of ["", "   ", "\n\t "]) {
      expect(() => replyToInput({ id: "s", type } as never, text)).toThrow(ResponseInputError);
      expect(() => replyToInput({ id: "s", type } as never, text)).toThrow(/^this step takes the learner's own words; nothing was recorded/);
    }
  });

  it.each(["critique", "flaw_report", "explanation", "comparison", "summary_audit", "prompt_submission", "communication"])(
    "refuses an empty or blank typed %s in one line", (kind) => {
      for (const text of ["", "   "]) {
        expect(() => checkDisplayedChoice(quiz, { kind, text } as never)).toThrow(/^this step takes the learner's own words; nothing was recorded/);
      }
      expect(checkDisplayedChoice(quiz, { kind, text: "x" } as never)).toEqual({ kind, text: "x" });
    });

  it("refuses an empty reply on a quiz and a deck, which grade nothing", () => {
    expect(() => replyToInput(quiz, "  ")).toThrow(/^this quiz takes one of the displayed choice ids/);
    expect(() => replyToInput(deck, "", DECK4)).toThrow(/^this deck numbers its claims/);
  });
});

describe("D4 — a confidence relayed with reply reaches the produced input", () => {
  it("carries a valid confidence to a quiz_choice, a flaw_verdicts and a written kind", () => {
    expect(replyToInput(quiz, "b", undefined, 4)).toEqual({ kind: "quiz_choice", choiceId: "b", confidence: 4 });
    expect(replyToInput(quiz, "b", undefined, 0)).toEqual({ kind: "quiz_choice", choiceId: "b", confidence: 0 });
    expect(replyToInput(deck, "2", DECK4, 3)).toEqual({ ...flagged(2), confidence: 3 });
    expect(replyToInput({ id: "e", type: "explain_back" } as never, "Parce que", undefined, 2))
      .toEqual({ kind: "explanation", text: "Parce que", confidence: 2 });
  });

  it("does not parse a confidence out of the text", () => {
    expect(replyToInput(quiz, "b, sûr à 80 %")).toEqual({ kind: "quiz_choice", choiceId: "b" });
  });

  it("ignores a confidence on a scene whose input takes none", () => {
    expect(replyToInput(meta, "3", undefined, 2)).toEqual({ kind: "confidence", value: 3 });
    expect(replyToInput(reading, "ok", undefined, 2)).toEqual({ kind: "ack" });
  });

  it.each([5, -1, 2.5, Number.NaN])("refuses the confidence %s as typed inputs do", (value) => {
    expect(() => replyToInput(quiz, "b", undefined, value)).toThrow(/^a confidence is an integer from 0 to 4/);
  });
});

describe("D7 — before and after are read from their labels, whatever the order", () => {
  it.each([
    ["après 3, avant 1", 1, 3], ["avant 1, après 3", 1, 3], ["je dirais 3/4 maintenant contre 1 au début", 1, 3],
    ["1 au début, 3 maintenant", 1, 3], ["before 4, after 2", 4, 2], ["after 2, before 4", 4, 2],
    ["now 1, initially 3", 3, 1], ["pre 2 post 4", 2, 4], ["post 4 pre 2", 2, 4],
  ])("reads %j as pre %i, post %i", (text, pre, post) => {
    expect(replyToInput(meta, text)).toEqual({ kind: "confidence", pre, post });
  });

  it.each(["avant 1, avant 3", "après 1, après 3", "avant 1, 3", "1, après 3", "avant et après 1 et 3"])(
    "refuses %j, whose labels conflict or cover one number of two", (text) => {
      expect(() => replyToInput(meta, text)).toThrow(/^this checkpoint takes a confidence from 0 to 4/);
    });

  it.each(["1 puis 3", "1, 3", "1 et 3", "1 then 3"])("reads %j, which carries no label, as the before then the after", (text) => {
    expect(replyToInput(meta, text)).toEqual({ kind: "confidence", pre: 1, post: 3 });
  });

  it("keeps one number as a value, labelled or not", () => {
    expect(replyToInput(meta, "maintenant 3")).toEqual({ kind: "confidence", value: 3 });
  });
});

describe("Difficulty 1 — a quiz reply with a common hedge around one choice id", () => {
  it.each([
    "la b je crois", "plutôt b", "b je pense", "d'après moi a", "je dirais c", "I think b", "probably c",
    "Plutôt la c", "c je crois bien", "I'd say c", "je dirais a", "answer a", "option a", "réponse a", "la a", "a",
  ])("reads %j as one choice", (text) => {
    const id = /(?:^|\s)([abc])(?=\s|$)/.exec(text.toLowerCase())?.[1];
    expect(replyToInput(quiz, text)).toEqual({ kind: "quiz_choice", choiceId: id });
  });

  it("does not read the verb or the article « a » as a choice", () => {
    for (const text of ["il y a des atomes", "probably a molecule", "plutôt a ce qu'il me semble", "I think a molecule is needed", "elle a plutôt raison"]) {
      expect(() => replyToInput(quiz, text)).toThrow(/^this quiz takes one of the displayed choice ids: a, b, c, d; reply with the learner's letter/);
    }
  });

  it.each(["pas b", "not b", "surtout pas c", "ce n'est pas b", "I do not think it is b"])("refuses the negation %j", (text) => {
    expect(() => replyToInput(quiz, text)).toThrow(ResponseInputError);
  });

  it("reads a reply contained in exactly one choice's text, or containing exactly one choice's full text", () => {
    expect(replyToInput(quiz30, "30 neutrons")).toEqual({ kind: "quiz_choice", choiceId: "b" });
    expect(replyToInput(quiz30, "je dirais 30 neutrons")).toEqual({ kind: "quiz_choice", choiceId: "b" });
    expect(replyToInput(quiz30, "12 neutrons je crois")).toEqual({ kind: "quiz_choice", choiceId: "a" });
    expect(replyToInput(quiz30, "l'oxygène")).toEqual({ kind: "quiz_choice", choiceId: "d" });
  });

  it("refuses a text shared by two choices with the « names more than one » refusal", () => {
    expect(() => replyToInput(quiz30, "carbone")).toThrow(/^this quiz takes one of the displayed choice ids: a, b, c, d; this reply names more than one \(c, d\)/);
    expect(() => replyToInput(quiz30, "12 neutrons ou 30 neutrons")).toThrow(/names more than one/);
  });

  it("refuses a negated or too short text", () => {
    expect(() => replyToInput(quiz30, "pas 30 neutrons")).toThrow(/reply with the learner's letter/);
    expect(() => replyToInput(quiz30, "ne")).toThrow(/reply with the learner's letter/);
    expect(() => replyToInput(quiz30, "le")).toThrow(/reply with the learner's letter/);
  });
});

describe("Difficulty 2 — « I do not know » has a way out that is not a guess", () => {
  it.each(["je ne sais pas", "aucune idée", "I don't know", "no idea", "pas compris", "je n'ai pas compris", "I do not know"])(
    "refuses %j at a quiz, naming request_hint", (text) => {
      const quizNoIdea = { ...(quiz as object), choices: (quiz as unknown as { choices: unknown[] }).choices.slice(0, 3) } as never;
      expect(() => replyToInput(quizNoIdea, text)).toThrow(
        /^this quiz takes one of the displayed choice ids: a, b, c; the learner has not answered yet: .*request_hint \{session_id\}.*then ask for their answer/);
    });

  it("keeps a quiz choice whose own text says « Aucune idée »", () => {
    expect(replyToInput(quiz, "aucune idée")).toEqual({ kind: "quiz_choice", choiceId: "d" });
  });

  it.each([
    "Attends, je n'ai pas compris ce qu'est une orbitale", "non", "No", "wait", "attendez", "pas encore", "not yet", "stop",
    "je n'ai pas compris", "I don't understand", "C'est quoi une orbitale ?", "why?",
  ])("refuses %j on a reading scene: the learner is not ready or asked something", (text) => {
    expect(() => replyToInput(reading, text)).toThrow(ResponseInputError);
    expect(() => replyToInput(reading, text)).toThrow(/^this screen is for reading.*« continuer »/);
  });

  it.each(["ok", "continuer", "d'accord", "oui", "Suite", "yes", "next", "noted", "nothing to add"])(
    "keeps acknowledging %j on a reading scene", (text) => {
      expect(replyToInput(reading, text)).toEqual({ kind: "ack" });
    });
});
