// packages/lesson-session-host/src/open-link.ts
//
// D2 (waiting review 2026-11-25, owner decision 1): when the Studium VS Code extension serves Studium to Copilot, it
// says so with STUDIUM_OPEN_LINK, the start of a link that opens a lesson in its pane:
// `${vscode.env.uriScheme}://<extension id>/open?bundle=`. A lesson ready to play — just written by create_lesson, or
// the study plan's lesson to start or continue — is then offered in the pane first, the chat one word away (« say
// “here” »): in the pane each step answers at once, in a chat each one waits on the assistant.
//
// The link is the prefix and the lesson file's absolute path percent-encoded once. VS Code decodes the query once
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
  return prefix + encodeURIComponent(lessonPath);
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

type ReadyLesson = { title: string; steps: number; minutes?: number | undefined; link: string };

/** The lesson is ready: its title, its steps, its minutes when the lesson says. */
function readyLine(locale: DisplayLocale, lesson: ReadyLesson): string {
  const t = READY[locale];
  const minutes = lesson.minutes === undefined ? "" : t.minutes.replace("{minutes}", String(lesson.minutes));
  const line = t.line.replace("{title}", () => lesson.title).replace("{steps}", String(lesson.steps)).replace("{minutes}", minutes);
  return locale === "fr" ? frenchSpacing(line) : line;
}

/** create_lesson's display_markdown when the extension serves Studium: the lesson is ready, then paneOffer. */
export function paneReady(locale: DisplayLocale, lesson: ReadyLesson): string {
  return `${readyLine(locale, lesson)}\n\n${paneOffer(locale, lesson.link)}`;
}

/** D4 (owner decision 4): create_lesson's display_markdown when the server's browser player is offered: the lesson is
 * ready, then browserOffer. */
export function browserReady(locale: DisplayLocale, lesson: ReadyLesson): string {
  return `${readyLine(locale, lesson)}\n\n${browserOffer(locale, lesson.link)}`;
}

/** D4 (waiting review 2026-11-25, owner decision 4): when no VS Code extension serves Studium, the server's own browser
 * player is offered instead. Its address is shown as it is, an autolink (<…>): a terminal assistant may show only the
 * text of a markdown link, and the address ends there, so no punctuation is taken for part of it. It lives as long
 * as the assistant's session. The learner answers there without the chat; nothing promises a speed or a check (review
 * of decision 4: a written answer a judge model assesses waits for it, and one no judge assesses is rated by the learner). */
const BROWSER_OFFER: Record<DisplayLocale, string> = {
  en: "Open it in your web browser: <{link}>. You answer each step there, without going through this chat; the address " +
    "works as long as this assistant session. Or say “here” to play it in this chat.",
  fr: "Ouvre-la dans ton navigateur : <{link}>. Tu y réponds à chaque étape sans passer par cette conversation ; l'adresse " +
    "vaut tant que dure cette session de l'assistant. Ou dis « ici » pour la suivre dans cette conversation.",
};

/** The sentences that offer the browser player first, in `locale`: its address, then the chat one word away. French
 * typography is applied before the address goes in, so nothing in the address moves. */
export function browserOffer(locale: DisplayLocale, link: string): string {
  const text = locale === "fr" ? frenchSpacing(BROWSER_OFFER.fr) : BROWSER_OFFER.en;
  return text.replace("{link}", () => link);
}

/** The sentences that offer the pane first, in `locale`: the link as markdown, the chat one word away, and where the
 * lesson is when the link does not open (VS Code before about 1.120 shows it as text). French typography applied
 * (it leaves the link as it is: no space precedes a colon or a question mark in it). */
export function paneOffer(locale: DisplayLocale, link: string): string {
  const text = OFFER[locale].replace("{link}", () => link);
  return locale === "fr" ? frenchSpacing(text) : text;
}
