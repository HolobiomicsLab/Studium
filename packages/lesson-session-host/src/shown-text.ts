// shown-text.ts: the one cleaning every string taken from a lesson archive goes through before a person reads it. The
// VS Code modals (apps/studium-vscode/src/lesson-import.ts) and `studium-mcp import` (apps/lesson-mcp/src/import.ts)
// both use it: a second copy could drift.

/** The longest title shown; a reviewer is capped at 200 by parseApproval already. */
const MAX_SHOWN_TITLE = 200;

/** A string from the archive or the library as the modals show it (reviews of 2026-11-27, item 4 then item 5): every
 * character of Unicode categories Cc (controls), Cf (invisible formatting, bidi controls, tags), Zl and Zp (line and
 * paragraph separators), plus U+034F and U+180E, is removed; whitespace is collapsed to one space; the result is capped.
 * Line breaks become spaces first, so two words on two lines stay two words. The archive's author never controls a
 * whole line, nor what a reader cannot see. */
const LINE_BREAKS = /[\r\n\p{Zl}\p{Zp}]/gu;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{34F}\u{180E}]/gu;
export function shownText(text: string, max = MAX_SHOWN_TITLE): string {
  const cleaned = text.replace(LINE_BREAKS, " ").replace(HIDDEN, "").replace(/\s+/gu, " ").trim();
  const chars = [...cleaned];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : cleaned;
}
