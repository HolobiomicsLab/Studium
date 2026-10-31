// packages/lesson-session-host/src/reply-mapping.ts
//
// `{kind: "reply", text}` (HJ-4): the learner's words as typed in a chat, turned into the input the
// current scene takes — the way the file channel maps a bare `{text}` (session-workspace.ts), but
// reading the reply itself where the scene needs a choice: a quiz letter, a 0–4 confidence, the
// numbers of the claims judged wrong. A reply that cannot be read is refused in one line saying what
// the scene takes, rather than graded on a guess.
//
// L-10 (RFR-11, R-en-08): a quiz reply may give the letter, then the learner's reason — « b, je dirais
// le glucose », "b - 42 is bigger", « b) parce que… », "b because…", "I think it's b, …" — and is read
// when it names exactly one displayed id where a reply names its choice (its head, or after « c'est »,
// "it's", « je dirais »…); a reply naming two ids (« a ou b », "b - no wait, c") is refused, never
// graded on a guess.
//
// `checkDisplayedChoice` closes the matching hole on an explicit quiz_choice: the grader marks any id
// it does not know as a wrong answer, so a stale or source id silently cost the learner an attempt.
import type { ResponseInput } from "@studium/lesson-session";
import type { Scene } from "@studium/lesson-bundle-schema";
import { FREE_TEXT_KIND } from "./operator-context.js";
import type { UnnamedQuizChoice } from "./response-input-schema.js";

export class ResponseInputError extends Error {
  constructor(message: string) { super(message); this.name = "ResponseInputError"; }
}

type DeckToken = { token: string };
type Choice = { id: string; text: string };

/** Lower-case, accents kept, surrounding punctuation and quotes dropped. */
function normalize(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/^[\s()[\]."'«»“”:*_—–-]+|[\s()[\]."'«»“”:*_—–!?-]+$/g, "");
}

// « réponse b », « Answer: b », « option B », « je choisis b » — a cue word, then the id alone.
const CHOICE_CUE = /^(?:ma\s+)?(?:r[ée]ponse|answer|option|choix|choice|lettre|letter|je\s+choisis|i\s+choose|i\s+pick)\s*[:\-–]?\s*\(?([\p{L}\p{N}_-]+)\)?$/u;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An id named as a choice is a token of its own (« c'est » holds no « c »)…
const TOKEN_START = String.raw`(?<![\p{L}\p{N}_'’-])`;
// …followed by the end of the reply, a punctuation mark, a dash, or a word that gives a reason or
// another option (so « a » in "a molecule" or « il y a deux » names nothing).
const AFTER_CHOICE = String.raw`(?=\s*(?:$|[,;:.!?)/]|[-–—](?:\s|$))|\s+(?:or|ou|and|et|because|car|parce|puisque|since|as|but|mais)\b)`;
// Where a reply names its choice: its head, or after « c'est », "it's", « je dirais », "answer"…
const CHOICE_HEAD = String.raw`(?:^|\b(?:it['’]?s|it\s+is|is|c['’]est|est|answer|r[ée]ponse|option|choice|choix|letter|lettre|choose|choisis|pick|say|dirais|dis|think|pense|crois|go\s+with|prends|opte\s+pour)\s*(?:[:\-–]\s*)?(?:(?:the|la|le|option|choice|choix|answer|r[ée]ponse|letter|lettre)\s+)*)`;

/** L-10: the displayed ids a reply names, where it names its choice (`chosen`) and anywhere (`named`). */
function namedChoices(choices: readonly Choice[], text: string): { chosen: Choice[]; named: Choice[] } {
  const reply = text.normalize("NFKC").trim().toLowerCase().replace(/^[\s([."'«»“”*_]+/u, "");
  const chosen: Choice[] = [];
  const named: Choice[] = [];
  for (const choice of choices) {
    const id = escapeRegExp(choice.id.toLowerCase());
    if (new RegExp(`${CHOICE_HEAD}\\s*${TOKEN_START}${id}${AFTER_CHOICE}`, "u").test(reply)) chosen.push(choice);
    if (new RegExp(`${TOKEN_START}${id}${AFTER_CHOICE}`, "u").test(reply)) named.push(choice);
  }
  return { chosen, named };
}

function quizChoice(scene: { choices?: Choice[] }, text: string): ResponseInput {
  const choices = scene.choices ?? [];
  const reply = normalize(text);
  const ids = choices.map((c) => c.id).join(", ");
  const byId = (id: string | undefined) => (id === undefined ? undefined : choices.find((c) => c.id.toLowerCase() === id));
  let choice = byId(reply) ?? byId(CHOICE_CUE.exec(reply)?.[1]) ?? choices.find((c) => normalize(c.text) === reply);
  if (!choice) {
    // L-10: the letter, then the learner's reason — read only when it names one displayed id.
    const { chosen, named } = namedChoices(choices, text);
    const all = [...new Set([...chosen, ...named])];
    if (all.length > 1) {
      throw new ResponseInputError(`this quiz takes one of the displayed choice ids: ${ids}; this reply names more ` +
        `than one (${all.map((c) => c.id).join(", ")}): reply with the learner's one letter`);
    }
    if (chosen.length === 1) choice = chosen[0];
  }
  if (!choice) {
    throw new ResponseInputError(`this quiz takes one of the displayed choice ids: ${ids}; reply with the learner's letter`);
  }
  return { kind: "quiz_choice", choiceId: choice.id };
}

type Confidence = 0 | 1 | 2 | 3 | 4;
const isConfidence = (n: number): n is Confidence => Number.isInteger(n) && n >= 0 && n <= 4;

function confidence(text: string): ResponseInput {
  // « 2 sur 4 », « 2/4 », « 2 out of 4 » name the scale, not a second rating.
  const numbers = (text.replace(/(?:sur|\/|out\s+of)\s*4\b/giu, " ").match(/\d+/g) ?? []).map(Number);
  const refuse = () => new ResponseInputError("this checkpoint takes a confidence from 0 to 4 (or a before and an after, 0 to 4 each)");
  if (numbers.length === 1 && isConfidence(numbers[0]!)) return { kind: "confidence", value: numbers[0]! };
  if (numbers.length === 2 && isConfidence(numbers[0]!) && isConfidence(numbers[1]!)) {
    return { kind: "confidence", pre: numbers[0]!, post: numbers[1]! };
  }
  throw refuse();
}

const NONE_FLAGGED = /^(?:aucun|aucune|none|rien|nothing|toutes?\b.*\bjustes?|all\b.*\b(?:right|correct|sound))/u;

function deckVerdicts(deck: readonly DeckToken[], text: string): ResponseInput {
  const reply = normalize(text);
  const numbers = (reply.match(/\d+/g) ?? []).map(Number);
  const range = `this deck numbers its claims 1 to ${deck.length}: reply with the numbers of the claims the learner judges wrong, or « aucune »`;
  if (!numbers.length && !NONE_FLAGGED.test(reply)) throw new ResponseInputError(range);
  if (numbers.some((n) => n < 1 || n > deck.length)) throw new ResponseInputError(range);
  const flagged = new Set(numbers.map((n) => n - 1));
  return { kind: "flaw_verdicts", verdicts: deck.map((d, i) => ({ token: d.token, flagged: flagged.has(i) })) };
}

const MOVE_ON = /^(?:continuer|continue|suivant|suite|next|ok|okay|d'accord|passer|on continue)$/u;

/**
 * The input the current scene takes, read from a chat reply. `deck` is the scene's displayed verdict
 * deck when it has one (publicScene computes it). Throws ResponseInputError when the reply does not
 * say what the scene needs.
 */
export function replyToInput(scene: Scene, text: string, deck?: readonly DeckToken[]): ResponseInput {
  const type = scene.type as string;
  if (type === "quiz") return quizChoice(scene as { choices?: Choice[] }, text);
  if (type === "meta_checkpoint") return confidence(text);
  if (type === "spot_the_flaw" && deck?.length) return deckVerdicts(deck, text);
  if (type === "discussion") {
    if (MOVE_ON.test(normalize(text))) return { kind: "ack" };
    throw new ResponseInputError("a discussion takes each of the learner's arguments through submit_turn {session_id, text}; " +
      "reply « continuer » to move on");
  }
  const freeText = FREE_TEXT_KIND[type];
  if (freeText) return { kind: freeText, text } as ResponseInput;
  return { kind: "ack" };
}

/** An explicit quiz_choice must name a displayed id of the quiz on screen (any case), and is refused
 * in one line listing those ids otherwise (lead decision I-4); an id-less one on another scene is
 * refused saying how that scene is answered. Anything else passes as is. */
export function checkDisplayedChoice<T extends ResponseInput>(scene: Scene, input: T | UnnamedQuizChoice): T {
  if (input.kind !== "quiz_choice") return input;
  const asked = (input as { choiceId?: unknown }).choiceId;
  if (scene.type !== "quiz") {
    // A named id reaches the grader, which refuses the mismatch with the kind this scene expects.
    if (typeof asked === "string") return input as T;
    throw new ResponseInputError(`quiz_choice answers a quiz, and this scene is a ${scene.type}: ` +
      `send the learner's words as {kind: "reply", text}`);
  }
  const choices = (scene as { choices?: Choice[] }).choices ?? [];
  if (typeof asked !== "string") {
    throw new ResponseInputError(`quiz_choice needs choiceId, one of the displayed choice ids: ${choices.map((c) => c.id).join(", ")}`);
  }
  const choice = choices.find((c) => c.id === asked) ?? choices.find((c) => c.id.toLowerCase() === asked.toLowerCase());
  if (!choice) {
    throw new ResponseInputError(`quiz_choice "${asked}" is not a displayed choice id: ${choices.map((c) => c.id).join(", ")}`);
  }
  return (choice.id === asked ? input : { ...input, choiceId: choice.id }) as T;
}
