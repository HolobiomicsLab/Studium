// packages/lesson-session-host/src/authoring-draft/quotes.ts
//
// Every quote of a draft must be a character-for-character substring of the passage it names. The
// comparison folds only what a copy through a chat client or a web page changes without the
// author noticing, on both sides:
//   - whitespace: no-break spaces (U+00A0, U+202F) and runs of spaces or line breaks are one space
//     (the passages already have this; « solidarité : » in a source has a no-break space);
//   - apostrophes: typographic ‘ ’ ʼ (U+2018, U+2019, U+02BC) are the straight ' (U+0027).
// Accents, case, other punctuation and the French « » stay significant.
import type { Passage } from "./source-set.js";

export const MIN_QUOTE_CHARS = 15;
/** The evidence excerpt that stores a quote holds at most this many characters. */
export const MAX_QUOTE_CHARS = 500;
const TYPOGRAPHIC_APOSTROPHES = /[‘’ʼ]/g;
const WHITESPACE_RUN = /\s+/g;
/** Below this many matching characters, a passage's opening is no useful pointer. */
const MIN_USEFUL_PREFIX = 8;
const EXCERPT_EXTRA_CHARS = 15;

export type QuoteCheck = { ok: true } | { ok: false; message: string; hint: string };

/** The quote comparison form of `text` (see the header). */
export function normalizeQuoteText(text: string): string {
  return text.normalize("NFC").replace(TYPOGRAPHIC_APOSTROPHES, "'").replace(WHITESPACE_RUN, " ").trim();
}

/**
 * Check that `quote` is in passage `passageId` of `passages`. A refusal says what to change: the
 * passage that does hold the quote when another was named, else where the named (or closest)
 * passage stops matching.
 */
export function checkQuote(passageId: string, quote: string, passages: readonly Passage[]): QuoteCheck {
  const needle = normalizeQuoteText(quote);
  if (needle.length < MIN_QUOTE_CHARS) {
    return { ok: false, message: `a quote needs at least ${MIN_QUOTE_CHARS} characters`, hint: "quote a whole phrase of the passage, not a word" };
  }
  if (needle.length > MAX_QUOTE_CHARS) {
    return { ok: false, message: `a quote has at most ${MAX_QUOTE_CHARS} characters`, hint: "quote the one or two sentences the item rests on" };
  }
  const normalized = passages.map((passage) => ({ passage, text: normalizeQuoteText(passage.text) }));
  const named = normalized.find((entry) => entry.passage.id === passageId);
  if (named?.text.includes(needle)) return { ok: true };
  const holder = normalized.find((entry) => entry.text.includes(needle));
  const message = named ? `the quote is not in passage ${passageId}` : `unknown passage_id ${passageId}`;
  if (holder) return { ok: false, message, hint: `the quote is in ${holder.passage.id}: cite that passage_id` };
  return { ok: false, message, hint: divergenceHint(needle, named ? [named, ...normalized] : normalized) };
}

/**
 * The characters of `passageText` that `quote` matched (typographic apostrophes, line breaks and
 * all), so the stored excerpt is the source's own wording; the folded quote when the passage does
 * not hold it or the span would exceed MAX_QUOTE_CHARS.
 */
export function sourceSpan(quote: string, passageText: string): string {
  const needle = normalizeQuoteText(quote);
  const pattern = Array.from(needle, (character) => {
    if (character === " ") return "\\s+";
    if (character === "'") return "['\u2018\u2019\u02bc]";
    return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  const match = new RegExp(pattern, "u").exec(passageText.normalize("NFC"));
  return match && match[0].length <= MAX_QUOTE_CHARS ? match[0] : needle;
}

/** Where the passage with the longest matching opening of `needle` (the named one first on ties)
 * stops matching it. */
function divergenceHint(needle: string, candidates: ReadonlyArray<{ passage: Passage; text: string }>): string {
  let best = { length: 0, at: -1, entry: candidates[0] };
  for (const entry of candidates) {
    const match = longestPrefixIn(needle, entry.text);
    if (match.length > best.length) best = { ...match, entry };
  }
  if (!best.entry || best.length < MIN_USEFUL_PREFIX) {
    return "no passage contains this wording: copy one or two sentences of the passage as they are written";
  }
  const matched = needle.slice(0, best.length);
  const reads = excerpt(best.entry.text.slice(best.at), Math.max(needle.length, best.length) + EXCERPT_EXTRA_CHARS);
  return `copy the words of ${best.entry.passage.id} exactly: the quote matches it up to “${matched}”, where the passage reads “${reads}”`;
}

/** The longest opening of `needle` found in `haystack`, by binary search (a prefix of a contained
 * prefix is contained), and where it starts. */
function longestPrefixIn(needle: string, haystack: string): { length: number; at: number } {
  let low = 0;
  let high = needle.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (haystack.includes(needle.slice(0, middle))) low = middle;
    else high = middle - 1;
  }
  return { length: low, at: low === 0 ? -1 : haystack.indexOf(needle.slice(0, low)) };
}

/** `text` cut to about `chars` characters at a word end, with an ellipsis when cut. */
function excerpt(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const wordEnd = cut.lastIndexOf(" ");
  return `${(wordEnd > 0 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}
