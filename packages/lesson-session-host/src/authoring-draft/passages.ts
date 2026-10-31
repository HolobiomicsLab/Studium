// packages/lesson-session-host/src/authoring-draft/passages.ts
//
// Plain text or markdown → ordered passages a lesson may quote. A TypeScript port of
// `chunk_text` in tools/self_study_passages.py (same rules, same defaults), so a harness can
// author over MCP without the Python venv: the harness fetches its sources itself and passes
// their text (no HTML or PDF parsing here). Markdown is kept as written: a heading is a short
// paragraph and joins its section.
//
// Lengths are counted in UTF-16 code units (Python counts code points): the two agree on any
// text without characters outside the Basic Multilingual Plane.

export const DEFAULT_MIN_CHARS = 200;
export const DEFAULT_MAX_CHARS = 1200;

const PARAGRAPH_SEPARATOR = "\n\n";
const PARAGRAPH_BOUNDARY = /\n\s*\n|\f/;
const WHITESPACE_RUN = /\s+/g;
/** A period after these is not a sentence end (« d'après M. Spencer »); nor is one after an
 * initial (« É. Durkheim »). The list is the Python one. */
const NON_TERMINAL_ABBREVIATIONS = [
  "M", "MM", "Mme", "Mlle", "Dr", "Pr", "St", "cf", "Cf", "ex", "Ex", "p", "pp", "vol", "Vol",
  "no", "No", "n°", "etc", "i.e", "e.g",
];
/** Python's `\b` before a word is Unicode-aware; JavaScript's is ASCII-only, so it is spelled
 * out: "not preceded by a letter, a digit or an underscore". */
const NOT_AFTER_WORD = "(?<![\\p{L}\\p{N}_])";
const SENTENCE_END = new RegExp(
  "(?<=[.!?…])"
  + NON_TERMINAL_ABBREVIATIONS.map((abbreviation) => `(?<!${NOT_AFTER_WORD}${escapeRegExp(abbreviation)}\\.)`).join("")
  + `(?<!${NOT_AFTER_WORD}[A-ZÀ-ÖØ-Þ]\\.) `,
  "u",
);

/** Passages cut from a text, and how many short paragraphs had no passage to join. */
export interface ChunkedText {
  passages: string[];
  dropped_short: number;
}

/**
 * Split `text` into ordered passages of `minChars` to `maxChars` characters.
 *
 * Paragraphs end at blank lines and form feeds; inside one, whitespace runs become single
 * spaces. A paragraph longer than `maxChars` is cut at sentence ends, never after an
 * abbreviation or an initial (at spaces when one sentence is too long, anywhere when one word
 * is). A passage under `minChars` first absorbs the paragraphs after it (a heading joins its
 * section); one still short then joins the passage before it (a note joins the text it ends).
 * Both joins use a blank line and stay within `maxChars`; what fits nowhere is dropped and
 * counted in `dropped_short`. The text is NFC-normalized first, and the same text always gives
 * the same passages.
 */
export function chunkText(text: string, minChars = DEFAULT_MIN_CHARS, maxChars = DEFAULT_MAX_CHARS): ChunkedText {
  if (!(Number.isInteger(minChars) && Number.isInteger(maxChars) && minChars >= 1 && minChars <= maxChars)) {
    throw new RangeError(`minChars must be an integer from 1 to maxChars (got ${minChars}, ${maxChars})`);
  }
  const paragraphs = text.normalize("NFC").split(PARAGRAPH_BOUNDARY)
    .map((block) => block.replace(WHITESPACE_RUN, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
  const pieces = paragraphs.flatMap((paragraph) => fit(paragraph, maxChars));
  return attachShort(mergeShort(pieces, minChars, maxChars), minChars, maxChars);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Join consecutive units with single spaces into pieces of at most `maxChars`. */
function pack(units: string[], maxChars: number): string[] {
  const pieces: string[] = [];
  for (const unit of units) {
    const last = pieces.length - 1;
    if (last >= 0 && pieces[last]!.length + 1 + unit.length <= maxChars) pieces[last] += " " + unit;
    else pieces.push(unit);
  }
  return pieces;
}

/** A sentence longer than `maxChars`: cut at spaces, then a too-long word anywhere (by code
 * point, so a surrogate pair is never split). */
function fitSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  return pack(sentence.split(" "), maxChars).flatMap((word) => {
    if (word.length <= maxChars) return [word];
    const codePoints = Array.from(word);
    const slices: string[] = [];
    for (let start = 0; start < codePoints.length; start += maxChars) {
      slices.push(codePoints.slice(start, start + maxChars).join(""));
    }
    return slices;
  });
}

/** Cut a paragraph longer than `maxChars` at sentence ends, then spaces, then anywhere. */
function fit(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  return pack(paragraph.split(SENTENCE_END), maxChars).flatMap((sentence) => fitSentence(sentence, maxChars));
}

function fitsAfter(passage: string, piece: string, maxChars: number): boolean {
  return passage.length + PARAGRAPH_SEPARATOR.length + piece.length <= maxChars;
}

function mergeShort(pieces: string[], minChars: number, maxChars: number): string[] {
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged.length - 1;
    if (last >= 0 && merged[last]!.length < minChars && fitsAfter(merged[last]!, piece, maxChars)) {
      merged[last] += PARAGRAPH_SEPARATOR + piece;
    } else merged.push(piece);
  }
  return merged;
}

function attachShort(chunks: string[], minChars: number, maxChars: number): ChunkedText {
  const passages: string[] = [];
  let droppedShort = 0;
  for (const chunk of chunks) {
    const last = passages.length - 1;
    if (chunk.length >= minChars) passages.push(chunk);
    else if (last >= 0 && fitsAfter(passages[last]!, chunk, maxChars)) passages[last] += PARAGRAPH_SEPARATOR + chunk;
    else droppedShort += 1;
  }
  return { passages, dropped_short: droppedShort };
}
