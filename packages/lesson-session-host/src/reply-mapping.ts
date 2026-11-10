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
// Pass of 10 Nov 2026 (usages-apprenant D1, D3, D4, D7): a verdict deck reads « none flagged » only
// from the whole reply and a list of numbers only when it is plainly that list; a written answer
// cannot be empty; a confidence relayed with `reply` reaches the produced input; a before and an
// after are read from their labels. A « je ne sais pas » is refused without pushing to guess, and a
// reading screen does not take a question or a « wait » for « I have read it ».
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
  return text.normalize("NFKC").trim().toLowerCase().replace(/[’‘]/g, "'").replace(/^[\s()[\]."'«»“”:*_—–-]+|[\s()[\]."'«»“”:*_—–!?-]+$/g, "");
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

// « je ne sais pas », « aucune idée », "I don't know", "no idea", « pas compris »: the learner has not answered.
const NOT_KNOWN = /^(?:je\s+ne\s+sais\s+pas|je\s+sais\s+pas|chais\s+pas|aucune\s+id[ée]e|pas\s+d'id[ée]e|rien\s+compris|pas\s+compris|(?:je\s+n'ai|je\s+ai|j'ai)\s+pas\s+compris|i\s+(?:don'?t|do\s+not)\s+know|idk|dunno|no\s+idea)(?![\p{L}])/u;
const NEGATION = /(?<![\p{L}])(?:pas|not|no|non|ne|never|jamais|sauf|except)(?![\p{L}])|(?<![\p{L}])n'|n't(?![\p{L}])/u;

// A hedge around one id: « la b je crois », « plutôt b », « b je pense », « d'après moi a », "I think b", "probably c".
const STRONG_CUE = String.raw`(?:(?:d'apr[èe]s|selon|pour)\s+moi|je\s+dirais(?:\s+que\s+c'est)?|je\s+choisis|je\s+(?:pense|crois)(?:\s+que\s+c'est)?|i'?d\s+(?:say|go\s+with)|i\s+(?:would\s+)?(?:say|go\s+with|choose|pick)|i\s+(?:think|believe)(?:\s+(?:it's|it\s+is))?|c'est|it's|it\s+is|r[ée]ponse|answer|option|choix|choice|lettre|letter|la|le|the)`;
const WEAK_CUE = String.raw`(?:plut[oô]t|probablement|probably|sans\s+doute|likely|rather)`;
const CUE_THEN = String.raw`(?:${WEAK_CUE}|${STRONG_CUE})(?:\s*[,:]\s*|\s+)`;
const HEDGE_AFTER = String.raw`(?:\s*[,;]?\s*(?:je\s+(?:crois|pense|dirais|suppose)(?:\s+bien)?|[àa]\s+mon\s+avis|sans\s+doute|probablement|i\s+(?:think|guess|believe|suppose)|probably|i'?d\s+say))*`;

/** The one displayed id a reply names with a hedge around it, and nothing else. A bare « a » (the verb,
 * the article) counts only as the whole reply, at the head, or right after a strong cue. */
function hedgedChoice(choices: readonly Choice[], reply: string): Choice | undefined {
  const found = choices.filter((choice) => {
    const id = escapeRegExp(choice.id.toLowerCase());
    const prefix = id === "a" ? `(?:(?:${CUE_THEN})*${STRONG_CUE}(?:\\s*[,:]\\s*|\\s+))?` : `(?:${CUE_THEN})*`;
    return new RegExp(`^${prefix}\\(?${id}\\)?${HEDGE_AFTER}\\s*[.!?]*$`, "u").test(reply);
  });
  return found.length === 1 ? found[0] : undefined;
}

/** Whole words of `inner` found as a run of whole words in `outer`. */
const containsWords = (outer: string, inner: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(inner)}(?![\\p{L}\\p{N}])`, "u").test(outer);

function quizChoice(scene: { choices?: Choice[] }, text: string): ResponseInput {
  const choices = scene.choices ?? [];
  const reply = normalize(text);
  const ids = choices.map((c) => c.id).join(", ");
  const byId = (id: string | undefined) => (id === undefined ? undefined : choices.find((c) => c.id.toLowerCase() === id));
  const plain = `this quiz takes one of the displayed choice ids: ${ids}`;
  const several = (found: readonly Choice[]) => new ResponseInputError(`${plain}; this reply names more ` +
    `than one (${found.map((c) => c.id).join(", ")}): reply with the learner's one letter`);
  let choice = byId(reply) ?? byId(CHOICE_CUE.exec(reply)?.[1]) ?? choices.find((c) => normalize(c.text) === reply);
  if (!choice && NOT_KNOWN.test(reply)) {
    throw new ResponseInputError(`${plain}; the learner has not answered yet: they can ask for a hint ` +
      `(request_hint {session_id}) or a question, then ask for their answer when they are ready; do not guess for them`);
  }
  if (!choice) {
    // L-10: the letter, then the learner's reason — read only when it names one displayed id.
    const { chosen, named } = namedChoices(choices, text);
    const all = [...new Set([...chosen, ...named])];
    if (all.length > 1) throw several(all);
    // A negation before the id (« I do not think it is b ») is not a choice.
    const negated = (c: Choice) => {
      const at = new RegExp(`${TOKEN_START}${escapeRegExp(c.id.toLowerCase())}${AFTER_CHOICE}`, "u").exec(reply)?.index ?? 0;
      return NEGATION.test(reply.slice(0, at));
    };
    if (chosen.length === 1 && !negated(chosen[0]!)) choice = chosen[0];
    if (!choice) choice = hedgedChoice(choices, reply);
    // The text of a choice, said instead of its letter: the reply is inside one choice's text, or holds
    // one choice's full text. Only when the reply names no id, and carries no negation.
    if (!choice && !named.length && reply.length >= 3 && !NEGATION.test(reply)) {
      const found = choices.filter((c) => {
        const body = normalize(c.text);
        return body.length >= 3 && (containsWords(body, reply) || containsWords(reply, body));
      });
      if (found.length > 1) throw several(found);
      choice = found[0];
    }
  }
  if (!choice) {
    throw new ResponseInputError(`${plain}; reply with the learner's letter`);
  }
  return { kind: "quiz_choice", choiceId: choice.id };
}

type Confidence = 0 | 1 | 2 | 3 | 4;
const isConfidence = (n: number): n is Confidence => Number.isInteger(n) && n >= 0 && n <= 4;

const PRE_LABEL = /(?<![\p{L}])(?:avant|au\s+d[ée]but|au\s+d[ée]part|d'abord|before|initially|at\s+first|pre)(?![\p{L}])/gu;
const POST_LABEL = /(?<![\p{L}])(?:apr[èe]s|maintenant|[àa]\s+pr[ée]sent|[àa]\s+la\s+fin|after|now|finally|post)(?![\p{L}])/gu;

function confidence(text: string): ResponseInput {
  // « 2 sur 4 », « 2/4 », « 2 out of 4 » name the scale, not a second rating (blanked to keep positions).
  const lowered = text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'")
    .replace(/(?:sur|\/|out\s+of)\s*4\b/giu, (m) => " ".repeat(m.length));
  const found = [...lowered.matchAll(/\d+/g)].map((m) => ({ at: m.index!, value: Number(m[0]), label: undefined as "pre" | "post" | undefined }));
  const numbers = found.map((n) => n.value);
  const refuse = () => new ResponseInputError("this checkpoint takes a confidence from 0 to 4 (or a before and an after, 0 to 4 each)");
  if (numbers.length === 1 && isConfidence(numbers[0]!)) return { kind: "confidence", value: numbers[0]! };
  if (numbers.length === 2 && isConfidence(numbers[0]!) && isConfidence(numbers[1]!)) {
    // Labels decide, whatever the order: « après 3, avant 1 ». They must pair one to one with the
    // numbers, each label next to its number, and name one before and one after.
    const labels = [
      ...[...lowered.matchAll(PRE_LABEL)].map((m) => ({ at: m.index!, kind: "pre" as const })),
      ...[...lowered.matchAll(POST_LABEL)].map((m) => ({ at: m.index!, kind: "post" as const })),
    ];
    // No label at all: the checkpoint asks for the before, then the after, and the reply follows that order.
    if (labels.length === 0) return { kind: "confidence", pre: numbers[0]!, post: numbers[1]! };
    if (labels.length !== 2) throw refuse();
    const sequence = [...found.map((n) => ({ at: n.at, n: n.value, kind: undefined as "pre" | "post" | undefined })),
      ...labels.map((l) => ({ at: l.at, n: undefined as number | undefined, kind: l.kind }))].sort((a, b) => a.at - b.at);
    const shape = sequence.map((item) => (item.kind ? "L" : "N")).join("");
    if (shape !== "LNLN" && shape !== "NLNL") throw refuse();
    const pairs = shape === "LNLN"
      ? [[sequence[0]!, sequence[1]!], [sequence[2]!, sequence[3]!]] : [[sequence[1]!, sequence[0]!], [sequence[3]!, sequence[2]!]];
    const [first, second] = pairs.map(([label, number]) => ({ kind: label!.kind!, n: number!.n! }));
    if (first!.kind === second!.kind) throw refuse();
    const pre = first!.kind === "pre" ? first!.n : second!.n;
    const post = first!.kind === "post" ? first!.n : second!.n;
    return { kind: "confidence", pre: pre as Confidence, post: post as Confidence };
  }
  throw refuse();
}

// « aucune », « aucune erreur », « aucune n'est fausse », « rien à signaler », « toutes sont justes »,
// "none are wrong", "nothing wrong", "all correct", "they are all correct" — and nothing else.
const NONE_FLAGGED = new RegExp(String.raw`^(?:` + [
  String.raw`aucune?(?:\s+(?:erreur|affirmation|fausse|n'est\s+fausse|n'est\s+erron[ée]e))?`,
  String.raw`rien\s+[àa]\s+signaler`,
  String.raw`(?:elles\s+sont\s+)?toutes?(?:\s+sont)?\s+(?:justes?|vraies?|correctes?|exactes?)`,
  String.raw`none(?:\s+(?:are|is)\s+wrong|\s+of\s+them\s+(?:are|is)\s+wrong)?`,
  String.raw`nothing(?:\s+is)?\s+wrong`,
  String.raw`(?:they\s+are\s+)?all(?:\s+of\s+them)?(?:\s+are)?\s+(?:correct|right|sound)`,
  String.raw`they\s+are\s+all\s+(?:correct|right|sound)`,
].join("|") + String.raw`)$`, "u");

// What may surround claim numbers in a plain list: « la 2 et la 3 », "claims 2 and 4", « les affirmations 2 et 4 sont fausses ».
// « justes », "right", "correct" are NOT here: « 2 et 3 sont justes » says the opposite of a list of the wrong ones.
const LIST_FILLER = new Set([
  "la", "le", "les", "et", "and", "the", "affirmation", "affirmations", "claim", "claims", "statement", "statements",
  "numéro", "numéros", "number", "numbers", "n°", "sont", "est", "are", "is", "fausse", "fausses", "faux", "wrong", "false",
  "incorrecte", "incorrectes", "incorrect", "erronée", "erronées", "seulement", "uniquement", "only",
]);

function deckVerdicts(deck: readonly DeckToken[], text: string): ResponseInput {
  const reply = normalize(text);
  const range = `this deck numbers its claims 1 to ${deck.length}: reply with the numbers of the claims the learner judges wrong, or « aucune »`;
  const alone = `this deck numbers its claims 1 to ${deck.length}: send the numbers alone, without reason, doubt or negation, ` +
    `of the claims the learner judges wrong, or « aucune »`;
  if (NOT_KNOWN.test(reply)) {
    throw new ResponseInputError(`this deck numbers its claims 1 to ${deck.length}: the learner has not judged the claims yet: ` +
      `when they are ready, reply with the numbers of the claims judged wrong, or « aucune » (they can ask you a question about the claims first)`);
  }
  if (text.includes("?")) throw new ResponseInputError(alone);
  const verdicts = (flagged: ReadonlySet<number>): ResponseInput =>
    ({ kind: "flaw_verdicts", verdicts: deck.map((d, i) => ({ token: d.token, flagged: flagged.has(i) })) });
  if (NONE_FLAGGED.test(reply)) return verdicts(new Set());
  if (!/\d/.test(reply)) throw new ResponseInputError(range);
  // A decimal (« 1.6 », « 1,3 ») is a measure, never a claim number.
  if (/\d[.,]\d/.test(reply)) throw new ResponseInputError(alone);
  const tokens = reply.replace(/\b[ld]'/g, " ").replace(/[.,;:()/&+!]/g, " ").split(/\s+/).filter(Boolean);
  const numbers: number[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) numbers.push(Number(token));
    else if (!LIST_FILLER.has(token)) throw new ResponseInputError(alone);
  }
  if (numbers.some((n) => n < 1 || n > deck.length)) throw new ResponseInputError(range);
  return verdicts(new Set(numbers.map((n) => n - 1)));
}

// A reading screen: a question, or a word that says the learner is not ready, is not « I have read it ».
const NOT_READY = /^(?:non|no|attends|attendez|wait|pas\s+encore|not\s+yet|stop|je\s+n'ai\s+pas\s+compris|i\s+don'?t\s+understand)(?![\p{L}])/u;
const WRITTEN_KINDS: ReadonlySet<string> = new Set(Object.values(FREE_TEXT_KIND));
const WRITTEN_ONLY = "this step takes the learner's own words; nothing was recorded: ask the learner for their answer";

const MOVE_ON = /^(?:continuer|continue|suivant|suite|next|ok|okay|d'accord|passer|on continue)$/u;

/**
 * The input the current scene takes, read from a chat reply. `deck` is the scene's displayed verdict
 * deck when it has one (publicScene computes it). Throws ResponseInputError when the reply does not
 * say what the scene needs.
 */
export function replyToInput(scene: Scene, text: string, deck?: readonly DeckToken[], confidenceValue?: number): ResponseInput {
  const type = scene.type as string;
  // D4: a confidence relayed with the reply is kept for the inputs that take one; out of range, refused.
  if (confidenceValue !== undefined && !isConfidence(confidenceValue)) {
    throw new ResponseInputError("a confidence is an integer from 0 to 4");
  }
  const withConfidence = <T extends ResponseInput>(input: T): T =>
    (confidenceValue === undefined ? input : { ...input, confidence: confidenceValue }) as T;
  if (type === "quiz") return withConfidence(quizChoice(scene as { choices?: Choice[] }, text));
  if (type === "meta_checkpoint") return confidence(text);
  if (type === "spot_the_flaw" && deck?.length) return withConfidence(deckVerdicts(deck, text));
  if (type === "discussion") {
    if (MOVE_ON.test(normalize(text))) return { kind: "ack" };
    throw new ResponseInputError("a discussion takes each of the learner's arguments through submit_turn {session_id, text}; " +
      "reply « continuer » to move on");
  }
  const freeText = FREE_TEXT_KIND[type];
  if (freeText) {
    if (!text.trim()) throw new ResponseInputError(WRITTEN_ONLY);
    return withConfidence({ kind: freeText, text } as ResponseInput);
  }
  if (text.includes("?") || NOT_READY.test(normalize(text))) {
    throw new ResponseInputError("this screen is for reading and the learner is not ready or asked something: " +
      "answer them first, then send « continuer » when they say they are ready");
  }
  return { kind: "ack" };
}

/** An explicit quiz_choice must name a displayed id of the quiz on screen (any case), and is refused
 * in one line listing those ids otherwise (lead decision I-4); an id-less one on another scene is
 * refused saying how that scene is answered. Anything else passes as is. */
export function checkDisplayedChoice<T extends ResponseInput>(scene: Scene, input: T | UnnamedQuizChoice): T {
  if (WRITTEN_KINDS.has(input.kind)) {
    const words = (input as { text?: unknown }).text;
    if (typeof words === "string" && !words.trim()) throw new ResponseInputError(WRITTEN_ONLY);
  }
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
