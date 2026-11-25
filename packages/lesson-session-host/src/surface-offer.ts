// packages/lesson-session-host/src/surface-offer.ts
//
// Owner follow-up to decision 4 (waiting review 2026-11-25, 20:45): « laisser les panneaux natifs de Claude Code, Codex
// et OpenCode GUI quand c'est utilisé, ou modifier le comportement selon décisions de l'utilisateur ».
//
// A lesson ready to play (create_lesson's, the study plan's lesson to start or continue) is offered on the surfaces this
// host gives, in one order:
//   A  the surface the client draws natively first: a pane its own app draws (the Claude Code mod, once it has played
//      the default learner on this connection), an MCP Apps panel (the client announced io.modelcontextprotocol/ui; the
//      assistant calls open_lesson_panel), the VS Code pane (the extension's server); then the server's browser player;
//      the chat last, on « here ».
//   B  the surface where the learner last answered a step (study-record.ts answered_on) first, when this host gives it;
//      after answers in the chat, the chat first: the lesson plays here, and one other surface is named, once. An answer
//      in the chat is the learner's choice only in a session that showed them another surface (review G, finding 3;
//      SessionHost.noteSurfaceOffered): one the model started in the chat by itself records nothing.
// A lesson started in the chat ends its first step with one line naming the best surface (chatStartLine), never when
// the chat was the learner's choice. Pure: the host says what it gives (SessionHost.lessonOffer).
import type { DisplayLocale } from "./chat-display.js";
import { frenchSpacing } from "../../lesson-session/src/phrases.js";
import { browserOffer, paneOffer, readyLine, type ReadyLesson } from "./open-link.js";

/** Where a learner answers a step: the browser player, the VS Code pane, an MCP Apps panel, a pane the assistant's own
 * app draws (the Claude Code mod), or the chat (text or forms). */
export const ANSWER_SURFACES = ["browser", "vscode_pane", "panel", "assistant_pane", "chat"] as const;
export type AnswerSurface = (typeof ANSWER_SURFACES)[number];
/** A surface offered beside the chat. */
export type OfferedSurface = Exclude<AnswerSurface, "chat">;

/** A: the native surface first, the browser after it. */
const NATIVE_FIRST: readonly OfferedSurface[] = ["assistant_pane", "panel", "vscode_pane", "browser"];

/** What the client of a call gives, beside what the server itself gives (the VS Code pane's link, the browser player). */
export interface OfferClient {
  /** It draws Studium's lesson panel: it announced io.modelcontextprotocol/ui (the decision-1 exception aside). */
  panel?: boolean;
  /** Whether a native pane of the client's own app (the Claude Code mod) plays `learnerId` on this connection. */
  nativePane?: (learnerId: string) => boolean;
}

/** The surfaces to offer, first to last, the chat included; empty when the chat is all this host gives. */
export function surfaceOrder(can: (surface: OfferedSurface) => boolean, remembered?: AnswerSurface): AnswerSurface[] {
  const offered = NATIVE_FIRST.filter(can);
  if (!offered.length) return [];
  if (remembered === "chat") return ["chat", offered[0]!];
  const first = remembered !== undefined && (offered as AnswerSurface[]).includes(remembered) ? [remembered as OfferedSurface] : [];
  return [...first, ...offered.filter((surface) => !first.includes(surface)), "chat"];
}

/** A lesson offered: its surfaces in order, and what each needs. */
export interface SurfaceOffer {
  first: AnswerSurface;
  order: AnswerSurface[];
  /** The VS Code pane's link (with lesson_path) or the browser player's address. */
  open_link?: string;
  lesson_path?: string;
  /** The arguments of open_lesson_panel, when the panel is offered. */
  open_panel?: { bundle_ref: string; learner_id?: string };
  /** What the learner types to open the lesson in the pane of the assistant's own app. */
  command?: string;
}

type Words = Record<OfferedSurface, string>;
// The browser's words promise no speed (review of decision 4, 6021378; review G, finding 2): a written answer a judge
// model assesses waits for it there too. They say what holds in every configuration, as browserOffer does.
/** A surface offered first, before others. The VS Code pane first and the chat after it is paneOffer (D2). */
const FIRST: Record<DisplayLocale, Words> = {
  en: {
    vscode_pane: "[Open it in the Studium pane]({link}): each step answers there at once. The first time, VS Code asks whether Studium may open the link.",
    assistant_pane: "Open it in the Studium pane: type `{command}`. Each step answers there at once.",
    panel: "The assistant opens it in the Studium panel: each step answers there at once.",
    browser: "Open it in your web browser: <{link}>. You answer each step there, without going through this chat; the address works as long as this assistant session.",
  },
  fr: {
    vscode_pane: "[Ouvre-la dans le panneau Studium]({link}) : chaque étape y répond aussitôt. La première fois, VS Code demande si Studium peut ouvrir le lien.",
    assistant_pane: "Ouvre-la dans le volet Studium : tape `{command}`. Chaque étape y répond aussitôt.",
    panel: "L'assistant l'ouvre dans le panneau Studium : chaque étape y répond aussitôt.",
    browser: "Ouvre-la dans ton navigateur : <{link}>. Tu y réponds à chaque étape sans passer par cette conversation ; l'adresse vaut tant que dure cette session de l'assistant.",
  },
};
/** A surface offered after the first. */
const THEN: Record<DisplayLocale, Words> = {
  en: {
    assistant_pane: "Or type `{command}` to open it in the Studium pane.",
    panel: "Or say “panel” to open it in the Studium panel.",
    vscode_pane: "Or [open it in the Studium pane]({link}).",
    browser: "Or open it in your web browser: <{link}> (the address works as long as this assistant session).",
  },
  fr: {
    assistant_pane: "Ou tape `{command}` pour l'ouvrir dans le volet Studium.",
    panel: "Ou dis « panneau » pour l'ouvrir dans le panneau Studium.",
    vscode_pane: "Ou [ouvre-la dans le panneau Studium]({link}).",
    browser: "Ou ouvre-la dans ton navigateur : <{link}> (l'adresse vaut tant que dure cette session de l'assistant).",
  },
};
const CHAT_LAST: Record<DisplayLocale, string> = {
  en: "Or say “here” to play it in this chat.",
  fr: "Ou dis « ici » pour la suivre dans cette conversation.",
};
/** B: the learner chose the chat last time: the lesson plays here, and one surface is named, once. The words fit a
 * lesson started as well as one continued (review G, finding 3: « it goes on here » read as going on with a new one). */
const CHAT_FIRST: Record<DisplayLocale, string> = {
  en: "It plays here, in this chat, as you chose last time.",
  fr: "Tu la suis ici, dans cette conversation, comme tu l'as choisi la dernière fois.",
};
const ONCE: Record<DisplayLocale, Words> = {
  en: {
    assistant_pane: "To answer each step at once, type `{command}`: it opens in the Studium pane.",
    panel: "To answer each step at once, say “panel”: it opens in the Studium panel.",
    vscode_pane: "To answer each step at once, [open it in the Studium pane]({link}).",
    browser: "To answer each step without going through this chat, open it in your web browser: <{link}>.",
  },
  fr: {
    assistant_pane: "Pour des réponses immédiates, tape `{command}` : elle s'ouvre dans le volet Studium.",
    panel: "Pour des réponses immédiates, dis « panneau » : elle s'ouvre dans le panneau Studium.",
    vscode_pane: "Pour des réponses immédiates, [ouvre-la dans le panneau Studium]({link}).",
    browser: "Pour répondre à chaque étape sans passer par cette conversation, ouvre-la dans ton navigateur : <{link}>.",
  },
};
/** C (lead, 2026-11-25): the line at the end of the first step of a lesson started or resumed in the chat. */
const START_LINE: Record<DisplayLocale, Words> = {
  en: {
    assistant_pane: "_For immediate answers, type `{command}`: it opens in the Studium pane, where you are._",
    panel: "_For immediate answers, say “panel”: it opens in the Studium panel, where you are._",
    vscode_pane: "_For immediate answers, follow it in the [Studium pane]({link})._",
    browser: "_To answer each step without going through this chat, follow it in your web browser: <{link}>_",
  },
  fr: {
    assistant_pane: "_Pour des réponses immédiates, tape `{command}` : elle s'ouvre dans le volet Studium, là où tu en es._",
    panel: "_Pour des réponses immédiates, dis « panneau » : elle s'ouvre dans le panneau Studium, là où tu en es._",
    vscode_pane: "_Pour des réponses immédiates, suis-la dans le [panneau Studium]({link})._",
    browser: "_Pour répondre à chaque étape sans passer par cette conversation, suis-la dans ton navigateur : <{link}>_",
  },
};

/** `template` in `locale`, French typography applied before the link and the command go in, so neither moves. */
function fill(locale: DisplayLocale, template: string, offer: SurfaceOffer): string {
  const text = locale === "fr" ? frenchSpacing(template) : template;
  return text.replace("{link}", () => offer.open_link ?? "").replace("{command}", () => offer.command ?? "");
}

/** The sentences that offer the lesson, in `offer.order`. The browser or the VS Code pane first, then the chat: the
 * words of decision 4 and of D2, unchanged. */
export function offerSentences(locale: DisplayLocale, offer: SurfaceOffer): string {
  const [first, ...rest] = offer.order;
  if (first === "chat") return `${CHAT_FIRST[locale]} ${fill(locale, ONCE[locale][rest[0] as OfferedSurface], offer)}`;
  if (first === "vscode_pane" && rest.length === 1) return paneOffer(locale, offer.open_link ?? "");
  if (first === "browser" && rest.length === 1) return browserOffer(locale, offer.open_link ?? "");
  const head = FIRST[locale][first as OfferedSurface];
  const others = rest.map((surface) => (surface === "chat" ? CHAT_LAST[locale] : THEN[locale][surface]));
  return [head, ...others].map((template) => fill(locale, template, offer)).join(" ");
}

/** create_lesson's display_markdown: the lesson is ready, then offerSentences. */
export function offerReady(locale: DisplayLocale, lesson: Omit<ReadyLesson, "link">, offer: SurfaceOffer): string {
  return `${readyLine(locale, { ...lesson, link: "" })}\n\n${offerSentences(locale, offer)}`;
}

/** The line that ends the first step of a lesson started or resumed in the chat: the best surface, or null when the
 * chat was the learner's choice or there is nothing better. */
export function chatStartLine(locale: DisplayLocale, offer: SurfaceOffer | null): string | null {
  const best = offer?.order[0];
  if (!offer || best === undefined || best === "chat") return null;
  return fill(locale, START_LINE[locale][best], offer);
}
