// packages/lesson-session-host/src/open-link.ts
//
// D2 (waiting review 2026-11-25, owner decision 1): when the Studium VS Code extension serves Studium to Copilot, it
// says so with STUDIUM_OPEN_LINK, the start of a link that opens a lesson in its pane:
// `${vscode.env.uriScheme}://<extension id>/open?bundle=`. A lesson ready to play — just written by create_lesson, or
// the study plan's lesson to start or continue — is then offered in the pane first, the chat one word away (« say
// “here” »): in the pane each step answers at once, in a chat each one waits on the assistant.
//
// The link is the prefix and the lesson file's absolute path percent-encoded once, ( ) ' ! * included. VS Code decodes the query once
// before the extension's URI handler reads it (uri.query), which then takes all that follows "bundle=" as the path
// (apps/studium-vscode/src/lesson-uri.ts): & + % # and spaces survive. The pane opens a lesson.json from a link,
// never a .zip bundle. Pure.
import { isAbsolute, win32 } from "node:path";
import type { DisplayLocale } from "./chat-display.js";
import { frenchSpacing } from "../../lesson-session/src/phrases.js";

/** What a step or a result carries for the pane: the lesson file and the link that opens it there. */
export interface PaneLink { lesson_path: string; open_link: string }

/** The link that opens `lessonPath` in the pane, or null: no prefix, a relative path, or not a .json file (a .zip
 * bundle the URI handler refuses). */
export function openLessonLink(prefix: string, lessonPath: string): string | null {
  if (!prefix.trim()) return null;
  if (!isAbsolute(lessonPath) && !win32.isAbsolute(lessonPath)) return null;
  if (!lessonPath.toLowerCase().endsWith(".json")) return null;
  return prefix + encodeLinkPart(lessonPath);
}

/** encodeURIComponent, with the ! ' ( ) * it leaves encoded too (review finding 6): a ")" in a path ended the Markdown
 * link early. VS Code decodes every escape of the query once, these included (vscode-uri-fixture.ts). */
function encodeLinkPart(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `{lesson_path, open_link}` for `lessonPath`, or null when no link can open it. */
export function paneLink(prefix: string, lessonPath: string): PaneLink | null {
  const link = openLessonLink(prefix, lessonPath);
  return link ? { lesson_path: lessonPath, open_link: link } : null;
}

const OFFER: Record<DisplayLocale, string> = {
  en: "[Open it in the Studium pane]({link}): each step answers there at once. The first time, VS Code asks whether " +
    "Studium may open the link. Or say “here” to play it in this chat. If the link does not open, the lesson is in the " +
    "Studium view, under Lessons.",
  fr: "[Ouvre-la dans le panneau Studium]({link}) : chaque étape y répond aussitôt. La première fois, VS Code demande si " +
    "Studium peut ouvrir le lien. Ou dis « ici » pour la suivre dans cette conversation. Si le lien ne s'ouvre pas, la " +
    "leçon est dans la vue Studium, sous Leçons.",
};

const READY: Record<DisplayLocale, { line: string; minutes: string }> = {
  en: { line: "Your lesson “{title}” is ready: {steps} steps{minutes}.", minutes: ", about {minutes} minutes" },
  fr: { line: "Ta leçon « {title} » est prête : {steps} étapes{minutes}.", minutes: ", environ {minutes} minutes" },
};

/** create_lesson's display_markdown when the extension serves Studium: the lesson is ready (its title, its steps,
 * its minutes when the lesson says), then paneOffer. */
export function paneReady(
  locale: DisplayLocale, lesson: { title: string; steps: number; minutes?: number | undefined; link: string },
): string {
  const t = READY[locale];
  const minutes = lesson.minutes === undefined ? "" : t.minutes.replace("{minutes}", String(lesson.minutes));
  const line = t.line.replace("{title}", () => lesson.title).replace("{steps}", String(lesson.steps)).replace("{minutes}", minutes);
  return `${locale === "fr" ? frenchSpacing(line) : line}\n\n${paneOffer(locale, lesson.link)}`;
}

/** The sentences that offer the pane first, in `locale`: the link as markdown, the chat one word away, and where the
 * lesson is when the link does not open (VS Code before about 1.120 shows it as text). French typography applied
 * (it leaves the link as it is: no space precedes a colon or a question mark in it). */
export function paneOffer(locale: DisplayLocale, link: string): string {
  const text = OFFER[locale].replace("{link}", () => link);
  return locale === "fr" ? frenchSpacing(text) : text;
}
